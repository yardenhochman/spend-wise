import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { buildFuzzyIndex, findFuzzyDuplicate } from './dedup.js'
import {
  applyMerge,
  findImportDuplicates,
  importIdentities,
  isTruncation,
  mergedNotes,
  undoMerge,
  wasMergedAway,
  type BankCharge,
  type DuplicateRow,
} from './import-duplicates.js'

// Synthetic merchants, cards, dates and amounts.
const row = (id: string, over: Partial<DuplicateRow> = {}): DuplicateRow => ({
  id,
  date: '2026-08-10',
  merchant: 'STORE ONLINE SERVICES',
  amount: -100,
  category_id: null,
  notes: 'leumi account 1 card 1111 cycle A',
  account_id: 'card',
  is_internal: 0,
  spread_months: null,
  source_file_id: `file-${id}`,
  raw_hash: `hash-${id}`,
  ...over,
})
const charge = (over: Partial<BankCharge> = {}): BankCharge => ({
  card: '1111',
  date: '2026-08-10',
  merchant: 'STORE ONLINE SERV',
  amount: -100,
  ...over,
})
const SHORT = { merchant: 'STORE ONLINE SERV' }
const find = (rows: DuplicateRow[], bank = [charge()]) =>
  findImportDuplicates(rows, bank, '2026-01-01')

describe('findImportDuplicates', () => {
  it('merges two spellings when the bank shows one charge', () => {
    const { pairs } = find([row('a'), row('b', SHORT)])
    expect(pairs).toHaveLength(1)
  })
  it('never merges identical strings, which may be two purchases', () => {
    expect(find([row('a'), row('b')]).pairs).toEqual([])
  })
  it('never merges rows on two different cards', () => {
    const rows = [
      row('a'),
      row('b', { ...SHORT, notes: 'leumi account 1 card 2222 cycle A' }),
    ]
    expect(find(rows)).toEqual({ pairs: [], uncertain: [] })
  })
  it('treats two posted charges as two real purchases', () => {
    const { pairs, uncertain } = find(
      [row('a'), row('b', SHORT)],
      [charge(), charge({ merchant: 'STORE ONLINE SERVICES' })],
    )
    expect(pairs).toEqual([])
    expect(uncertain[0].reason).toBe('bank shows 2 charges')
  })
  it('lists a pair the bank record cannot confirm', () => {
    const { pairs, uncertain } = find([row('a'), row('b', SHORT)], [])
    expect(pairs).toEqual([])
    expect(uncertain[0].reason).toBe('not in the bank record')
  })
  it('accepts a foreign charge by its original amount', () => {
    const { pairs } = find(
      [row('a'), row('b', SHORT)],
      [charge({ amount: -310, originalAmount: -100 })],
    )
    expect(pairs).toHaveLength(1)
  })
  it('needs an exact truncation when one row has no card', () => {
    const noCard = { notes: null, account_id: 'checking' }
    expect(find([row('a', noCard), row('b', SHORT)]).pairs).toHaveLength(1)
    const rows = [
      row('a', { ...noCard, merchant: 'STORE OFFLINE GOODS' }),
      row('b', SHORT),
    ]
    expect(find(rows).pairs).toEqual([])
  })
  it('unifies mirrored brackets', () => {
    expect(isTruncation('שוק הכרמל )פ', 'שוק הכרמל (פ')).toBe(true)
  })
  it('lists rows with no card at all instead of merging them', () => {
    const noCard = { notes: null }
    const { pairs, uncertain } = find([
      row('a', noCard),
      row('b', { ...noCard, ...SHORT }),
    ])
    expect(pairs).toEqual([])
    expect(uncertain[0].reason).toBe('no card on either row')
  })
  it('lists conflicting categories instead of choosing one', () => {
    const { pairs, uncertain } = find([
      row('a', { category_id: 'x' }),
      row('b', { ...SHORT, category_id: 'y' }),
    ])
    expect(pairs).toEqual([])
    expect(uncertain[0].reason).toBe('categories differ')
  })
  it('leaves checking-ledger card settlements alone', () => {
    const settlement = { notes: null, merchant: 'ל.מאסטרקרד(יש)' }
    const other = { notes: null, merchant: 'ל.מאסטרקרד' }
    expect(find([row('a', settlement), row('b', other)])).toEqual({
      pairs: [],
      uncertain: [],
    })
  })
  it('ignores rows before the window', () => {
    const old = { date: '2025-01-01' }
    expect(find([row('a', old), row('b', { ...old, ...SHORT })]).pairs).toEqual(
      [],
    )
  })
  it('keeps the categorized row, then Hebrew, then the one with a card', () => {
    const categorized = find([row('a', { category_id: 'x' }), row('b', SHORT)])
    expect(categorized.pairs[0].keep.id).toBe('a')
    const hebrew = find(
      [
        row('a', { merchant: 'שוק הכרמל ירקות' }),
        row('b', { merchant: 'שוק הכרמל ירקות טריים' }),
      ],
      [charge({ merchant: 'שוק הכרמל ירקות' })],
    )
    expect(hebrew.pairs).toHaveLength(1)
    const card = find([row('a', { notes: null }), row('b', SHORT)])
    expect(card.pairs[0].keep.id).toBe('b')
  })
  it('gives each row one partner', () => {
    const { pairs } = find([
      row('a'),
      row('b', SHORT),
      row('c', { merchant: 'STORE ONLINE SE' }),
    ])
    expect(pairs).toHaveLength(1)
  })
})

