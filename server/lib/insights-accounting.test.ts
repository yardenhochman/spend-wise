import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Express, Request, RequestHandler, Response } from 'express'

const state = vi.hoisted(() => ({ app: null as Express | null }))

// Register the real routes, but never open a port or the household database.
vi.mock('express', async (original) => {
  const actual = await original<{ default: typeof import('express') }>()
  const factory = Object.assign(() => {
    const app = actual.default()
    vi.spyOn(app, 'listen').mockReturnValue({} as ReturnType<Express['listen']>)
    state.app = app
    return app
  }, actual.default)
  return { ...actual, default: factory }
})
vi.mock('../db.js', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { readFileSync } = await import('node:fs')
  const db = new Database(':memory:')
  db.exec(
    readFileSync(new URL('../db/sqlite-schema.sql', import.meta.url), 'utf8'),
  )
  db.exec(
    'ALTER TABLE transactions ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0',
  )
  db.exec(
    "INSERT INTO accounts VALUES ('synthetic','Test','Test','ILS'); INSERT INTO statement_files VALUES ('synthetic','Test','test','2030-01-01','test','completed')",
  )
  return {
    db,
    getCategoryId: (name: string) =>
      (
        db.prepare('SELECT id FROM categories WHERE name=?').get(name) as
          | { id: string }
          | undefined
      )?.id,
    nowIso: () => '2030-01-01T00:00:00Z',
    toBool: Boolean,
    dataDir: '',
    dbPath: ':memory:',
    schemaPath: '',
    ensureAccount: vi.fn(),
  }
})
vi.mock('./private-config.js', () => ({
  spendWiseConfig: {
    viewModeRules: {
      homeInclude: [
        "{alias}.merchant = 'Synthetic loan repayment'",
        "{alias}.merchant = 'Synthetic למשכנת payment'",
      ],
      weddingInclude: [],
    },
    internalTransfer: { exactMerchants: [] },
    subSegmentTags: [],
    actionCards: [],
  },
  expandSqlTemplates: (rules: string[], alias: string) =>
    rules.map((rule) => rule.replaceAll('{alias}', alias)),
}))

import { db } from '../db.js'
import '../index.js'

function request<T>(path: string, query: Record<string, string> = {}): T {
  const app = state.app as unknown as {
    _router: {
      stack: { route?: { path: string; stack: { handle: RequestHandler }[] } }[]
    }
  }
  const route = app._router.stack.find(
    (layer) => layer.route?.path === path,
  )?.route
  if (!route) throw new Error(`Missing route ${path}`)
  const json = vi.fn()
  route.stack[0].handle(
    { query } as unknown as Request,
    { json } as unknown as Response,
    (error: unknown) => {
      if (error) throw error
    },
  )
  expect(json).toHaveBeenCalledOnce()
  return json.mock.calls[0][0] as T
}

function transaction(
  id: string,
  amount: number,
  category = 'insurance',
  spread: number | null = 12,
  internal = 0,
  date = '2030-01-15',
  merchant = 'Synthetic merchant',
) {
  db.prepare(
    `INSERT INTO transactions (id,date,merchant,amount,category_id,spread_months,is_internal,raw_hash,currency,account_id,source_file_id) VALUES (?,?,?,?,?,?,?,?,'ILS','synthetic','synthetic')`,
  ).run(id, date, merchant, amount, category, spread, internal, id)
}
const period = { date_from: '2030-01-01', date_to: '2030-01-31' }
type Summary = {
  total_spend: number
  total_income: number
  by_category: { total: number }[]
  by_spending_type: Record<string, { total: number }>
}
type Trend = { points: { period: string; total: number }[] }

beforeEach(() => {
  db.exec('DELETE FROM transactions; DELETE FROM categories')
  for (const [id, name] of [
    ['insurance', 'Insurance'],
    ['wedding', 'Wedding'],
    ['loan', 'Home Loans'],
    ['mortgage', 'Mortgage'],
    ['home', 'Property Price'],
  ]) {
    db.prepare(
      'INSERT INTO categories (id,name,spending_type) VALUES (?,?,?)',
    ).run(id, name, 'needs')
  }
})
afterAll(() => db.close())

describe('spread route accounting', () => {
  it('reverses an expense within spending, including the needs breakdown', () => {
    transaction('expense', -1200)
    const result = request<Summary>('/api/insights/summary', period)
    expect(result.total_spend).toBeCloseTo(100)
    expect(result.total_income).toBe(0)
    expect(result.by_category[0].total).toBeCloseTo(-100)
    expect(result.by_spending_type.needs.total).toBeCloseTo(-100)
  })
  it('subtracts the signed reversal from category expense trends', () => {
    transaction('expense', -1200)
    expect(
      request<Trend>('/api/insights/category-trend', {
        ...period,
        category_id: 'insurance',
      }).points,
    ).toEqual([{ period: '2030-01', total: 100 }])
  })
  it('keeps income spreads in income and out of expense trends', () => {
    transaction('income', 1200)
    const result = request<Summary>('/api/insights/summary', period)
    expect(result.total_spend).toBe(0)
    expect(result.total_income).toBeCloseTo(100)
    expect(
      request<Trend>('/api/insights/category-trend', {
        ...period,
        category_id: 'insurance',
      }).points,
    ).toEqual([])
  })
  it('preserves full-history totals and allocates earlier months', () => {
    transaction('expense', -1200)
    expect(request<Summary>('/api/insights/summary').total_spend).toBe(1200)
    expect(
      request<Summary>('/api/insights/summary', {
        date_from: '2029-12-01',
        date_to: '2029-12-31',
      }).total_spend,
    ).toBeCloseTo(100)
    const result = request<{
      months: { month: string; spend: number; income: number }[]
    }>('/api/insights/monthly')
    expect(result.months).toHaveLength(12)
    for (const month of result.months) {
      expect(month.spend).toBeCloseTo(-100)
      expect(month.income).toBe(0)
    }
  })
  it.each(['wedding', 'loan', 'mortgage', 'home'])(
    'applies %s exclusions to raw rows and spread allocations',
    (category) => {
      transaction('ordinary', -50, 'insurance', null)
      transaction('excluded', -1200, category)
      transaction('internal', -2400, 'insurance', 12, 1)
      const excluded_kinds = category === 'loan' ? 'loans' : category
      expect(
        request<Summary>('/api/insights/summary', period).total_spend,
      ).toBeCloseTo(150)
      expect(
        request<Summary>('/api/insights/summary', { ...period, excluded_kinds })
          .total_spend,
      ).toBe(50)
      expect(
        request<Trend>('/api/insights/category-trend', {
          ...period,
          excluded_kinds,
          category_id: category,
        }).points,
      ).toEqual([])
    },
  )
  it('filters configured loan and mortgage descriptions even when uncategorized', () => {
    transaction(
      'loan-rule',
      -1200,
      'insurance',
      12,
      0,
      '2030-01-15',
      'Synthetic loan repayment',
    )
    transaction(
      'mortgage-rule',
      -1200,
      'insurance',
      12,
      0,
      '2030-01-15',
      'Synthetic למשכנת payment',
    )
    db.exec('UPDATE transactions SET category_id=NULL')
    expect(
      request<Summary>('/api/insights/summary', {
        ...period,
        excluded_kinds: 'loans,mortgage',
      }).total_spend,
    ).toBe(0)
    expect(
      request<Trend>('/api/insights/category-trend', {
        ...period,
        excluded_kinds: 'loans,mortgage',
      }).points,
    ).toEqual([])
  })
})
