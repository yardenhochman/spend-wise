import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import {
  accountKey,
  allowedAccount,
  householdTransaction,
  isChecking,
} from './household.js'
import { extractBalances, latestBalances, persistBalances } from './balances.js'
import {
  addDays,
  dueDate,
  median,
  monthOffset,
  monthsThrough,
  round,
  todayInIsrael,
} from './dates.js'
import {
  detectObligations,
  inferCadence,
  matchesObligation,
  mortgageObligation,
  mortgageRepayments,
  obligationEvents,
  obligationTrail,
  occursInMonth,
  stableId,
} from './obligations.js'
import {
  cardSettlementEvents,
  parseBillingCycle,
  salaryEvents,
} from './settlements.js'
import { buildRunway } from './runway.js'
import { buildBrief, recurringItems } from './brief.js'
import { config, obligation, snapshot, tx } from './test-fixtures.js'
import type { Event, HomeTransaction } from './types.js'
const today = '2030-06-18'
const history = [
  tx({ id: '1', date: '2030-03-10' }),
  tx({ id: '2', date: '2030-04-10' }),
  tx({ id: '3', date: '2030-05-10' }),
]
const card = (id: string, month: string, amount = -100) =>
  tx({
    id,
    date: month + '-01',
    amount,
    account_label: 'Credit Card',
    notes: `leumi account 22222/33 card 0000 cycle ${month}`,
  })
