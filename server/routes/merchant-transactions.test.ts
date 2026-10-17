import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Request, Response, RequestHandler } from 'express'

// The full application receives only this synthetic in-memory database.
vi.mock('../db.js', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { readFileSync } = await import('node:fs')
  const { migrateMerchantLabels } = await import('../lib/merchant-labels.js')
  const db = new Database(':memory:')
  db.exec(
    readFileSync(new URL('../db/sqlite-schema.sql', import.meta.url), 'utf8'),
  )
  migrateMerchantLabels(db)
  db.exec(`ALTER TABLE transactions ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tags ADD COLUMN icon TEXT;
    INSERT INTO accounts VALUES ('checking','Synthetic bank','Checking','ILS');
    INSERT INTO statement_files VALUES ('file','synthetic','synthetic','2030-06-17','synthetic','completed');
    INSERT INTO transactions (id,date,merchant,amount,currency,account_id,source_file_id,raw_hash) VALUES
      ('first','2030-05-01','SYNTHETIC RAW כרטיס 123',-10,'ILS','checking','file','first');`)
  return {
    db,
    nowIso: () => '2030-06-18',
    toBool: Boolean,
    dataDir: '/tmp',
    dbPath: ':memory:',
    schemaPath: '',
    ensureAccount: vi.fn(),
    getCategoryId: vi.fn(),
  }
})
vi.mock('../lib/private-config.js', async (original) => {
  const actual = await original<typeof import('../lib/private-config.js')>()
  return {
    ...actual,
    spendWiseConfig: {
      ...actual.spendWiseConfig,
      household: { accountNumbers: ['111-22222_33'] },
    },
  }
})
const { app } = await import('../index.js')
const { db } = await import('../db.js')
afterAll(() => db.close())
function request(
  method: string,
  path: string,
  body: unknown = {},
  query = {},
  params = {},
) {
  const stack = (
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
  const route = stack.find(
    (r) => r.route?.path === path && r.route.methods[method],
  )?.route
  if (!route) throw new Error('Missing route ' + path)
  let data: unknown
  const res = {
    json(value: unknown) {
      data = value
    },
    status() {
      return res
    },
  }
  route.stack[0].handle(
    { query, body, params } as Request,
    res as unknown as Response,
    (error) => {
      if (error) throw error
    },
  )
  return data as {
    items: { merchant: string; displayName: string }[]
    merchants: { merchant: string; displayName: string }[]
    transaction: { merchant: string; displayName: string }
  }
}
describe('merchant labels in actual transaction and search endpoints', () => {
  it('preserves raw names, labels past/future rows, searches labels and restores defaults on clear', () => {
    request('put', '/api/merchant-labels', {
      rawMerchant: 'Synthetic raw',
      label: 'Household service',
    })
    db.prepare(
      `INSERT INTO transactions (id,date,merchant,amount,currency,account_id,source_file_id,raw_hash) VALUES ('future','2030-06-18','synthetic raw כרטיס 999',-11,'ILS','checking','file','future')`,
    ).run()
    const list = request(
      'get',
      '/api/transactions',
      {},
      { q: 'Household service', view_mode: 'all' },
    )
    expect(list.items).toHaveLength(2)
    expect(list.items.map((r) => r.displayName)).toEqual([
      'Household service',
      'Household service',
    ])
    expect(list.items[0].merchant).toBe('synthetic raw כרטיס 999')
    expect(
      request('get', '/api/transactions/:id', {}, {}, { id: 'first' })
        .transaction,
    ).toMatchObject({
      merchant: 'SYNTHETIC RAW כרטיס 123',
      displayName: 'Household service',
    })
    expect(
      request('get', '/api/search', {}, { q: 'Household service' }).merchants,
    ).toHaveLength(2)
    request('delete', '/api/merchant-labels', { rawMerchant: 'Synthetic raw' })
    expect(
      request('get', '/api/transactions', {}, { q: 'Household service' }).items,
    ).toHaveLength(0)
    expect(
      request('get', '/api/transactions/:id', {}, {}, { id: 'first' })
        .transaction.displayName,
    ).toBe('SYNTHETIC RAW כרטיס 123')
  })
})
