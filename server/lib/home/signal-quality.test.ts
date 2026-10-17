import { describe, expect, it } from 'vitest'
import {
  assignPayments,
  detectObligations,
  mortgageObligation,
  obligationEvents,
  obligationTrail,
} from './obligations.js'
import { cardSettlementEvents } from './settlements.js'
import { cardIssuer, displayName } from './labels.js'
import { buildBrief } from './brief.js'
import { buildRunway } from './runway.js'
import { obligation, snapshot, tx } from './test-fixtures.js'
import type { Commitment, HomeTransaction } from './types.js'

const today = '2030-06-01'
const history = (merchant: string, amounts = [200, 200, 200]) =>
  amounts.map((amount, i) =>
    tx({
      id: `${merchant}-${i}`,
      merchant,
      amount: -amount,
      date: `2030-0${i + 3}-10`,
    }),
  )
const emptyRunway = buildRunway(today, 1, [], [])
const brief = (rows: HomeTransaction[], commitments: Commitment[] = []) =>
  buildBrief(today, rows, commitments, [], [], [], emptyRunway, today)

describe('home signal quality regressions', () => {
  it('keeps every supported issuer spelling out of obligations, including unflagged ledger rows', () => {
    for (const name of [
      'Leumi Visa',
      'ל.מאסטרקארד',
      'ל.מאסטרקרד(יש)',
      'לאומי ויזה',
      'Isracard',
      'ישראכרט',
      'Cal',
      'כאל',
      'Max',
      'מקס',
      'הבינלאומי כא-י',
    ]) {
      expect(cardIssuer(name), name).not.toBeNull()
      const rows = history(name)
      expect(detectObligations(rows, today), name).toEqual([])
      expect(
        obligationTrail(
          obligation({ matchPattern: name }),
          rows,
          ['2030-05'],
          today,
        ).trail[0].amount,
      ).toBeNull()
      expect(
        cardSettlementEvents(rows, today, '2030-06-30'),
        name,
      ).toMatchObject([{ kind: 'card', amount: -200 }])
    }
    expect(cardIssuer('דמי כרטיס ויזה')).toBeNull()
  })
  it('deduplicates normalized issuer/cycles without merging separate identified cards or doubling detail cycles', () => {
    const variants = [
      ...history('ל.מאסטרקארד'),
      ...history('ל.מאסטרקרד(יש)').map((t) => ({
        ...t,
        date: t.date.slice(0, 8) + '11',
      })),
    ]
    expect(cardSettlementEvents(variants, today, '2030-07-31')).toMatchObject([
      { date: '2030-06-10', amount: -200 },
      { date: '2030-07-10', amount: -200 },
    ])
    const repeated = [
      tx({
        id: 'equal-one',
        merchant: 'Visa',
        date: '2030-05-10',
        amount: -200,
      }),
      tx({
        id: 'equal-two',
        merchant: 'Visa',
        date: '2030-05-20',
        amount: -200,
      }),
    ]
    expect(cardSettlementEvents(repeated, today, '2030-06-30')[0].amount).toBe(
      -400,
    )
    const detail = tx({
      id: 'detail',
      date: '2030-05-01',
      amount: -200,
      account_label: 'Credit Card',
      notes: 'leumi account synthetic card 0000 cycle 2030-05',
    })
    expect(
      cardSettlementEvents([...variants, detail], today, '2030-06-30'),
    ).toHaveLength(1)
    expect(
      cardSettlementEvents(
        [...variants, tx({ merchant: 'ל.מאסטרקרד(יש)', date: today })],
        today,
        '2030-06-30',
      ),
    ).toEqual([])
    const cards = ['0000', '9999'].flatMap((suffix) => [
      tx({
        id: suffix + '-debit',
        merchant: 'Mastercard ' + suffix,
        date: '2030-05-10',
        amount: -200,
      }),
      {
        ...detail,
        id: suffix + '-detail',
        notes: `leumi account synthetic card ${suffix} cycle 2030-05`,
      },
    ])
    expect(cardSettlementEvents(cards, today, '2030-06-30')).toHaveLength(2)
  })
  it('filters fees, cash, small suggestions and internal transfers while retaining real standing commitments', () => {
    for (const name of [
      'עמלה',
      'עמל.ערוץ',
      'השלמת עמלת מינ',
      'Synthetic commission',
      'משיכת מזומן',
      'ATM withdrawal',
    ])
      expect(detectObligations(history(name), today), name).toEqual([])
    expect(
      detectObligations(
        history('Synthetic transfer').map((t) => ({ ...t, is_internal: 1 })),
        today,
      ),
    ).toEqual([])
    expect(
      detectObligations(history('Synthetic small order', [99, 99, 99]), today),
    ).toEqual([])
    expect(
      detectObligations(
        history('Synthetic small order', [99, 99, 99]),
        today,
        50,
      ),
    ).toHaveLength(1)
    expect(detectObligations(history('Synthetic order'), today, 250)).toEqual(
      [],
    )
    for (const name of [
      'Synthetic insurance',
      'Synthetic standing order',
      'Synthetic HOA',
      'Synthetic tuition',
      'Synthetic arnona',
      'Synthetic water',
      'Synthetic loan',
    ])
      expect(detectObligations(history(name), today), name).toHaveLength(1)
  })
  it('assigns mortgage/loan debits once, with individual days, CPI tolerance and no repeated runway payment', () => {
    const s = snapshot()
    s.mortgages.push({
      ...s.mortgages[0],
      mortgageKey: 'synthetic-second',
      lastPaymentAmount: 500,
      dayOfPayment: 10,
    })
    const mortgages = mortgageObligation(s, today)
    expect(mortgages.map((o) => [o.name, o.expectedAmount, o.dueDay])).toEqual([
      ['Mortgage 1', 200, 15],
      ['Mortgage 2', 500, 10],
    ])
    const rows = [
      tx({
        id: 'mortgage-one',
        date: '2030-05-16',
        merchant: 'Synthetic mortgage bank',
        category_name: 'Mortgage',
        amount: -218,
      }),
      tx({
        id: 'mortgage-two',
        date: '2030-05-12',
        merchant: 'פרעון הלוואה',
        category_name: null,
        amount: -530,
      }),
      tx({
        id: 'other-loan',
        date: '2030-05-10',
        merchant: 'פרעון הלוואה',
        category_name: null,
        amount: -900,
      }),
    ]
    const assigned = assignPayments(
      [
        ...mortgages,
        obligation({ id: 'loan', kind: 'loan', matchPattern: 'פרעון הלוואה' }),
      ],
      rows,
    )
    expect(assigned.map((o) => o.paymentIds)).toEqual([
      ['mortgage-one'],
      ['mortgage-two'],
      ['other-loan'],
    ])
    for (const o of assigned.slice(0, 2))
      expect(obligationTrail(o, rows, ['2030-05'], today)).toMatchObject({
        note: null,
        trail: [{ status: 'paid' }],
      })
    expect(
      obligationEvents(assigned.slice(0, 2), rows, '2030-05-16', '2030-05-31'),
    ).toEqual([])
    expect(
      obligationEvents(assigned.slice(0, 2), rows, today, '2030-06-30').map(
        (e) => e.kind,
      ),
    ).toEqual(['mortgage', 'mortgage'])
    const missing = assignPayments(mortgages, [rows[2]])
    expect(missing.every((o) => o.paymentIds?.length === 0)).toBe(true)
    // Two near-equal mortgages must not both consume the same eligible debit.
    const overlap = assignPayments(
      [mortgages[0], { ...mortgages[0], id: 'overlap' }],
      [rows[0]],
    )
    expect(overlap.flatMap((o) => o.paymentIds!)).toHaveLength(1)
  })
  it('requires stable prior history or a confirmed expected amount and uses the absolute/relative threshold', () => {
    const variable = [
      ...history('Synthetic water', [200, 350, 120]),
      tx({
        id: 'june',
        merchant: 'Synthetic water',
        date: '2030-06-10',
        amount: -450,
      }),
    ]
    const o = obligation({
      matchPattern: 'Synthetic water',
      expectedAmount: 200,
    })
    const result = obligationTrail(o, variable, ['2030-06'], '2030-06-20')
    expect(result).toMatchObject({
      note: null,
      trail: [{ status: 'paid', amount: 450 }],
    })
    expect(brief(variable, [result]).notices).toEqual([])
    const stable = [...history('Synthetic water'), variable.at(-1)!]
    expect(
      obligationTrail(o, stable, ['2030-06'], '2030-06-20').note,
    ).toContain('₪250')
    const check = (expected: number, actual: number) =>
      obligationTrail(
        { ...o, confirmed: true, expectedAmount: expected },
        [tx({ merchant: o.matchPattern, amount: -actual })],
        ['2030-06'],
        '2030-06-20',
      )
    expect(check(200, 220).note).toBeNull()
    expect(check(200, 221).note).not.toBeNull()
    expect(check(1000, 1050).note).toBeNull()
    expect(check(1000, 1051).note).not.toBeNull()
    expect(
      obligationEvents(
        [{ ...o, confirmed: true }],
        [variable.at(-1)!],
        '2030-06-10',
        '2030-06-30',
      ),
    ).toEqual([])
  })
  it('counts recent transaction coverage, excluding current/old months, income, internal rows and card settlements', () => {
    const rows = [
      tx({
        id: 'uncat-small',
        date: '2030-03-01',
        amount: -1,
        category_name: null,
      }),
      tx({ id: 'cat-large', date: '2030-05-31', amount: -9999 }),
      tx({ date: today, category_name: null }),
      tx({ date: '2030-02-28', category_name: null }),
      tx({ date: '2030-05-10', category_name: null, is_internal: 1 }),
      tx({ date: '2030-05-10', category_name: null, merchant: 'Visa' }),
      tx({ date: '2030-05-10', category_name: null, amount: 100 }),
    ]
    const b = brief(rows)
    expect(b.coverage.uncategorizedShare).toBe(0.5)
    expect(b.notices.map((n) => n.title)).toEqual([
      '50% of recent transactions are uncategorized',
    ])
    expect(b.notices[0].agentPrompt).toContain('Categorize')
    expect(b.notices[0].agentPrompt).toContain('uncat-small')
    expect(b.notices[0].body).not.toContain('uncat-small')
    expect(b.headline).toBe('All good.')
  })
  it('uses the six-month count threshold for drift, independently of recent coverage and amount sizes', () => {
    const series = [
      {
        id: 'synthetic',
        name: 'Synthetic category',
        points: [100, 100, 100, 500, 500, 500],
      },
    ]
    const rows = Array.from({ length: 10 }, (_, i) =>
      tx({
        id: String(i + 1),
        date: i < 5 ? '2029-12-10' : '2030-05-10',
        category_name: i < 3 ? null : 'Utilities',
        amount: i < 3 ? -10000 : -1,
      }),
    )
    const run = (r: HomeTransaction[]) =>
      buildBrief(today, r, [], [], series, [], emptyRunway, today)
    expect(run(rows).notices[0].title).toBe(
      '\u2068Synthetic category\u2069 spending changed',
    ) // exactly 30%, despite the amount share
    rows[3].category_name = null
    const suppressed = run(rows)
    expect(suppressed.notices.map((n) => n.title)).toEqual([
      '0% of recent transactions are uncategorized',
    ])
    expect(suppressed.coverage.uncategorizedShare).toBe(0)
  })
  it('merges related findings, caps notices, sorts severity/impact and counts only actionable notices', () => {
    const mismatch = (id: string, amount: number) =>
      obligationTrail(
        obligation({ id, name: 'Synthetic commitment', confirmed: true }),
        [tx({ amount: -amount })],
        ['2030-06'],
        '2030-06-20',
      )
    const rec = [
      {
        merchant: 'Synthetic subscription',
        amount: 1297.25,
        cadence: 'monthly' as const,
        annualized: 15567,
        lastSeen: today,
        flag: 'new' as const,
        flagDetail: null,
      },
    ]
    const b = buildBrief(
      today,
      history('Synthetic order'),
      [mismatch('synthetic-id-one', 250), mismatch('synthetic-id-two', 1000)],
      rec,
      [{ id: 'a', name: 'Utilities', points: [100, 100, 100, 500, 500, 500] }],
      [
        {
          tag: 'example',
          label: 'Synthetic project',
          net: 2222.22,
          status: 'ended',
          lastActivity: today,
        },
      ],
      { ...emptyRunway, low: { date: '2030-06-20', balance: -1234.56 } },
      null,
    )
    expect(b.notices).toHaveLength(5)
    expect(b.notices.map((n) => n.severity)).toEqual([
      'action',
      'watch',
      'watch',
      'info',
      'info',
    ])
    expect(b.notices[1].title).toBe('2 commitment payments differ')
    expect(b.headline).toBe('3 things worth a look.')
    expect(b.notices[0].body).toContain('-₪1,235')
    expect(b.notices.some((n) => n.body.includes('2222.22'))).toBe(false)
    expect(b.notices[1].agentPrompt).toContain('synthetic-id-one')
    // Body names are labels, not internal obligation IDs in normal API usage.
    expect(b.notices[1].body).not.toContain('synthetic-id-one')
  })
  it('retains the categorization notice when six merged findings compete for five slots', () => {
    const mismatch = obligationTrail(
      obligation({ confirmed: true }),
      [tx({ amount: -250 })],
      ['2030-06'],
      '2030-06-20',
    )
    const b = buildBrief(
      today,
      history('Synthetic unknown').map((t) => ({
        ...t,
        category_name: null,
        amount: -1,
      })),
      [mismatch],
      [
        {
          merchant: 'Synthetic subscription',
          amount: 3000,
          cadence: 'monthly',
          annualized: 36000,
          lastSeen: today,
          flag: 'new',
          flagDetail: null,
        },
      ],
      [],
      [
        {
          tag: 'example',
          label: 'Synthetic project',
          net: 5000,
          status: 'ended',
          lastActivity: today,
        },
      ],
      { ...emptyRunway, low: { date: '2030-06-20', balance: -500 } },
      null,
    )
    expect(b.notices).toHaveLength(5)
    expect(b.notices.some((n) => n.title.includes('uncategorized'))).toBe(true)
    expect(b.headline).toBe('3 things worth a look.')
  })
  it('uses aliases for obligation/card/salary labels, preserving raw matching and unmatched Hebrew', () => {
    const aliases = [
      {
        raw_pattern: 'Synthetic raw',
        canonical_name: 'Synthetic display',
        match_type: 'contains',
      },
    ]
    expect(displayName('Synthetic raw order', aliases)).toBe(
      'Synthetic display',
    )
    expect(displayName('ועד בית לדוגמה', aliases)).toBe('ועד בית לדוגמה')
    const rows = history('Synthetic raw order').map((t) => ({
      ...t,
      display_name: displayName(t.merchant, aliases),
    }))
    const o = detectObligations(rows, today)[0]
    expect(o).toMatchObject({
      name: 'Synthetic display',
      matchPattern: 'Synthetic raw order',
    })
    expect(obligationEvents([o], rows, today, '2030-06-30')[0].label).toBe(
      'Synthetic display',
    )
    expect(
      cardSettlementEvents(
        history('Visa').map((t) => ({
          ...t,
          display_name: 'Synthetic card display',
        })),
        today,
        '2030-06-30',
      )[0].label,
    ).toBe('Synthetic card display')
  })
})
