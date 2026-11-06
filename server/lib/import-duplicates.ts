import type Database from 'better-sqlite3'

import { cardIssuer } from './home/labels.js'

/**
 * One purchase stored twice under two spellings, because an earlier import saw a
 * different name than the posted statement. Identical strings may be two real
 * purchases, and rows on two different cards are real, so neither ever matches.
 */
export type DuplicateRow = {
  id: string
  date: string
  merchant: string
  amount: number
  category_id: string | null
  notes: string | null
  account_id: string
  is_internal: number
  spread_months: number | null
  source_file_id: string
  raw_hash: string
}

/** A posted charge from the bank's own record of the card. */
export type BankCharge = {
  card: string
  date: string
  merchant: string
  amount: number
  originalAmount?: number
}

export type DuplicatePair = { keep: DuplicateRow; remove: DuplicateRow }
export type UncertainPair = {
  a: DuplicateRow
  b: DuplicateRow
  reason: string
}

export function cardOf(notes: string | null): string | null {
  return notes?.match(/ card (\d+)/)?.[1] ?? null
}

const HEBREW = /[א-ת]/
const MACHINE_NOTE = /^(leumi account|scraper account)/

/** Lowercased with mirrored brackets unified; `)פ` and `(פ` are one bank name. */
function spelling(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[()]/g, '(')
    .replace(/\s+/g, ' ')
    .trim()
}

/** One name is the other cut short, as statements cut names at a fixed width. */
export function isTruncation(a: string, b: string): boolean {
  const [x, y] = [spelling(a), spelling(b)]
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 6 && long.startsWith(short)
}

function merchantKey(merchant: string): string {
  return (merchant.toLowerCase().match(/[\p{L}\p{N}]/gu) ?? []).join('')
}

/** Shared-prefix match for rows already known to be on the same card. */
export function sameMerchant(a: string, b: string): boolean {
  const [x, y] = [merchantKey(a), merchantKey(b)]
  let n = 0
  while (n < x.length && n < y.length && x[n] === y[n]) n += 1
  return n >= 6 && n >= 0.6 * Math.min(x.length, y.length)
}

function postedCharges(a: DuplicateRow, bank: BankCharge[]): BankCharge[] {
  const cents = (value: number) => Math.round(Math.abs(value) * 100)
  return bank.filter(
    (c) =>
      c.date === a.date &&
      (cents(c.amount) === cents(a.amount) ||
        (c.originalAmount !== undefined &&
          cents(c.originalAmount) === cents(a.amount))),
  )
}

function keepRank(row: DuplicateRow, posted: BankCharge[]): number[] {
  return [
    row.category_id ? 1 : 0,
    HEBREW.test(row.merchant) ? 1 : 0,
    cardOf(row.notes) ? 1 : 0,
    posted.some((c) => c.merchant === row.merchant) ? 1 : 0,
    row.merchant.length,
  ]
}

/**
 * Pairs safe to merge, and near misses for a person to judge. A merge needs the bank's
 * own record to show exactly one charge: two posted charges are two real purchases.
 * Checking-ledger card settlements are a separate question and are never returned.
 */
