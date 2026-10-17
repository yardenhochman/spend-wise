import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Express, Request, Response, RequestHandler } from 'express'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { migrateMerchantLabels } from '../lib/merchant-labels.js'
import { mountHomeRoutes } from './home.js'
import { config, snapshot } from '../lib/home/test-fixtures.js'
import { extractBalances, persistBalances } from '../lib/home/balances.js'
import {
  homeContext,
  homeProjects,
  storedObligations,
  type HomeDeps,
} from '../lib/home/service.js'
let db: Database.Database
let app: Express
let deps: HomeDeps
function request<T = Record<string, unknown>>(
  method: string,
  url: string,
  body?: unknown,
  query: Record<string, string> = {},
) {
  const routes = (
    app as unknown as {
      _router: {
        stack: {
          route?: {
            path: string
            methods: Record<string, boolean>
            stack: { handle: RequestHandler }[]
          }
        }[]
      }
    }
  )._router.stack
  const route = routes.find(
    (r) => r.route?.path === url && r.route.methods[method],
  )?.route
  if (!route) throw new Error('Missing route ' + url)
  const json = vi.fn()
  const end = vi.fn()
  const result = { status: 200, data: undefined as T | undefined }
  const res = {
    json: (data: T) => {
      result.data = data
      json(data)
    },
    status: (code: number) => {
      result.status = code
      return res
    },
    end,
  }
  route.stack[0].handle(
    {
      query,
      body,
      params: { id: query.id, month: query.month },
    } as unknown as Request,
    res as unknown as Response,
    (error: unknown) => {
      if (error) throw error
    },
  )
  expect(json.mock.calls.length + end.mock.calls.length).toBe(1)
  return result
}
function insert(
  id: string,
  date: string,
  merchant = 'Synthetic standing order',
  amount = -100,
  account = 'checking',
  category = 'utilities',
  notes: string | null = 'scraper account 111-22222_33',
  internal = 0,
) {
  db.prepare(
    "INSERT INTO transactions (id,date,merchant,amount,currency,account_id,category_id,source_file_id,raw_hash,notes,is_internal,is_recurring_candidate) VALUES (?,?,?,?,'ILS',?,?,'file',?,?,?,1)",
  ).run(id, date, merchant, amount, account, category, id, notes, internal)
}
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(
    readFileSync(new URL('../db/sqlite-schema.sql', import.meta.url), 'utf8'),
  )
  db.exec(`ALTER TABLE transactions ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;
    INSERT INTO accounts VALUES ('checking','Leumi','Checking','ILS'),('card','Leumi','Credit Card','ILS'),('committee','Other Bank','Committee','ILS');
    INSERT INTO categories (id,name) VALUES ('utilities','Utilities'),('salary','Salary'),('mortgage','Mortgage'),('wedding','Wedding');
    INSERT INTO statement_files VALUES ('file','synthetic','synthetic','2030-06-17T00:00:00Z','synthetic','completed');`)
  migrateMerchantLabels(db)
  deps = {
    db,
    config,
    today: () => '2030-06-18',
    mortgage: () => null,
    routineFilter: () => ({
      sql: "AND (t.category_id IS NULL OR t.category_id NOT IN ('mortgage','wedding'))",
      params: [],
      includeInternal: false,
    }),
  }
  app = express()
  mountHomeRoutes(app, deps)
})
afterEach(() => db.close())
describe('home route contract', () => {
  it('preserves payment trails and rules through confirmation-only API writes and merchant renames', () => {
    for (const [id, date, amount] of [
      ['march', '2030-03-10', -100],
      ['april', '2030-04-10', -170],
      ['may', '2030-05-10', -120],
      ['june', '2030-06-01', -130],
    ] as const)
      insert(id, date, 'Synthetic variable service', amount)
    const original = homeContext(deps).obligations[0]
    const get = () =>
      request<{ obligations: { id: string; trail: unknown }[] }>(
        'get',
        '/api/home/commitments',
      ).data!.obligations.find((o) => o.id === original.id)!.trail
    const before = get()
    request('put', '/api/merchant-labels', {
      rawMerchant: original.matchPattern,
      label: 'New display name',
    })
    for (const confirmed of [true, false, true]) {
      expect(
        request(
          'put',
          '/api/obligations/:id',
          { confirmed },
          { id: original.id },
        ).status,
      ).toBe(200)
      expect(get()).toEqual(before)
      const fresh = homeContext(deps).obligations.find(
        (o) => o.id === original.id,
      )!
      expect(fresh.paymentIds).toEqual(original.paymentIds)
      expect(fresh.matchPattern).toBe(original.matchPattern)
    }
  })
  it('keeps individual card cycles, suggested/confirmed checking bills and mortgages with no balance', () => {
    for (const m of ['2030-03', '2030-04', '2030-05']) {
      insert(
        `visa-${m}`,
        `${m}-${m === '2030-05' ? '22' : '02'}`,
        'Visa',
        -600,
        'checking',
        'utilities',
        undefined,
        1,
      )
      insert(`building-${m}`, `${m}-21`, 'Synthetic building management', -150)
      insert(`internet-${m}`, `${m}-25`, 'Synthetic internet service', -120)
      insert(`loan-${m}`, `${m}-24`, 'Synthetic loan repayment', -250)
    }
    // An early issuer debit is not evidence that the three detailed cycles are paid.
    insert('early-mastercard', '2030-06-02', 'ל.מאסטרקארד', -77)
    for (const [i, suffix] of ['0000', '8888', '9999'].entries())
      insert(
        `cycle-${i}`,
        '2030-06-05',
        'Synthetic purchase',
        -(i + 1) * 100,
        'card',
        'utilities',
        `leumi account 111-22222_33 card ${suffix} cycle 2030-06`,
      )
    const mortgage = snapshot()
    mortgage.mortgages[0].dayOfPayment = 22
    mortgage.mortgages.push({
      ...mortgage.mortgages[0],
      mortgageKey: 'synthetic-second',
      dayOfPayment: 23,
      lastPaymentAmount: 500,
    })
    deps.mortgage = () => mortgage
    request('post', '/api/obligations', {
      name: 'Synthetic confirmed bill',
      expectedAmount: 50,
      dueDay: 26,
    })
    const result = request<{
      openingBalance: number | null
      days: unknown[]
      events: {
        date: string
        kind: string
        label: string
        amount: number
        estimated: boolean
      }[]
    }>('get', '/api/home/runway', undefined, { days: '14' }).data!
    expect(result.openingBalance).toBeNull()
    expect(result.days).toEqual([])
    expect(result.events.filter((e) => e.kind === 'card')).toEqual(
      [100, 200, 300].map((amount, i) => ({
        date: '2030-06-22',
        kind: 'card',
        label: `Card ${i + 1} bill`,
        amount: -amount,
        estimated: true,
      })),
    )
    expect(
      result.events
        .filter((e) => e.kind === 'mortgage')
        .map((e) => [e.date, e.label]),
    ).toEqual([
      ['2030-06-22', 'Mortgage 1'],
      ['2030-06-23', 'Mortgage 2'],
    ])
    expect(
      result.events
        .filter((e) => e.kind === 'obligation')
        .map((e) => [e.date, e.label]),
    ).toEqual([
      ['2030-06-21', 'Synthetic building management'],
      ['2030-06-24', 'Synthetic loan repayment'],
      ['2030-06-25', 'Synthetic internet service'],
      ['2030-06-26', 'Synthetic confirmed bill'],
    ])
    expect(
      homeContext(deps).obligations.some((o) => /Visa|מאסטר/.test(o.name)),
    ).toBe(false)
    expect(result.events).toHaveLength(9)
    insert(
      'paid-card-cycle',
      '2030-06-10',
      'Visa 8888',
      -200,
      'checking',
      'utilities',
      undefined,
      1,
    )
    const afterPayment = request<{
      events: { kind: string; amount: number }[]
    }>('get', '/api/home/runway', undefined, { days: '14' }).data!
    expect(
      afterPayment.events.filter((e) => e.kind === 'card').map((e) => e.amount),
    ).toEqual([-100, -300])
  })
  it('forecasts two same-description salary streams separately, including banking delays', () => {
    for (const [i, m] of ['2030-03', '2030-04', '2030-05'].entries()) {
      insert(
        `salary-a-${m}`,
        `${m}-0${i === 1 ? 2 : 1}`,
        'Synthetic salary transfer',
        1000,
        'checking',
        'salary',
      )
      insert(
        `salary-b-${m}`,
        `${m}-09`,
        'Synthetic salary transfer',
        2000,
        'checking',
        'salary',
      )
    }
    deps.today = () => '2030-06-05'
    insert(
      'salary-a-current',
      '2030-06-01',
      'Synthetic salary transfer',
      1000,
      'checking',
      'salary',
    )
    const result = request<{
      events: { date: string; kind: string; label: string; amount: number }[]
    }>('get', '/api/home/runway').data!
    expect(result.events).toEqual(
      [
        {
          date: '2030-06-09',
          label: 'Salary 2',
          rawMerchant: 'Synthetic salary transfer',
          amount: 2000,
          kind: 'salary',
          estimated: true,
        },
        {
          date: '2030-07-01',
          label: 'Salary 1',
          rawMerchant: 'Synthetic salary transfer',
          amount: 1000,
          kind: 'salary',
          estimated: true,
        },
        {
          date: '2030-07-09',
          label: 'Salary 2',
          rawMerchant: 'Synthetic salary transfer',
          amount: 2000,
          kind: 'salary',
          estimated: true,
        },
      ].filter((e) => e.date >= deps.today()),
    )
  })

  it('returns all four empty shapes, null balance and no GET writes', () => {
    const before = db.prepare('SELECT total_changes() AS n').get()
    const runway = request('get', '/api/home/runway').data
    expect(runway).toMatchObject({
      openingBalance: null,
      balanceAsOf: null,
      days: [],
      events: [],
      low: null,
      nextSalary: null,
    })
    expect(request('get', '/api/home/commitments').data).toMatchObject({
      months: expect.any(Array),
      obligations: [],
      repayments: [],
      recurring: { annualTotal: 0, items: [] },
    })
    expect(request('get', '/api/home/brief').data).toMatchObject({
      weekOf: '2030-06-17',
      notices: expect.any(Array),
      coverage: { uncategorizedShare: 0, lastImportAt: null },
    })
    expect(request('get', '/api/home/projects').data).toEqual({ projects: [] })
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before)
  })
  it('rejects invalid windows and bounds', () => {
    for (const value of ['0', '367', '-1', '1.5', 'bad'])
      expect(
        request('get', '/api/home/runway', undefined, { days: value }).status,
      ).toBe(400)
    expect(
      request('get', '/api/home/commitments', undefined, { months: '37' })
        .status,
    ).toBe(400)
  })
  it('excludes committee, nonroutine categories, and internal income while forecasting household salary', () => {
    for (const m of ['2030-04', '2030-05']) {
      insert(
        'salary' + m,
        m + '-25',
        'Synthetic employer',
        1000,
        'checking',
        'salary',
      )
      insert(
        'bad' + m,
        m + '-25',
        'Synthetic committee salary',
        9999,
        'committee',
        'salary',
      )
      insert(
        'internal' + m,
        m + '-25',
        'Synthetic internal salary',
        8888,
        'checking',
        'salary',
        null,
        1,
      )
    }
    insert(
      'project',
      '2030-06-01',
      'Synthetic project charge',
      -500,
      'checking',
      'wedding',
    )
    const balances = extractBalances(
      {
        accounts: [
          { accountNumber: '111-22222_33', balance: 0 },
          { accountNumber: '999-00000_11', balance: 1000 },
        ],
      },
      '2030-06-18',
      config,
    )
    persistBalances(db, balances, '2030-06-18')
    const result = request<{
      events: { amount: number }[]
      accounts: { label: string }[]
      openingBalance: number
      days: unknown[]
    }>('get', '/api/home/runway', undefined, { days: '10' }).data!
    expect(result.openingBalance).toBe(0)
    expect(result.accounts).toEqual([
      { label: 'Checking 1', balance: 0, asOf: '2030-06-18T00:00:00.000Z' },
    ])
    expect(result.days).toHaveLength(10)
    expect(result.events.map((e) => e.amount)).toEqual([1000])
  })
  it('computes suggestions without writing and supports confirm/update/delete with durable suppression', () => {
    for (const m of ['2030-03', '2030-04', '2030-05']) insert(m, m + '-10')
    const before = db.prepare('SELECT total_changes() AS n').get()
    const initial = request<{
      obligations: { id: string; confirmed: boolean }[]
    }>('get', '/api/home/commitments').data!
    expect(initial.obligations).toHaveLength(1)
    expect(initial.obligations[0].confirmed).toBe(false)
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before)
    const id = initial.obligations[0].id
    expect(
      request('put', '/api/obligations/:id', { confirmed: true }, { id })
        .status,
    ).toBe(200)
    expect(storedObligations(db).obligations[0].confirmed).toBe(true)
    expect(
      request('put', '/api/obligations/:id', { expectedAmount: 120 }, { id })
        .data,
    ).toMatchObject({ expectedAmount: 120 })
    expect(
      request('delete', '/api/obligations/:id', undefined, { id }).status,
    ).toBe(204)
    expect(request('get', '/api/home/commitments').data).toMatchObject({
      obligations: [],
    })
  })
  it('dismisses a never-confirmed suggestion durably, without recreating it on fresh GETs', () => {
    for (const m of ['2030-03', '2030-04', '2030-05']) insert(m, m + '-10')
    const id = homeContext(deps).obligations[0].id
    expect(
      request('delete', '/api/obligations/:id', undefined, { id }).status,
    ).toBe(204)
    expect(storedObligations(db).deleted).toContain(id)
    expect(homeContext(deps).obligations).toEqual([])
    expect(request('get', '/api/home/commitments').data).toMatchObject({
      obligations: [],
    })
  })
  it('puts stable card-paid building fees in HOA obligations only, retaining other recurring services', () => {
    db.exec(
      "INSERT INTO categories (id,name) VALUES ('housing','Housing'),('subscriptions','Subscriptions')",
    )
    for (const m of ['2030-03', '2030-04', '2030-05']) {
      insert(
        'hoa' + m,
        m + '-10',
        'Synthetic building management',
        -200,
        'card',
        'housing',
      )
      insert(
        'subscription' + m,
        m + '-10',
        'Synthetic service',
        -25,
        'card',
        'subscriptions',
      )
    }
    const data = request<{
      obligations: { id: string; kind: string }[]
      recurring: { items: { merchant: string }[] }
    }>('get', '/api/home/commitments').data!
    expect(data.obligations).toHaveLength(1)
    expect(data.obligations[0].kind).toBe('hoa')
    expect(data.recurring.items.map((r) => r.merchant)).toEqual([
      'Synthetic service',
    ])
    request('delete', '/api/obligations/:id', undefined, {
      id: data.obligations[0].id,
    })
    expect(homeContext(deps).obligations).toEqual([])
  })
  it('creates camelCase entities and validates all mutation fields and missing ids', () => {
    const created = request('post', '/api/obligations', {
      name: 'Synthetic manual bill',
      expectedAmount: 100,
    }).data!
    expect(created).toMatchObject({
      id: expect.any(String),
      name: 'Synthetic manual bill',
      confirmed: true,
      dueDay: 1,
      cadence: 'monthly',
      expectedAmount: 100,
    })
    for (const body of [
      {},
      { name: '' },
      { name: 'x', expectedAmount: -1 },
      { name: 'x', dueDay: 32 },
      { name: 'x', kind: 'invalid' },
      { name: 'x', extra: true },
    ])
      expect(request('post', '/api/obligations', body).status).toBe(400)
    expect(
      request('put', '/api/obligations/:id', {}, { id: 'missing' }).status,
    ).toBe(400)
    expect(
      request(
        'put',
        '/api/obligations/:id',
        { confirmed: true },
        { id: 'missing' },
      ).status,
    ).toBe(404)
    expect(
      request('delete', '/api/obligations/:id', undefined, { id: 'missing' })
        .status,
    ).toBe(404)
  })
  it('reads mortgage repayments and obligations from normalized private snapshots only', () => {
    deps.mortgage = snapshot
    const result = request<{ repayments: unknown[]; obligations: unknown[] }>(
      'get',
      '/api/home/commitments',
    ).data!
    expect(result.repayments).toHaveLength(1)
    expect(result.obligations).toHaveLength(1)
  })
  it('reuses tag-summary costs, refunds and explicit end date, including project categories', () => {
    db.exec(
      "INSERT INTO tags VALUES ('project','Synthetic project',NULL); INSERT INTO tag_profiles VALUES ('project','2030-06-01','2030-06-10',NULL)",
    )
    insert(
      'purchase',
      '2030-06-01',
      'Synthetic project expense',
      -200,
      'checking',
      'wedding',
    )
    insert(
      'refund',
      '2030-06-02',
      'Synthetic refund',
      50,
      'checking',
      'wedding',
    )
    insert(
      'committee',
      '2030-06-03',
      'Synthetic other account',
      -900,
      'committee',
      'wedding',
    )
    db.exec(
      "INSERT INTO transaction_tags VALUES ('purchase','project'),('refund','project'),('committee','project')",
    )
    expect(homeProjects(deps, homeContext(deps))).toEqual({
      projects: [
        {
          tag: 'Synthetic project',
          label: 'Synthetic project',
          net: 150,
          status: 'ended',
          lastActivity: '2030-06-02',
        },
      ],
    })
    expect(request('get', '/api/home/projects').data).toEqual(
      homeProjects(deps, homeContext(deps)),
    )
  })
})