const debit = tx({
  id: 'debit',
  date: '2030-05-10',
  merchant: 'Synthetic card settlement',
  is_internal: 1,
  amount: -150,
})
describe('home dates and household scope', () => {
  it('handles month ends, leap years, offsets and Israel midnight', () => {
    expect(addDays('2030-01-01', -1)).toBe('2029-12-31')
    expect(monthOffset('2030-01', -1)).toBe('2029-12')
    expect(dueDate('2032-02', 31)).toBe('2032-02-29')
    expect(monthsThrough('2030-01-10', 3)).toEqual([
      '2029-11',
      '2029-12',
      '2030-01',
    ])
    expect(todayInIsrael(new Date('2030-06-17T22:30:00Z'))).toBe('2030-06-18')
    expect(median([3, 1, 2, 4])).toBe(2.5)
    expect(median([])).toBe(0)
    expect(round(12.345)).toBe(12.35)
  })
  it('allows only configured source identities and explicitly allowed legacy rows', () => {
    expect(accountKey('111-22222_33')).toBe('22222/33')
    expect(allowedAccount('22222/33', config)).toBe(true)
    expect(householdTransaction(tx(), config)).toBe(true)
    expect(householdTransaction(tx())).toBe(false)
    expect(
      householdTransaction(
        tx({ notes: 'scraper account 999-00000_11' }),
        config,
      ),
    ).toBe(false)
    expect(
      householdTransaction(tx({ bank_name: 'Committee Bank' }), config),
    ).toBe(false)
    expect(
      householdTransaction(tx({ notes: null, account_id: 'legacy' }), config),
    ).toBe(true)
    expect(householdTransaction(tx({ notes: null }), config)).toBe(false)
    expect(isChecking(card('c', '2030-06'))).toBe(false)
  })
})
describe('synthetic broker balances', () => {
  it('extracts finite balances including zero, excludes committee and never uses bank labels', () => {
    const result = extractBalances(
      {
        accounts: [
          { accountNumber: '111-22222_33', balance: 0, label: 'Private label' },
          { accountNumber: '999-00000_11', balance: 900 },
          { accountNumber: '111-22222_33', balance: NaN },
        ],
      },
      '2030-06-01',
      config,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      label: 'Checking 1',
      balance: 0,
      currency: 'ILS',
    })
    expect(extractBalances({}, '2030-06-01', config)).toEqual([])
    expect(() => extractBalances({}, 'invalid', config)).toThrow()
  })
  it('persists idempotently and chooses each allowed account latest ILS snapshot', () => {
    const db = new Database(':memory:')
    try {
      const schema = readFileSync(
        new URL('../../db/sqlite-schema.sql', import.meta.url),
        'utf8',
      )
      db.exec(schema)
      db.exec(schema)
      const balances = extractBalances(
        { accounts: [{ accountNumber: '111-22222_33', balance: 100 }] },
        '2030-06-01',
        config,
      )
      persistBalances(db, balances, '2030-06-01')
      persistBalances(db, balances, '2030-06-02')
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM account_balances').get(),
      ).toEqual({ n: 1 })
      const latest = latestBalances(
        [
          ...balances,
          { ...balances[0], balance: 200, as_of: '2030-06-02T00:00:00Z' },
          { ...balances[0], balance: 999, as_of: '2031-01-01T00:00:00Z' },
          { ...balances[0], currency: 'USD', as_of: '2030-06-03T00:00:00Z' },
        ],
        today,
        config,
      )
      expect(latest).toHaveLength(1)
      expect(latest[0].balance).toBe(200)
    } finally {
      db.close()
    }
  })
})
describe('obligations', () => {
  it('detects checking suggestions with stable ids and cadence, never card purchases', () => {
    expect(stableId('x', 'same')).toBe(stableId('x', 'same'))
    const result = detectObligations(
      [...history, card('card', '2030-06')],
      today,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      confirmed: false,
      expectedAmount: 100,
      cadence: 'monthly',
      dueDay: 10,
    })
    expect(detectObligations(history, '2031-12-01')).toEqual([])
    expect(inferCadence(['2028-01-01', '2029-01-01', '2030-01-01'])).toBe(
      'yearly',
    )
    expect(inferCadence(['2030-01-01', '2030-03-01', '2030-05-01'])).toBe(
      'bimonthly',
    )
    expect(inferCadence(['2030-01-01'])).toBe('irregular')
  })
  it('recognizes tuition/tax/hoa/loan/utility suggestions without household-specific rules', () => {
    for (const [name, kind] of [
      ['Synthetic tuition', 'tuition'],
      ['Synthetic arnona', 'tax'],
      ['Synthetic HOA', 'hoa'],
      ['Synthetic loan', 'loan'],
      ['Synthetic water', 'utility'],
    ])
      expect(
        detectObligations(
          history.map((t) => ({ ...t, merchant: name })),
          today,
        )[0].kind,
      ).toBe(kind)
  })
  it('marks paid with tolerance, leaves suggestions unconfirmed, applies grace only to confirmed rows', () => {
    const months = ['2030-05', '2030-06']
    const o = obligation()
    expect(
      obligationTrail(o, history, months, today).trail.map((t) => t.status),
    ).toEqual(['paid', 'unconfirmed'])
    expect(
      obligationTrail(
        { ...o, confirmed: true },
        history,
        months,
        today,
      ).trail.map((t) => t.status),
    ).toEqual(['paid', 'late'])
    expect(
      obligationTrail({ ...o, confirmed: true }, [], ['2030-06'], '2030-06-15')
        .trail[0].status,
    ).toBe('due')
    expect(
      obligationTrail(o, [tx({ amount: -114 })], ['2030-06'], today).trail[0]
        .status,
    ).toBe('paid')
    const mismatch = obligationTrail(
      o,
      [tx({ amount: -150 })],
      ['2030-06'],
      today,
    )
    expect(mismatch.trail[0]).toMatchObject({
      status: 'unconfirmed',
      amount: 150,
    })
    expect(mismatch.note).toContain('50 ILS')
    expect(matchesObligation(o, tx({ is_internal: 1 }))).toBe(false)
  })
  it('respects recurrence anchors, irregular payments, month-end due dates and paid projection exclusion', () => {
    expect(occursInMonth(obligation({ cadence: 'bimonthly' }), '2030-02')).toBe(
      false,
    )
    expect(occursInMonth(obligation({ cadence: 'yearly' }), '2031-01')).toBe(
      true,
    )
    expect(occursInMonth(obligation(), '2029-12')).toBe(false)
    expect(
      obligationTrail(
        obligation({ cadence: 'irregular' }),
        [],
        ['2030-06'],
        today,
      ).trail[0].status,
    ).toBe('none')
    expect(
      obligationTrail(
        obligation({ cadence: 'irregular' }),
        [tx()],
        ['2030-06'],
        today,
      ).trail[0].status,
    ).toBe('paid')
    expect(
      obligationEvents(
        [obligation({ dueDay: 31 })],
        [],
        '2032-02-01',
        '2032-03-01',
      )[0].date,
    ).toBe('2032-02-29')
    expect(
      obligationEvents([obligation()], history, '2030-05-10', '2030-05-31'),
    ).toEqual([])
  })
  it('uses normalized mortgage helpers without exposing identity and does not invent missing amounts', () => {
    const s = snapshot()
    expect(mortgageObligation(s, today)[0]).toMatchObject({
      name: 'Mortgage',
      expectedAmount: 200,
      confirmed: false,
    })
    expect(mortgageRepayments(s)[0]).toMatchObject({
      name: 'Mortgage 1',
      remaining: 10000,
      source: 'mortgage',
    })
    expect(mortgageObligation(null, today)).toEqual([])
    expect(mortgageRepayments(null)).toEqual([])
    s.mortgages[0].lastPaymentAmount = null
    s.mortgages[0].trackPaymentTotal = null
    expect(mortgageObligation(s, today)[0].expectedAmount).toBeNull()
  })
})
describe('settlement and salary forecasting', () => {
  it('parses ISO and Hebrew billing labels and rejects unavailable cycles', () => {
    expect(parseBillingCycle(card('c', '2030-06').notes)?.month).toBe('2030-06')
    expect(
      parseBillingCycle(
        'leumi account example card 0000 cycle יוני 2030; extra',
      )?.month,
    ).toBe('2030-06')
    expect(parseBillingCycle(null)).toBeNull()
    expect(parseBillingCycle('leumi account x card y cycle unknown')).toBeNull()
  })
  it('uses cycle totals including refunds and estimates dates from checking settlements', () => {
    const events = cardSettlementEvents(
      [debit, card('a', '2030-06', -120), card('b', '2030-06', 20)],
      '2030-06-01',
      '2030-07-31',
    )
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      date: '2030-06-10',
      amount: -100,
      estimated: true,
      kind: 'card',
    })
    expect(
      cardSettlementEvents([card('a', '2030-06')], today, '2030-07-31'),
    ).toEqual([])
    expect(cardSettlementEvents([debit], today, '2030-07-31')[0]).toMatchObject(
      { date: '2030-07-10', amount: -150 },
    )
  })
  it('uses identified per-card checking debit days when available', () => {
    const rows = [
      {
        ...debit,
        date: '2030-05-05',
        merchant: 'Synthetic card settlement 0000',
      },
      {
        ...debit,
        id: 'second-debit',
        date: '2030-05-15',
        merchant: 'Synthetic card settlement 9999',
      },
      card('card-one', '2030-06'),
      {
        ...card('card-two', '2030-06'),
        notes: 'leumi account 22222/33 card 9999 cycle 2030-06',
      },
    ]
    expect(
      cardSettlementEvents(rows, '2030-06-01', '2030-06-30').map((e) => e.date),
    ).toEqual(['2030-06-05', '2030-06-15'])
  })
  it('does not reforecast an already observed debit or include future card transactions', () => {
    expect(
      cardSettlementEvents(
        [debit, card('a', '2030-05')],
        '2030-05-10',
        '2030-05-31',
      ),
    ).toEqual([])
    expect(
      cardSettlementEvents(
        [debit, card('a', '2030-07')],
        '2030-06-01',
        '2030-06-30',
      ),
    ).toEqual(cardSettlementEvents([debit], '2030-06-01', '2030-06-30'))
  })
  it('aggregates salary per employer/month and avoids an already-paid month', () => {
    const salaries = history.map((t) => ({
      ...t,
      category_name: 'Salary',
      amount: 1000,
    }))
    expect(salaryEvents(salaries, '2030-06-01', '2030-07-31')).toHaveLength(2)
    expect(
      salaryEvents(
        [...salaries, tx({ category_name: 'Salary', amount: 1000 })],
        '2030-06-10',
        '2030-06-30',
      ),
    ).toEqual([])
    expect(salaryEvents([salaries[0]], today, '2030-07-31')).toEqual([])
  })
})
describe('runway', () => {
  const events: Event[] = [
    {
      date: '2030-06-19',
      label: 'Bill',
      amount: -150,
      kind: 'obligation',
      estimated: true,
    },
    {
      date: '2030-06-20',
      label: 'Salary',
      amount: 200,
      kind: 'salary',
      estimated: true,
    },
  ]
  it('keeps missing balance distinct from zero while retaining events', () => {
    const empty = buildRunway(today, 3, [], events)
    expect(empty.openingBalance).toBeNull()
    expect(empty.days).toEqual([])
    expect(empty.events).toHaveLength(2)
    expect(empty.low).toBeNull()
    expect(empty.warnings.length).toBeGreaterThan(0)
    const balances = extractBalances(
      { accounts: [{ accountNumber: '111-22222_33', balance: 0 }] },
      '2030-06-18',
      config,
    )
    const result = buildRunway(today, 3, balances, events)
    expect(result.days.map((d) => d.balance)).toEqual([0, -150, 50])
    expect(result.low).toEqual({ date: '2030-06-19', balance: -150 })
    expect(result.nextSalary).toEqual({ date: '2030-06-20', amount: 200 })
  })
})
describe('deterministic brief and recurring adapter', () => {
  const recurring = {
    merchant: 'Synthetic subscription',
    category_name: 'Subscriptions',
    category_id: 'subscriptions',
    avg_amount: -100,
    recent_avg_amount: -125,
    months_active: 6,
    last_seen: '2030-06-01',
    first_seen: '2029-01-01',
    is_active: true,
    tx_count: 6,
  }
  it('flags price changes/new charges and annualizes yearly subscriptions once', () => {
    const rows = [tx({ merchant: recurring.merchant })]
    expect(recurringItems([recurring], rows, today)[0]).toMatchObject({
      flag: 'price-up',
      annualized: 1500,
    })
    expect(
      recurringItems([{ ...recurring, recent_avg_amount: -70 }], rows, today)[0]
        .flag,
    ).toBe('price-down')
    expect(
      recurringItems(
        [{ ...recurring, recent_avg_amount: -100, first_seen: '2030-06-01' }],
        rows,
        today,
      )[0].flag,
    ).toBe('new')
    const years = ['2028-06-01', '2029-06-01', '2030-06-01'].map((date) =>
      tx({ date, merchant: recurring.merchant }),
    )
    expect(
      recurringItems(
        [{ ...recurring, recent_avg_amount: -100 }],
        years,
        today,
      )[0],
    ).toMatchObject({ cadence: 'yearly', annualized: 100 })
  })
  const runway = buildRunway(today, 2, [], [])
  const series = [
    {
      id: 'utilities',
      name: 'Utilities',
      points: [100, 100, 100, 250, 250, 250],
    },
  ]
  const rows: HomeTransaction[] = [
    '2029-12',
    '2030-01',
    '2030-02',
    '2030-03',
    '2030-04',
    '2030-05',
  ].map((m, i) => tx({ id: String(i + 1), date: m + '-10' }))
  it('emits stable category, mismatch, recurring, ended-project, low-balance and stale notices with standalone prompts', () => {
    const obligations = [
      obligationTrail(obligation(), [tx({ amount: -150 })], ['2030-06'], today),
    ]
    const rec = recurringItems(
      [recurring],
      [tx({ merchant: recurring.merchant })],
      today,
    )
    const projects = [
      {
        tag: 'synthetic-project',
        label: 'Synthetic project',
        net: 100,
        status: 'ended' as const,
        lastActivity: '2030-06-01',
      },
    ]
    const lowRunway = { ...runway, low: { date: '2030-06-20', balance: -1 } }
    const brief = buildBrief(
      today,
      rows,
      obligations,
      rec,
      series,
      projects,
      lowRunway,
      '2030-06-01T00:00:00Z',
    )
    expect(brief.weekOf).toBe('2030-06-17')
    expect(brief.notices).toHaveLength(6)
    expect(brief).toEqual(
      buildBrief(
        today,
        rows,
        obligations,
        rec,
        series,
        projects,
        lowRunway,
        '2030-06-01T00:00:00Z',
      ),
    )
    expect(
      brief.notices.every(
        (n) =>
          n.agentPrompt.includes(today) && n.agentPrompt.includes('SpendWise'),
      ),
    ).toBe(true)
  })
  it('guards category drift when uncategorized coverage is poor or six months unavailable', () => {
    const poor = rows.map((t) => ({ ...t, category_name: null }))
    expect(
      buildBrief(today, poor, [], [], series, [], runway, '2030-06-18').notices,
    ).toEqual([])
    expect(
      buildBrief(
        today,
        rows.slice(-2),
        [],
        [],
        series,
        [],
        runway,
        '2030-06-18',
      ).notices,
    ).toEqual([])
    const uuid = tx({
      id: 'synthetic-uuid',
      merchant: 'Synthetic subscription',
    })
    const brief = buildBrief(
      today,
      [uuid],
      [],
      recurringItems([recurring], [uuid], today),
      [],
      [],
      runway,
      null,
    )
    expect(
      brief.notices.find((n) => n.title.includes('subscription'))
        ?.evidenceTransactionIds,
    ).toEqual([])
    expect(
      brief.notices.find((n) => n.title.includes('subscription'))?.agentPrompt,
    ).toContain('synthetic-uuid')
  })
})