export function findImportDuplicates(
  rows: DuplicateRow[],
  bank: BankCharge[],
  since: string,
): { pairs: DuplicatePair[]; uncertain: UncertainPair[] } {
  const groups = new Map<string, DuplicateRow[]>()
  for (const row of rows) {
    if (row.date < since) continue
    if (!cardOf(row.notes) && cardIssuer(row.merchant)) continue
    const key = `${row.date}|${Math.round(row.amount * 100)}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const pairs: DuplicatePair[] = []
  const uncertain: UncertainPair[] = []
  for (const group of groups.values()) {
    const used = new Set<string>()
    for (const a of group) {
      for (const b of group) {
        if (a.id >= b.id || used.has(a.id) || used.has(b.id)) continue
        if (a.merchant === b.merchant) continue
        if (a.source_file_id === b.source_file_id) continue
        const [cardA, cardB] = [cardOf(a.notes), cardOf(b.notes)]
        if (cardA && cardB && cardA !== cardB) continue
        const known = !!cardA && !!cardB
        const related = known
          ? sameMerchant(a.merchant, b.merchant)
          : isTruncation(a.merchant, b.merchant)
        if (!related) continue
        if (!cardA && !cardB) {
          uncertain.push({ a, b, reason: 'no card on either row' })
          continue
        }
        if (a.category_id && b.category_id && a.category_id !== b.category_id) {
          uncertain.push({ a, b, reason: 'categories differ' })
          continue
        }
        const card = cardA ?? cardB
        const posted = postedCharges(a, bank).filter(
          (c) =>
            c.card === card &&
            (sameMerchant(c.merchant, a.merchant) ||
              sameMerchant(c.merchant, b.merchant)),
        )
        if (posted.length !== 1) {
          uncertain.push({
            a,
            b,
            reason: posted.length
              ? `bank shows ${posted.length} charges`
              : 'not in the bank record',
          })
          continue
        }
        used.add(a.id).add(b.id)
        const [ra, rb] = [keepRank(a, posted), keepRank(b, posted)]
        const firstDifference = ra.findIndex((value, i) => value !== rb[i])
        const keepA =
          firstDifference === -1 || ra[firstDifference] > rb[firstDifference]
        pairs.push(keepA ? { keep: a, remove: b } : { keep: b, remove: a })
      }
    }
  }
  return { pairs, uncertain }
}

/** User text first: card and cycle are read from the end of machine notes. */
export function mergedNotes(
  keep: string | null,
  remove: string | null,
): string | null {
  const parts = [keep, remove]
    .flatMap((note) => (note ? note.split('; ') : []))
    .filter((part, i, all) => all.indexOf(part) === i)
  const text = parts.filter((part) => !MACHINE_NOTE.test(part))
  const machine = parts.filter((part) => MACHINE_NOTE.test(part))
  // A card row has one machine note; a second would only repeat its source.
  const joined = [...text, ...machine.slice(0, 1)].join('; ')
  return joined || null
}

export type MergeRecord = {
  mergedAt: string
  keptBefore: DuplicateRow
  removed: Record<string, unknown>
  tags: string[]
  addedTags: string[]
  links: Record<string, unknown>[]
  valuation: Record<string, unknown> | null
  valuationMoved: boolean
}

/** Moves everything keyed to the removed row, then records its import identity. */
export function applyMerge(
  db: Database.Database,
  pair: DuplicatePair,
  mergedAt: string,
): MergeRecord {
  const { keep, remove } = pair
  const removed = db
    .prepare('SELECT * FROM transactions WHERE id=?')
    .get(remove.id) as Record<string, unknown>
  const tags = (
    db
      .prepare('SELECT tag_id FROM transaction_tags WHERE transaction_id=?')
      .all(remove.id) as { tag_id: string }[]
  ).map((row) => row.tag_id)
  const addTag = db.prepare(
    'INSERT OR IGNORE INTO transaction_tags (transaction_id,tag_id) VALUES (?,?)',
  )
  const addedTags = tags.filter((tag) => addTag.run(keep.id, tag).changes > 0)
  db.prepare('DELETE FROM transaction_tags WHERE transaction_id=?').run(
    remove.id,
  )

  const links = db
    .prepare(
      'SELECT * FROM transaction_links WHERE transaction_id=? OR linked_transaction_id=?',
    )
    .all(remove.id, remove.id) as Record<string, unknown>[]
  db.prepare(
    'DELETE FROM transaction_links WHERE transaction_id=? OR linked_transaction_id=?',
  ).run(remove.id, remove.id)
  const addLink = db.prepare(
    'INSERT OR IGNORE INTO transaction_links (id,transaction_id,linked_transaction_id,link_type,created_at) VALUES (?,?,?,?,?)',
  )
  for (const link of links) {
    const from =
      link.transaction_id === remove.id ? keep.id : link.transaction_id
    const to =
      link.linked_transaction_id === remove.id
        ? keep.id
        : link.linked_transaction_id
    if (from !== to)
      addLink.run(link.id, from, to, link.link_type, link.created_at)
  }

  const valuation = (db
    .prepare('SELECT * FROM transaction_valuations WHERE transaction_id=?')
    .get(remove.id) ?? null) as Record<string, unknown> | null
  const keptHasValuation = !!db
    .prepare('SELECT 1 FROM transaction_valuations WHERE transaction_id=?')
    .get(keep.id)
  const valuationMoved = !!valuation && !keptHasValuation
  if (valuationMoved)
    db.prepare(
      'UPDATE transaction_valuations SET transaction_id=? WHERE transaction_id=?',
    ).run(keep.id, remove.id)
  else
    db.prepare('DELETE FROM transaction_valuations WHERE transaction_id=?').run(
      remove.id,
    )

  // A row without a card takes the card and its account from the row that has one.
  const takeCard = !cardOf(keep.notes) && !!cardOf(remove.notes)
  db.prepare(
    `UPDATE transactions SET category_id=?, notes=?, spread_months=?, is_internal=?, account_id=? WHERE id=?`,
  ).run(
    keep.category_id ?? remove.category_id,
    mergedNotes(keep.notes, remove.notes),
    keep.spread_months ?? remove.spread_months,
    keep.is_internal || remove.is_internal ? 1 : 0,
    takeCard ? remove.account_id : keep.account_id,
    keep.id,
  )
  db.prepare(
    `INSERT INTO merged_transactions (removed_id,kept_id,date,merchant,amount,raw_hash,source_key,merged_at) VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    remove.id,
    keep.id,
    remove.date,
    remove.merchant,
    remove.amount,
    remove.raw_hash,
    (valuation?.source_key as string | undefined) ?? null,
    mergedAt,
  )
  db.prepare('DELETE FROM transactions WHERE id=?').run(remove.id)
  return {
    mergedAt,
    keptBefore: keep,
    removed,
    tags,
    addedTags,
    links,
    valuation,
    valuationMoved,
  }
}