describe('home signal quality integration', () => {
  it('matches routine household coverage to a direct SQL count and resolves aliases without GET writes', () => {
    db.exec(
      "INSERT INTO merchant_aliases VALUES ('synthetic-alias','Synthetic raw','Synthetic display','contains','seed')",
    )
    for (const m of ['2030-03', '2030-04', '2030-05']) {
      insert('known' + m, m + '-10', 'Synthetic raw order', -900)
      insert('unknown' + m, m + '-12', 'Synthetic unknown', -1)
      db.prepare('UPDATE transactions SET category_id=NULL WHERE id=?').run(
        'unknown' + m,
      )
      insert('card' + m, m + '-10', 'Synthetic Visa', -300)
      insert(
        'committee' + m,
        m + '-10',
        'Synthetic committee',
        -100,
        'committee',
      )
      insert(
        'internal' + m,
        m + '-10',
        'Synthetic transfer',
        -100,
        'checking',
        'utilities',
        null,
        1,
      )
      insert(
        'excluded' + m,
        m + '-10',
        'Synthetic project',
        -100,
        'checking',
        'wedding',
      )
      insert('income' + m, m + '-10', 'Synthetic income', 100)
    }
    insert('current', '2030-06-01', 'Synthetic raw order')
    insert('old', '2030-02-28', 'Synthetic raw order')
    const direct = db
      .prepare(
        "SELECT CAST(SUM(category_id IS NULL) AS REAL)/COUNT(*) AS share FROM transactions WHERE account_id='checking' AND date>='2030-03-01' AND date<'2030-06-01' AND amount<0 AND is_internal=0 AND (category_id IS NULL OR category_id NOT IN ('wedding','mortgage')) AND merchant NOT LIKE '%Visa%'",
      )
      .get() as { share: number }
    const before = db.prepare('SELECT total_changes() AS n').get()
    const result = request<{ coverage: { uncategorizedShare: number } }>(
      'get',
      '/api/home/brief',
    ).data!
    expect(result.coverage.uncategorizedShare).toBe(direct.share)
    expect(direct.share).toBe(0.5)
    const commitments = request<{ obligations: { name: string }[] }>(
      'get',
      '/api/home/commitments',
    ).data!
    expect(commitments.obligations.map((o) => o.name)).toContain(
      'Synthetic display',
    )
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before)
    const id = homeContext(deps).obligations.find(
      (o) => o.name === 'Synthetic display',
    )!.id
    const updated = request(
      'put',
      '/api/obligations/:id',
      { confirmed: true },
      { id },
    ).data!
    expect(updated).not.toHaveProperty('paymentIds')
  })
  it('reserves individually matched mortgages before detecting residual loan suggestions', () => {
    const s = snapshot()
    s.mortgages.push({
      ...s.mortgages[0],
      mortgageKey: 'synthetic-second',
      lastPaymentAmount: 500,
      dayOfPayment: 10,
    })
    deps.mortgage = () => s
    for (const m of ['2030-03', '2030-04', '2030-05']) {
      insert(
        'mortgage' + m,
        m + '-15',
        'Synthetic mortgage bank',
        -210,
        'checking',
        'mortgage',
      )
      insert('mortgage-loan' + m, m + '-10', 'Synthetic loan repayment', -520)
      insert('other-loan' + m, m + '-10', 'Synthetic loan repayment', -900)
    }
    const ctx = homeContext(deps)
    expect(ctx.obligations.map((o) => [o.kind, o.expectedAmount])).toEqual([
      ['loan', 900],
      ['mortgage', 200],
      ['mortgage', 500],
    ])
    const ids = ctx.obligations.flatMap((o) => o.paymentIds!)
    expect(ids).toHaveLength(9)
    expect(new Set(ids).size).toBe(9)
    const commitments = request<{
      obligations: {
        trail: { month: string; status: string }[]
        kind: string
      }[]
    }>('get', '/api/home/commitments').data!
    for (const o of commitments.obligations.filter(
      (o) => o.kind === 'mortgage',
    ))
      expect(o.trail.find((t) => t.month === '2030-05')!.status).toBe('paid')
  })
})

