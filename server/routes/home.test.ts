import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Express, Request, Response, RequestHandler } from 'express'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
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
    { query, body, params: { id: query.id } } as unknown as Request,
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
      "INSERT INTO merchant_aliases VALUES ('synthetic-alias','Synthetic raw','Synthetic display','contains')",
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
