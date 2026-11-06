import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import Database from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { migrateObligations } from '../lib/home/migration.js'
import { migrateMerchantLabels } from '../lib/merchant-labels.js'
import { config } from '../lib/home/test-fixtures.js'
import type { HomeDeps } from '../lib/home/service.js'
import { createViewModeFilter } from '../lib/view-mode.js'
import {
  anythingOff,
  compareToUsual,
  leftBeforePayday,
  transactionsForFigure,
  whereMoneyWent,
} from './answers.js'
import { openReadOnly, readToken } from './main.js'
import { createApp } from './server.js'

const TOKEN = 'synthetic-token-synthetic-token-synthetic'
const HOUSEHOLD = 'scraper account 111-22222_33'
const COMMITTEE = 'scraper account 999-88888_77'
const TODAY = '2030-06-18'
let dir: string
let db: Database.Database
let deps: HomeDeps

function seed(file: string) {
  const w = new Database(file)
  w.pragma('journal_mode = WAL')
  w.exec(
    fs.readFileSync(
      new URL('../db/sqlite-schema.sql', import.meta.url),
      'utf8',
    ),
  )
  w.exec(`ALTER TABLE transactions ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;
    INSERT INTO accounts VALUES ('checking','Leumi','Checking','ILS'),('card','Leumi','Leumi card 1234','ILS'),('committee','Leumi','Committee','ILS');
    INSERT INTO statement_files VALUES ('file','synthetic','synthetic','2030-06-17T00:00:00Z','synthetic','completed');`)
  const categories = [
    'Groceries',
    'Dining',
    'Insurance',
    'Salary',
    'Bank Fees',
    'Home Purchase',
    'Wedding',
    'Mortgage',
    'Property Price',
    'Purchase Tax',
    'Closing Costs',
    'Home Loans',
    'Consulting',
    'Venue & Catering',
    'Music & Sound',
    'Photography',
    'Wedding Planning',
    'Wedding Loan',
  ]
  const category = w.prepare('INSERT INTO categories (id,name) VALUES (?,?)')
  for (const name of categories) category.run(name, name)
  migrateMerchantLabels(w)
  migrateObligations(w)
  const insert = w.prepare(
    "INSERT INTO transactions (id,date,merchant,amount,currency,account_id,category_id,source_file_id,raw_hash,notes,is_internal,is_recurring_candidate,spread_months) VALUES (?,?,?,?,'ILS',?,?,'file',?,?,?,0,?)",
  )
  let id = 0
  const tx = (
    date: string,
    merchant: string,
    amount: number,
    categoryId: string | null,
    extra: {
      account?: string
      notes?: string
      internal?: number
      spread?: number
    } = {},
  ) => {
    const key = `tx-${++id}`
    insert.run(
      key,
      date,
      merchant,
      amount,
      extra.account ?? 'checking',
      categoryId,
      key,
      extra.notes ?? HOUSEHOLD,
      extra.internal ?? 0,
      extra.spread ?? null,
    )
    return key
  }
  // Six comparison months of steady groceries, half by the 15th.
  for (const m of [
    '2029-12',
    '2030-01',
    '2030-02',
    '2030-03',
    '2030-04',
    '2030-05',
  ]) {
    tx(`${m}-05`, 'Synthetic Market', -500, 'Groceries')
    tx(`${m}-25`, 'Synthetic Market', -500, 'Groceries')
    tx(`${m}-10`, 'Synthetic Bistro', -200, 'Dining')
    tx(`${m}-01`, 'Synthetic Employer', 9000, 'Salary')
  }
  tx('2030-06-01', 'Synthetic Employer', 9000, 'Salary')
  tx('2030-06-05', 'Synthetic Market', -1400, 'Groceries')
  tx('2030-06-10', 'Synthetic Bistro', -200, 'Dining')
  tx('2030-06-11', 'Synthetic Double', -300, 'Dining')
  tx('2030-06-12', 'Synthetic Double', -300, 'Dining')
  tx('2030-06-12', 'עמלת פעולה', -15, 'Bank Fees')
  tx('2030-06-13', 'Card purchase 123456789', -80, null, {
    account: 'card',
  })
  tx('2030-06-14', 'Synthetic Refund', 60, 'Dining')
  // Spread payment: 1,200 over 12 months ending June counts 100 here.
  tx('2030-06-02', 'Synthetic Annual Policy', -1200, 'Insurance', {
    spread: 12,
  })
  tx('2030-06-15', 'Synthetic Home Lender', -4000, 'Mortgage')
  // Must never appear in any answer.
  tx('2030-06-09', 'Own account move', -5000, null, { internal: 1 })
  tx('2030-06-10', 'Committee Elevator Repair', -7777, null, {
    notes: COMMITTEE,
    account: 'committee',
  })
  tx('2030-06-11', 'Committee Fee Income', 8888, null, {
    notes: COMMITTEE,
    account: 'committee',
  })
  w.prepare(
    "INSERT INTO account_balances (account_key,label,balance,currency,as_of,source,imported_at) VALUES (?,?,?,'ILS',?,'leumi-bank',?)",
  ).run(
    '22222/33',
    'Checking 1',
    6000,
    '2030-06-18T05:00:00Z',
    '2030-06-18T05:00:00Z',
  )
  w.prepare(
    "INSERT INTO account_balances (account_key,label,balance,currency,as_of,source,imported_at) VALUES (?,?,?,'ILS',?,'leumi-bank',?)",
  ).run(
    '88888/77',
    'Committee',
    55555,
    '2030-06-18T05:00:00Z',
    '2030-06-18T05:00:00Z',
  )
  w.close()
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spendwise-mcp-'))
  const file = path.join(dir, 'synthetic.sqlite')
  seed(file)
  db = openReadOnly(file)
  const lookup = db.prepare('SELECT id FROM categories WHERE name = ?')
  const filter = createViewModeFilter(
    (name) => (lookup.get(name) as { id: string } | undefined)?.id ?? null,
  )
  deps = {
    db,
    config,
    today: () => TODAY,
    mortgage: () => null,
    routineFilter: () => filter('routine', 't'),
  }
})
afterEach(() => {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

function allAnswers() {
  return [
    whereMoneyWent(deps, { month: '2030-06' }),
    compareToUsual(deps, {}),
    leftBeforePayday(deps),
    anythingOff(deps),
    transactionsForFigure(deps, {
      month: '2030-06',
      bucket: 'all',
      direction: 'both',
      limit: 500,
    }),
  ]
}

describe('every answer', () => {
  it('carries data-through dates, evidence and handling rules', () => {
    for (const answer of allAnswers()) {
      expect(answer.asOf).toBe(TODAY)
      expect(answer.dataThrough.latestTransaction).toBe('2030-06-15')
      expect(answer.dataThrough.lastImportAt).toContain('2030-06-17')
      expect(answer.dataThrough.byAccount.map((a) => a.account)).toContain(
        'Leumi card 1234',
      )
      expect(answer.handling).toContain('Do not save')
      expect(JSON.stringify(answer)).toMatch(/"evidence"/)
    }
  })
  it('never exposes the committee account, internal transfers or account numbers', () => {
    const text = JSON.stringify(allAnswers())
    for (const secret of [
      'Committee Elevator',
      'Committee Fee',
      '7777',
      '8888',
      '55555',
      'Own account move',
      '5000',
      '22222',
      '111-22222',
      '123456789',
    ])
      expect(text).not.toContain(secret)
    expect(text).toContain('•••6789')
    expect(
      transactionsForFigure(deps, {
        month: '2030-06',
        bucket: 'all',
        direction: 'both',
        merchant: 'Committee',
      }).transactions,
    ).toBe(0)
  })
  it('fails closed with no household allowlist', () => {
    const closed = { ...deps, config: undefined }
    expect(whereMoneyWent(closed, { month: '2030-06' }).routine.total).toBe(0)
    expect(leftBeforePayday(closed).balance).toBeNull()
  })
})

describe('where_money_went', () => {
  it('separates routine from other outflows and money in', () => {
    const a = whereMoneyWent(deps, { month: '2030-06' })
    // 1400 + 200 + 600 + 15 + 80 + 100 of the spread payment.
    expect(a.routine.total).toBe(2395)
    expect(a.routine.categories[0].category).toBe('Groceries')
    expect(a.outsideRoutine.total).toBe(4000)
    expect(a.moneyIn.total).toBe(9060)
    expect(a.partialMonth).toBe(true)
    expect(a.warnings.join()).toContain('uncategorized')
  })
  it('reconciles every figure with transactions_for_figure', () => {
    const a = whereMoneyWent(deps, { month: '2030-06' })
    const figures = [
      [a.routine.total, a.routine.figure],
      [a.outsideRoutine.total, a.outsideRoutine.figure],
      ...a.routine.categories.map((c) => [c.spent, c.figure] as const),
    ] as const
    for (const [amount, figure] of figures) {
      const rows = transactionsForFigure(deps, {
        limit: 500,
        ...figure.arguments,
      } as unknown as Parameters<typeof transactionsForFigure>[1])
      expect(-rows.total).toBe(amount)
      expect(
        Math.abs(
          rows.evidence.reduce((s, r) => s + r.countedInFigure, 0) + amount,
        ),
      ).toBeLessThan(0.05)
    }
  })
  it('shows both posted and counted amounts for a spread payment', () => {
    const row = whereMoneyWent(deps, { month: '2030-06' }).evidence.find(
      (r) => r.merchant === 'Synthetic Annual Policy',
    )
    expect(row).toMatchObject({
      amount: -1200,
      countedInFigure: -100,
      spreadMonths: 12,
    })
    expect(
      whereMoneyWent(deps, { month: '2030-01' }).routine.categories.find(
        (c) => c.category === 'Insurance',
      )?.spent,
    ).toBe(100)
  })
  it('rejects bad months', () => {
    expect(() => whereMoneyWent(deps, { month: '2031-01' })).toThrow('future')
    expect(() => whereMoneyWent(deps, { month: 'June' })).toThrow('2026-03')
  })
})

describe('compare_to_usual', () => {
  it('compares like with like up to the latest day with data', () => {
    const a = compareToUsual(deps, { category: 'Groceries' })
    expect(a.comparedThrough).toBe('2030-06-14')
    expect(a.total.amount).toBe(1400)
    // Half the month's groceries by the 14th, not the full 1,000.
    expect(a.total.usual).toBe(500)
    expect(a.total.usualFullMonth).toBe(1000)
    expect(a.total.status).toBe('above_usual')
    expect(a.history).toHaveLength(6)
  })
  it('names the categories behind an increase and their figures', () => {
    const a = compareToUsual(deps, {})
    const groceries = a.categories.find((c) => c.category === 'Groceries')!
    expect(groceries.status).toBe('above_usual')
    expect(a.evidence.some((r) => r.merchant === 'Synthetic Market')).toBe(true)
    const rows = transactionsForFigure(
      deps,
      groceries.figure.arguments as unknown as Parameters<
        typeof transactionsForFigure
      >[1],
    )
    expect(-rows.total).toBe(groceries.amount)
  })
  it('admits when history is too short', () => {
    expect(compareToUsual(deps, { month: '2030-01' }).total.status).toBe(
      'not_enough_history',
    )
  })
})

describe('left_before_payday', () => {
  it('uses household balances and marks forecast rows', () => {
    const a = leftBeforePayday(deps)
    expect(a.balance).toBe(6000)
    expect(a.nextSalary?.date).toMatch(/^2030-07/)
    expect(a.projectedBeforePayday).not.toBeNull()
    expect(a.evidence.balances).toEqual([
      expect.objectContaining({ label: 'Checking 1', balance: 6000 }),
    ])
    for (const e of a.evidence.events)
      expect(typeof e.estimated).toBe('boolean')
    expect(a.forecastMethod).toContain('not forecast')
  })
  it('says a missing balance is unknown, never zero', () => {
    const noBalance = {
      ...deps,
      config: { ...config, accountNumbers: ['000-00000_00'] },
    }
    const a = leftBeforePayday(noBalance)
    expect(a.balance).toBeNull()
    expect(a.projectedBeforePayday).toBeNull()
    expect(a.summary).toContain('unknown')
  })
})

describe('anything_off', () => {
  it('finds double charges and fees with their rows', () => {
    const a = anythingOff(deps)
    const double = a.findings.find((f) => f.source === 'double_charge')!
    expect(double.title).toContain('Synthetic Double')
    expect(double.evidence).toHaveLength(2)
    const fees = a.findings.find((f) => f.source === 'fees_and_interest')!
    expect(fees.evidence[0].amount).toBe(-15)
  })
  it('does not flag charges that are not close together', () => {
    const a = anythingOff(deps)
    expect(
      a.findings.some(
        (f) =>
          f.source === 'double_charge' && f.title.includes('Synthetic Market'),
      ),
    ).toBe(false)
  })
  it('explains any finding without transaction evidence', () => {
    for (const f of anythingOff(deps).findings)
      if (!f.evidence.length) expect(f.noEvidenceReason).toBeTruthy()
  })
  it('keeps Brief notice evidence resolvable despite string IDs', () => {
    // Enough uncategorized history to raise Brief's coverage notice, which lists transaction IDs.
    const writer = new Database(path.join(dir, 'synthetic.sqlite'))
    writer
      .prepare(
        "UPDATE transactions SET category_id=NULL WHERE amount<0 AND date<'2030-06-01'",
      )
      .run()
    writer.close()
    const coverage = anythingOff(deps).findings.find(
      (f) => f.source === 'brief' && f.title.includes('uncategorized'),
    )!
    expect(coverage.evidenceCount).toBeGreaterThan(0)
    expect(coverage.evidence[0].id).toMatch(/^tx-/)
  })
  it('resolves obligation evidence on Brief commitment notices', () => {
    const mismatch = anythingOff(deps).findings.find((f) =>
      f.title.includes('payment differs'),
    )!
    expect(mismatch.evidenceCount).toBeGreaterThan(0)
  })
})

describe('read-only guarantee', () => {
  it('refuses writes at the connection and registers only the five read tools', async () => {
    expect(() =>
      db.prepare("UPDATE transactions SET amount=0 WHERE id='tx-1'").run(),
    ).toThrow(/readonly/i)
    const server = listen()
    const client = await connect(server)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'anything_off',
      'compare_to_usual',
      'left_before_payday',
      'transactions_for_figure',
      'where_money_went',
    ])
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true)
      expect(t.annotations?.destructiveHint).toBe(false)
    }
    await client.close()
    server.close()
  })
})