describe('mergedNotes', () => {
  it('keeps user text before the machine note read from the end', () => {
    expect(mergedNotes('leumi account 1 card 1 cycle A', 'Japan trip')).toBe(
      'Japan trip; leumi account 1 card 1 cycle A',
    )
  })
  it('does not stack machine notes', () => {
    expect(
      mergedNotes('leumi account 1 card 1 cycle A', 'scraper account 2'),
    ).toBe('leumi account 1 card 1 cycle A')
    expect(mergedNotes(null, null)).toBeNull()
  })
})

function memoryDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE transactions (id TEXT PRIMARY KEY, date TEXT, merchant TEXT, amount REAL, category_id TEXT, notes TEXT, account_id TEXT, is_internal INTEGER, spread_months INTEGER, source_file_id TEXT, raw_hash TEXT);
    CREATE TABLE transaction_tags (transaction_id TEXT, tag_id TEXT, PRIMARY KEY (transaction_id, tag_id));
    CREATE TABLE transaction_links (id TEXT PRIMARY KEY, transaction_id TEXT, linked_transaction_id TEXT, link_type TEXT, created_at TEXT, UNIQUE(transaction_id, linked_transaction_id));
    CREATE TABLE transaction_valuations (transaction_id TEXT PRIMARY KEY, source_key TEXT UNIQUE, original_amount REAL);
    CREATE TABLE merged_transactions (removed_id TEXT PRIMARY KEY, kept_id TEXT NOT NULL, date TEXT NOT NULL, merchant TEXT NOT NULL, amount REAL NOT NULL, raw_hash TEXT NOT NULL, source_key TEXT, merged_at TEXT NOT NULL);
  `)
  const insert = db.prepare(
    'INSERT INTO transactions VALUES (@id,@date,@merchant,@amount,@category_id,@notes,@account_id,@is_internal,@spread_months,@source_file_id,@raw_hash)',
  )
  const keep = row('keep', SHORT)
  const remove = row('remove', {
    category_id: 'cat',
    notes: 'Trip',
    spread_months: 3,
  })
  insert.run(keep)
  insert.run(remove)
  insert.run(row('other', { merchant: 'OTHER' }))
  db.prepare('INSERT INTO transaction_tags VALUES (?,?)').run(
    'remove',
    'project',
  )
  db.prepare('INSERT INTO transaction_tags VALUES (?,?)').run('remove', 'both')
  db.prepare('INSERT INTO transaction_tags VALUES (?,?)').run('keep', 'both')
  db.prepare('INSERT INTO transaction_links VALUES (?,?,?,?,?)').run(
    'l1',
    'other',
    'remove',
    'reimbursement',
    'now',
  )
  db.prepare('INSERT INTO transaction_valuations VALUES (?,?,?)').run(
    'remove',
    'source-key',
    -100,
  )
  return { db, keep, remove }
}

describe('applyMerge', () => {
  it('moves everything keyed to the removed row, and undo restores it', () => {
    const { db, keep, remove } = memoryDb()
    const snapshot = () =>
      [
        'transactions',
        'transaction_tags',
        'transaction_links',
        'transaction_valuations',
        'merged_transactions',
      ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all())
    const before = snapshot()
    const record = applyMerge(db, { keep, remove }, 'now')
    expect(
      db.prepare('SELECT * FROM transactions WHERE id=?').get('keep'),
    ).toMatchObject({
      category_id: 'cat',
      spread_months: 3,
      notes: 'Trip; leumi account 1 card 1111 cycle A',
    })
    expect(db.prepare('SELECT id FROM transactions').all()).toHaveLength(2)
    expect(
      db.prepare('SELECT tag_id FROM transaction_tags ORDER BY tag_id').all(),
    ).toEqual([{ tag_id: 'both' }, { tag_id: 'project' }])
    expect(db.prepare('SELECT * FROM transaction_links').get()).toMatchObject({
      transaction_id: 'other',
      linked_transaction_id: 'keep',
    })
    expect(
      db.prepare('SELECT * FROM transaction_valuations').get(),
    ).toMatchObject({
      transaction_id: 'keep',
      source_key: 'source-key',
    })
    undoMerge(db, record)
    expect(snapshot()).toEqual(before)
  })
  it('keeps a removed row from returning on the next import', () => {
    const { db, keep, remove } = memoryDb()
    applyMerge(db, { keep, remove }, 'now')
    const identities = importIdentities(db)
    expect(identities.map((r) => r.raw_hash)).toContain('hash-remove')
    expect(
      findFuzzyDuplicate(remove, buildFuzzyIndex(identities))?.merchant,
    ).toBe(remove.merchant)
    expect(wasMergedAway(db, 'source-key')).toBe(true)
    expect(wasMergedAway(db, 'another')).toBe(false)
  })
})