describe('merchant labels', () => {
  const raw = 'Synthetic bank utility'
  function history() {
    for (const month of ['03', '04', '05'])
      insert(`utility-${month}`, `2030-${month}-22`, raw, -150)
  }
  it('upserts normalized exact user labels ahead of seeded aliases and clears back to seeds', () => {
    history()
    db.prepare(
      "INSERT INTO merchant_aliases (id,raw_pattern,canonical_name,match_type) VALUES ('seed',?,'Seed utility','contains')",
    ).run(raw)
    const label = (value: string) =>
      request('put', '/api/merchant-labels', {
        rawMerchant: `  ${raw.toUpperCase()}  כרטיס 123 `,
        label: value,
      })
    expect(label('Friendly utility').status).toBe(200)
    expect(label('Home electricity').status).toBe(200)
    expect(
      db.prepare("SELECT * FROM merchant_aliases WHERE source='user'").all(),
    ).toHaveLength(1)
    const data = request<{
      obligations: { name: string; rawMerchant: string }[]
    }>('get', '/api/home/commitments').data!
    expect(data.obligations[0]).toMatchObject({
      name: 'Home electricity',
      rawMerchant: raw,
    })
    // A later import needs no rewriting or backfill to acquire the label.
    insert('new-utility', '2030-06-01', raw.toUpperCase() + ' כרטיס 999', -150)
    expect(
      homeContext(deps).all.find((t) => t.id === 'new-utility')?.display_name,
    ).toBe('Home electricity')
    request('delete', '/api/merchant-labels', { rawMerchant: raw })
    expect(
      homeContext(deps).rows.find((t) => t.id === 'utility-03')?.display_name,
    ).toBe('Seed utility')
    expect(
      request('put', '/api/merchant-labels', { rawMerchant: raw, label: '  ' })
        .status,
    ).toBe(400)
    expect(
      request('put', '/api/merchant-labels', { rawMerchant: '', label: 'Test' })
        .status,
    ).toBe(400)
    expect(request('delete', '/api/merchant-labels', {}).status).toBe(400)
  })
  it('labels Runway, recurring and Brief; confirmation keeps following merchant labels', () => {
    history()
    request('put', '/api/merchant-labels', {
      rawMerchant: raw,
      label: 'Home electricity',
    })
    const o = homeContext(deps).obligations[0]
    request('put', '/api/obligations/:id', { confirmed: true }, { id: o.id })
    request('put', '/api/merchant-labels', {
      rawMerchant: raw,
      label: 'Our electricity',
    })
    expect(homeContext(deps).obligations[0].name).toBe('Our electricity')
    expect(
      request<{ events: { label: string; rawMerchant: string }[] }>(
        'get',
        '/api/home/runway',
      ).data?.events,
    ).toContainEqual(
      expect.objectContaining({ label: 'Our electricity', rawMerchant: raw }),
    )
    for (const month of ['03', '04', '05'])
      insert(
        `sub-${month}`,
        `2030-${month}-12`,
        'GOOGLE YOUTUBEPREMIUM',
        -25,
        'card',
        'utilities',
      )
    request('put', '/api/merchant-labels', {
      rawMerchant: 'GOOGLE YOUTUBEPREMIUM',
      label: 'Our videos',
    })
    expect(
      request<{ recurring: { items: { merchant: string }[] } }>(
        'get',
        '/api/home/commitments',
      ).data?.recurring.items,
    ).toContainEqual(expect.objectContaining({ merchant: 'Our videos' }))
    expect(JSON.stringify(request('get', '/api/home/brief').data)).toContain(
      'Our videos',
    )
  })
  it('renames a computed suggestion, confirms and persists its own name ahead of merchant labels', () => {
    history()
    const original = homeContext(deps).obligations[0]
    const saved = request(
      'put',
      '/api/obligations/:id',
      { name: 'Visa household bill' },
      { id: original.id },
    )
    expect(saved.data).toMatchObject({
      name: 'Visa household bill',
      confirmed: true,
      matchPattern: raw,
    })
    request('put', '/api/merchant-labels', {
      rawMerchant: raw,
      label: 'Shared merchant label',
    })
    const fresh = homeContext(deps).obligations[0]
    expect(fresh).toMatchObject({
      id: original.id,
      name: 'Visa household bill',
      confirmed: true,
      matchPattern: raw,
    })
    expect(fresh.paymentIds).toEqual(original.paymentIds)
    expect(storedObligations(db).obligations).toHaveLength(1)
  })
})