describe('access', () => {
  const post = (server: Server, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${portOf(server)}/health`, { headers })
  it('requires the token, including for health', async () => {
    const server = listen()
    await new Promise((resolve) => server.once('listening', resolve))
    expect((await post(server)).status).toBe(401)
    expect((await post(server, { Authorization: 'Bearer wrong' })).status).toBe(
      401,
    )
    const ok = { Authorization: `Bearer ${TOKEN}` }
    expect((await post(server, ok)).status).toBe(200)
    expect(
      (await post(server, { ...ok, 'Tailscale-Funnel-Request': '?1' })).status,
    ).toBe(403)
    expect(
      (await post(server, { ...ok, Origin: 'https://example.test' })).status,
    ).toBe(403)
    server.close()
  })
  it('refuses unknown hosts', async () => {
    const log: string[] = []
    const app = createApp({
      deps,
      token: TOKEN,
      allowedHosts: ['only.example.test'],
      log: (line) => log.push(line),
    })
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const res = await post(server, { Authorization: `Bearer ${TOKEN}` })
    expect(res.status).toBe(403)
    expect(log.join()).toContain('host_refused')
    server.close()
  })
  it('answers over the protocol and logs no financial data', async () => {
    const log: string[] = []
    const server = listen(log)
    const client = await connect(server)
    const result = await client.callTool({
      name: 'transactions_for_figure',
      arguments: { month: '2030-06', merchant: 'Synthetic Market' },
    })
    const content = result.content as { type: string; text: string }[]
    const answer = JSON.parse(content[0].text)
    expect(answer.total).toBe(-1400)
    const bad = await client.callTool({
      name: 'compare_to_usual',
      arguments: { category: 'Not A Category' },
    })
    expect(bad.isError).toBe(true)
    expect((bad.content as { text: string }[])[0].text).toContain('Groceries')
    expect(log.join('\n')).toContain('tool=transactions_for_figure')
    expect(log.join('\n')).toContain('merchant')
    for (const secret of ['Synthetic Market', '1400', '2030-06'])
      expect(log.join('\n')).not.toContain(secret)
    await client.close()
    server.close()
  })
  it('refuses a token file others can read', () => {
    const file = path.join(dir, 'token')
    fs.writeFileSync(file, TOKEN, { mode: 0o644 })
    expect(() => readToken(file)).toThrow('owner')
    fs.chmodSync(file, 0o600)
    expect(readToken(file)).toBe(TOKEN)
  })
})

function listen(log: string[] = []): Server {
  return createApp({
    deps,
    token: TOKEN,
    allowedHosts: ['127.0.0.1'],
    log: (line) => log.push(line),
  }).listen(0, '127.0.0.1')
}
const portOf = (server: Server) => (server.address() as AddressInfo).port
async function connect(server: Server) {
  await new Promise((resolve) => server.once('listening', resolve))
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${portOf(server)}/mcp`),
      {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      },
    ),
  )
  return client
}
