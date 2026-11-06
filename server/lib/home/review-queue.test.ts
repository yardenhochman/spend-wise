import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import {
  applyReviewAnswer,
  buildReviewQueue,
  undoReviewAnswer,
} from './review-queue.js'
import type { HomeTransaction } from './types.js'

// Synthetic merchants, dates and amounts.
const TODAY = '2026-06-15'
let seq = 0
const tx = (over: Partial<HomeTransaction>): HomeTransaction =>
  ({
    id: `t${seq++}`,
    date: '2026-05-10',
    merchant: 'Corner Market',
    amount: -100,
    notes: null,
    account_id: 'card',
    account_label: 'Credit Card',
    bank_name: 'Leumi',
    category_name: null,
    is_internal: 0,
    is_recurring_candidate: 0,
    ...over,
  }) as HomeTransaction

function setup(rows: HomeTransaction[]) {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE rules (id TEXT PRIMARY KEY, match_type TEXT, pattern TEXT, category_id TEXT, priority INTEGER, enabled INTEGER, created_at TEXT);
    CREATE TABLE tag_rules (pattern TEXT, category_name TEXT);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, category_id TEXT, confidence REAL);
    INSERT INTO categories VALUES ('g','Groceries'),('d','Dining'),('u','Utilities');
  `)
  const add = db.prepare('INSERT INTO transactions VALUES (?,NULL,0)')
  for (const row of rows) add.run(row.id)
  return db
}
const queue = (db: Database.Database, rows: HomeTransaction[]) =>
  buildReviewQueue(db, rows, TODAY)

describe('buildReviewQueue', () => {
  it('groups by merchant, largest spend first, with the window and older rows', () => {
    const rows = [
      tx({ merchant: 'Small', amount: -10 }),
      tx({ amount: -100 }),
      tx({ amount: -200, date: '2026-06-01' }),
      tx({ amount: -50, date: '2025-01-01' }),
    ]
    const { items } = queue(setup(rows), rows)
    expect(items.map((i) => i.name)).toEqual(['Corner Market', 'Small'])
    expect(items[0]).toMatchObject({ count: 2, total: 300, olderCount: 1 })
    expect(items[0].examples[0].date).toBe('2026-06-01')
  })
  it('skips merchants with nothing in the window, and income', () => {
    const rows = [
      tx({ date: '2025-01-01' }),
      tx({ merchant: 'Refund Co', amount: 50 }),
    ]
    expect(queue(setup(rows), rows).items).toEqual([])
  })
  it('suggests from an existing rule first and says so', () => {
    const rows = [tx({})]
    const db = setup(rows)
    db.prepare(
      "INSERT INTO rules VALUES ('r','contains','corner','g',1,1,'x')",
    ).run()
    const { suggestion } = queue(db, rows).items[0]
    expect(suggestion?.categoryName).toBe('Groceries')
    expect(suggestion?.reason).toContain('Your rule for')
  })
  it('suggests from a clear majority of the merchant history', () => {
    const rows = [
      tx({}),
      ...Array.from({ length: 3 }, () =>
        tx({ category_name: 'Groceries', date: '2026-01-01' }),
      ),
      tx({ category_name: 'Dining', date: '2026-01-02' }),
    ]
    expect(queue(setup(rows), rows).items[0].suggestion).toMatchObject({
      categoryName: 'Groceries',
      reason: 'You filed 3 of 4 earlier charges here as Groceries.',
    })
  })
  it('makes no suggestion from a split history or from nothing', () => {
    const split = [
      tx({}),
      tx({ category_name: 'Groceries' }),
      tx({ category_name: 'Dining' }),
    ]
    expect(queue(setup(split), split).items[0].suggestion).toBeNull()
  })
  it('suggests from a similarly named merchant, naming it', () => {
    const rows = [
      tx({ merchant: 'CITY POWER 2023 LTD' }),
      tx({ merchant: 'CITY POWER', category_name: 'Utilities' }),
    ]
    const { suggestion } = queue(setup(rows), rows).items[0]
    expect(suggestion?.categoryName).toBe('Utilities')
    expect(suggestion?.reason).toContain('a similar name')
  })
  it('uses a tag rule category only for a meaningful pattern', () => {
    const rows = [tx({ merchant: 'Sunny coffee bar' })]
    const db = setup(rows)
    db.prepare("INSERT INTO tag_rules VALUES ('bar','Dining')").run()
    expect(queue(db, rows).items[0].suggestion).toBeNull()
    db.prepare("INSERT INTO tag_rules VALUES ('coffee','Dining')").run()
    expect(queue(db, rows).items[0].suggestion?.reason).toContain('coffee')
  })
  it('separates payments to people by payee and sets no rule', () => {
    const rows = [
      tx({ merchant: 'העברה דיגיטל', notes: 'העברה לזכות: דנה לוי' }),
      tx({ merchant: 'העברה דיגיטל', notes: 'העברה לזכות: אורי כהן' }),
      tx({ merchant: 'BIT' }),
    ]
    const { items } = queue(setup(rows), rows)
    expect(items).toHaveLength(3)
    expect(items.every((i) => !i.setsRule)).toBe(true)
    expect(items.map((i) => i.name)).toContain('דנה לוי')
  })
  it('does not treat insurance names as BIT', () => {
    const rows = [tx({ merchant: 'ביטוח ישיר' })]
    expect(queue(setup(rows), rows).items[0].setsRule).toBe(true)
  })
})

describe('applyReviewAnswer', () => {
  const stored = (db: Database.Database) =>
    db.prepare('SELECT id,category_id FROM transactions ORDER BY id').all()
  it('files every uncategorized row of the merchant and adds a rule', () => {
    const rows = [
      tx({}),
      tx({ date: '2025-01-01' }),
      tx({ amount: 20 }),
      tx({ merchant: 'Other' }),
    ]
    const db = setup(rows)
    const applied = applyReviewAnswer(db, rows, 'corner market', 'g', 'now')
    expect(applied?.transactionIds).toHaveLength(3)
    expect(
      db.prepare('SELECT match_type,pattern,category_id FROM rules').all(),
    ).toEqual([
      { match_type: 'exact', pattern: 'Corner Market', category_id: 'g' },
    ])
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM transactions WHERE category_id=?')
        .get('g'),
    ).toEqual({ n: 3 })
  })
  it('updates an exact rule instead of adding another, and undo restores it', () => {
    const rows = [tx({})]
    const db = setup(rows)
    db.prepare(
      "INSERT INTO rules VALUES ('r','exact','corner market','d',5,0,'x')",
    ).run()
    const applied = applyReviewAnswer(db, rows, 'corner market', 'g', 'now')!
    expect(db.prepare('SELECT category_id,enabled FROM rules').all()).toEqual([
      { category_id: 'g', enabled: 1 },
    ])
    undoReviewAnswer(db, applied)
    expect(db.prepare('SELECT category_id,enabled FROM rules').all()).toEqual([
      { category_id: 'd', enabled: 0 },
    ])
  })
  it('undo clears the answer, its rule, and spares later changes', () => {
    const rows = [tx({}), tx({ date: '2026-05-11' })]
    const db = setup(rows)
    const applied = applyReviewAnswer(db, rows, 'corner market', 'g', 'now')!
    db.prepare('UPDATE transactions SET category_id=? WHERE id=?').run(
      'd',
      rows[1].id,
    )
    undoReviewAnswer(db, applied)
    expect(stored(db)).toEqual([
      { id: rows[0].id, category_id: null },
      { id: rows[1].id, category_id: 'd' },
    ])
    expect(db.prepare('SELECT * FROM rules').all()).toEqual([])
  })
  it('sets no rule for payments to people, and leaves their refunds', () => {
    const rows = [tx({ merchant: 'BIT' }), tx({ merchant: 'BIT', amount: 40 })]
    const db = setup(rows)
    const applied = applyReviewAnswer(db, rows, 'bit', 'g', 'now')!
    expect(applied.transactionIds).toEqual([rows[0].id])
    expect(db.prepare('SELECT * FROM rules').all()).toEqual([])
  })
  it('returns null when nothing is left, without writing', () => {
    const rows = [tx({ category_name: 'Groceries' })]
    const db = setup(rows)
    expect(applyReviewAnswer(db, rows, 'corner market', 'g', 'now')).toBeNull()
    expect(db.prepare('SELECT * FROM rules').all()).toEqual([])
  })
})