describe('payee rules and manual month API', () => {
  it('round-trips multiple rules and source fields, and marks/clears months idempotently', () => {
    insert('old', '2030-04-10', 'Example Management', -100, 'card')
    insert(
      'new',
      '2030-06-10',
      'הע. אינטרנט',
      -250,
      'checking',
      'utilities',
      'scraper account 111-22222_33; העברה אל: Example Committee 88-222-00099',
    )
    deps.today = () => '2030-04-01'
    const made = request<{ id: string }>('post', '/api/obligations', {
      name: 'Example building fee',
      kind: 'hoa',
      expectedAmount: 250,
      matchingRules: [
        { pattern: 'Example Management', expectedAmount: 100 },
        {
          pattern: 'הע. אינטרנט',
          payee: 'Example Committee',
          expectedAmount: 250,
          effectiveFrom: '2030-06',
        },
      ],
    })
    deps.today = () => '2030-06-18'
    const id = made.data!.id
    expect(made.status).toBe(201)
    expect(
      request('put', '/api/obligations/:id', { confirmed: true }, { id })
        .status,
    ).toBe(200)
    expect(storedObligations(db).obligations[0].matchingRules).toHaveLength(2)
    const trail = () =>
      request<
        ReturnType<typeof import('../lib/home/service.js').homeCommitments>
      >('get', '/api/home/commitments').data!.obligations.find(
        (o) => o.id === id,
      )!.trail
    expect(trail().find((t) => t.month === '2030-04')).toMatchObject({
      status: 'paid',
      amount: 100,
    })
    expect(trail().find((t) => t.month === '2030-06')).toMatchObject({
      status: 'paid',
      amount: 250,
      payments: [{ payee: 'Example Committee' }],
    })
    for (let i = 0; i < 2; i++)
      expect(
        request(
          'put',
          '/api/obligations/:id/months/:month',
          { status: 'paid', note: 'Settled separately' },
          { id, month: '2030-05' },
        ).status,
      ).toBe(200)
    expect(trail().find((t) => t.month === '2030-05')).toMatchObject({
      status: 'paid',
      markedByYou: true,
      manualNote: 'Settled separately',
      amount: null,
    })
    for (let i = 0; i < 2; i++)
      expect(
        request(
          'put',
          '/api/obligations/:id/months/:month',
          { status: 'clear' },
          { id, month: '2030-05' },
        ).status,
      ).toBe(200)
    expect(trail().find((t) => t.month === '2030-05')?.status).toBe('late')
    request(
      'put',
      '/api/obligations/:id/months/:month',
      { status: 'paid' },
      { id, month: '2030-06' },
    )
    request(
      'put',
      '/api/obligations/:id/months/:month',
      { status: 'clear' },
      { id, month: '2030-06' },
    )
    expect(trail().find((t) => t.month === '2030-06')).toMatchObject({
      status: 'paid',
      amount: 250,
    })
    expect(
      request(
        'put',
        '/api/obligations/:id',
        {
          paidFrom: 'untracked',
          paidFromLabel: 'Other account',
          paidFromSince: '2030-05',
        },
        { id },
      ).status,
    ).toBe(200)
    expect(trail().find((t) => t.month === '2030-05')?.status).toBe('external')
    expect(trail().find((t) => t.month === '2030-04')?.status).toBe('paid')
    expect(storedObligations(db).obligations[0].paidFromLabel).toBe(
      'Other account',
    )
    for (const month of ['2030-13', 'bad', '2030-00'])
      expect(
        request(
          'put',
          '/api/obligations/:id/months/:month',
          { status: 'paid' },
          { id, month },
        ).status,
      ).toBe(400)
    expect(
      request(
        'put',
        '/api/obligations/:id/months/:month',
        { status: 'invalid' },
        { id, month: '2030-05' },
      ).status,
    ).toBe(400)
    expect(
      request(
        'put',
        '/api/obligations/:id/months/:month',
        { status: 'paid' },
        { id: 'missing', month: '2030-05' },
      ).status,
    ).toBe(404)
  })
})

it('does not redetect payee groups already covered by an alternative saved rule', () => {
  for (const month of ['03', '04', '05'])
    insert(
      `committee-${month}`,
      `2030-${month}-10`,
      'הע. אינטרנט',
      -200,
      'checking',
      'utilities',
      'scraper account 111-22222_33; העברה אל: Example Committee 88-222-00099',
    )
  request('post', '/api/obligations', {
    name: 'Example building',
    kind: 'hoa',
    expectedAmount: 200,
    matchingRules: [
      { pattern: 'Example Management', expectedAmount: 100 },
      {
        pattern: 'הע. אינטרנט',
        payee: 'Example Committee',
        expectedAmount: 200,
      },
    ],
  })
  expect(homeContext(deps).obligations).toHaveLength(1)
})