/** Restores a merge exactly from its record. */
export function undoMerge(db: Database.Database, record: MergeRecord): void {
  const { keptBefore: keep, removed } = record
  const columns = Object.keys(removed)
  db.prepare(
    `INSERT INTO transactions (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
  ).run(...columns.map((column) => removed[column] as string | number | null))
  db.prepare(
    `UPDATE transactions SET category_id=?, notes=?, spread_months=?, is_internal=?, account_id=? WHERE id=?`,
  ).run(
    keep.category_id,
    keep.notes,
    keep.spread_months,
    keep.is_internal,
    keep.account_id,
    keep.id,
  )
  const addTag = db.prepare(
    'INSERT OR IGNORE INTO transaction_tags (transaction_id,tag_id) VALUES (?,?)',
  )
  const dropTag = db.prepare(
    'DELETE FROM transaction_tags WHERE transaction_id=? AND tag_id=?',
  )
  for (const tag of record.tags) addTag.run(removed.id as string, tag)
  for (const tag of record.addedTags) dropTag.run(keep.id, tag)
  const dropLink = db.prepare('DELETE FROM transaction_links WHERE id=?')
  const addLink = db.prepare(
    'INSERT OR IGNORE INTO transaction_links (id,transaction_id,linked_transaction_id,link_type,created_at) VALUES (?,?,?,?,?)',
  )
  for (const link of record.links) {
    dropLink.run(link.id as string)
    addLink.run(
      link.id as string,
      link.transaction_id as string,
      link.linked_transaction_id as string,
      link.link_type as string,
      link.created_at as string,
    )
  }
  if (record.valuationMoved)
    db.prepare(
      'UPDATE transaction_valuations SET transaction_id=? WHERE transaction_id=?',
    ).run(removed.id as string, keep.id)
  else if (record.valuation) {
    const keys = Object.keys(record.valuation)
    db.prepare(
      `INSERT INTO transaction_valuations (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    ).run(
      ...keys.map((key) => record.valuation?.[key] as string | number | null),
    )
  }
  db.prepare('DELETE FROM merged_transactions WHERE removed_id=?').run(
    removed.id as string,
  )
}

/**
 * What imports compare against: every stored row plus every row merged away. A merged
 * row keeps blocking its spelling, so the next import cannot bring it back.
 */
export function importIdentities(
  db: Database.Database,
  options: { excludeValued?: boolean } = {},
): { date: string; amount: number; merchant: string; raw_hash: string }[] {
  const stored = options.excludeValued
    ? 'SELECT date, amount, merchant, raw_hash FROM transactions t WHERE NOT EXISTS (SELECT 1 FROM transaction_valuations v WHERE v.transaction_id=t.id)'
    : 'SELECT date, amount, merchant, raw_hash FROM transactions'
  return db
    .prepare(
      `${stored} UNION ALL SELECT date, amount, merchant, raw_hash FROM merged_transactions`,
    )
    .all() as {
    date: string
    amount: number
    merchant: string
    raw_hash: string
  }[]
}

export function wasMergedAway(
  db: Database.Database,
  sourceKey: string,
): boolean {
  return !!db
    .prepare('SELECT 1 FROM merged_transactions WHERE source_key=?')
    .get(sourceKey)
}
