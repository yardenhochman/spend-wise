/**
 * Merge one purchase stored twice under two spellings. Dry run by default.
 *   tsx server/merge-import-duplicates.ts --since 2025-11-06 --bank <outbox.json> [--write --record <private file>]
 *   tsx server/merge-import-duplicates.ts --undo <private file>
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { db, nowIso } from './db.js'
import { readBrokerInput } from './lib/broker-input.js'
import {
  applyMerge,
  cardOf,
  findImportDuplicates,
  undoMerge,
  type BankCharge,
  type DuplicateRow,
  type MergeRecord,
} from './lib/import-duplicates.js'

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function bankCharges(file: string): Promise<BankCharge[]> {
  const input = await readBrokerInput(file, 'leumi-cards')
  const accounts = input.payload.accounts as {
    cardLast4Digits: string
    transactions: Omit<BankCharge, 'card'>[]
  }[]
  return accounts.flatMap((account) =>
    account.transactions.map((tx) => ({
      card: account.cardLast4Digits,
      date: tx.date,
      merchant: tx.merchant,
      amount: tx.amount,
      originalAmount: tx.originalAmount,
    })),
  )
}

function totals(since: string) {
  return db
    .prepare(
      `SELECT COUNT(*) AS rows, ROUND(SUM(amount),2) AS net, ROUND(SUM(CASE WHEN category_id IS NULL AND amount<0 THEN amount ELSE 0 END),2) AS uncategorized
       FROM transactions WHERE date>=? AND is_internal=0`,
    )
    .get(since)
}

async function main() {
  const undoFile = option('--undo')
  if (undoFile) {
    const records = JSON.parse(readFileSync(undoFile, 'utf8')) as MergeRecord[]
    db.transaction(() => {
      for (const record of [...records].reverse()) undoMerge(db, record)
    })()
    console.log(`Restored ${records.length} rows`)
    return
  }
  const since = option('--since')
  const bankFile = option('--bank')
  if (!since || !bankFile) throw new Error('--since and --bank are required')
  const write = process.argv.includes('--write')
  const recordFile = option('--record')
  if (write && !recordFile) throw new Error('--write needs --record')

  const rows = db
    .prepare(
      'SELECT id,date,merchant,amount,category_id,notes,account_id,is_internal,spread_months,source_file_id,raw_hash FROM transactions',
    )
    .all() as DuplicateRow[]
  const { pairs, uncertain } = findImportDuplicates(
    rows,
    await bankCharges(bankFile),
    since,
  )
  const before = totals(since)
  const describe = (row: DuplicateRow) =>
    `${row.date} ${row.amount} [${row.merchant}] card=${cardOf(row.notes) ?? '-'} cat=${row.category_id ? 'yes' : 'no'}`
  for (const { keep, remove } of pairs)
    console.log(`MERGE keep ${describe(keep)} | remove ${describe(remove)}`)
  for (const { a, b, reason } of uncertain)
    console.log(`UNCERTAIN (${reason}) ${describe(a)} | ${describe(b)}`)
  const removedSpend = pairs.reduce((sum, p) => sum + p.remove.amount, 0)
  console.log(
    JSON.stringify(
      {
        mode: write ? 'write' : 'dry-run',
        pairs: pairs.length,
        removedSpend: Math.round(removedSpend * 100) / 100,
        uncertain: uncertain.length,
        before,
      },
      null,
      2,
    ),
  )
  if (!write) return
  const at = nowIso()
  const records = db.transaction(() =>
    pairs.map((pair) => applyMerge(db, pair, at)),
  )()
  writeFileSync(recordFile!, JSON.stringify(records, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ after: totals(since) }, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
