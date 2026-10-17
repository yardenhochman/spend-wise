import type Database from 'better-sqlite3'
import type { HouseholdConfig } from './private-config.js'
import { merchantKey } from './merchant-labels.js'

/** Parse the bank transfer counterparty, never the scraper's source account. */
export function transferDestination(notes: string | null): string | null {
  return (
    notes
      ?.normalize('NFKC')
      .match(
        /(?:העברה\s+(?:לזכות|מאת|אל|ל)|transfer\s+to)(?:\s*:\s*|\s+)([^;\n]+)/iu,
      )?.[1]
      ?.trim() || null
  )
}
export function transferPayee(notes: string | null): string | null {
  const destination = transferDestination(notes)
  if (!destination) return null
  const name = destination
    .split(/\d|\.{2,}|תאריך סיום:/u)[0]
    .replace(/[\u2066-\u2069]/g, '')
    .replace(/[\s:,-]+$/u, '')
    .trim()
  return name || null
}
export function isGenericTransfer(merchant: string): boolean {
  return /הע\.?\s*אינט|העברה דיגיטל|הוראת קבע|standing order|internet transfer|digital transfer/i.test(
    merchant,
  )
}
export function ownAccountTransfer(
  notes: string | null,
  config?: HouseholdConfig,
): boolean {
  const destination = transferDestination(notes)
  if (!destination) return false
  const payee = transferPayee(notes)
  return !!config?.ownAccounts?.some((account) => {
    const pattern = account.match.trim()
    if (!pattern) return false
    // A numeric match is a destination account prefix. Named matches are exact,
    // never substrings of a different person's name or arbitrary memo text.
    if (/\d/.test(pattern))
      return (
        (destination.match(/\d+(?:[-־–]\d+)+/u)?.[0] ?? '')
          .replace(/[־–]/g, '-')
          .startsWith(
            pattern.replace(/[\s־–]/g, (match) => (match.trim() ? '-' : '')),
          ) ||
        (!/\d/.test(destination) &&
          !!account.payeePattern &&
          merchantKey(payee ?? '') === merchantKey(account.payeePattern))
      )
    return !!payee && merchantKey(payee) === merchantKey(pattern)
  })
}
/** Explicit non-own payees must not inherit broad legacy generic-transfer flags. */
export function flagOwnAccountTransfers(
  db: Database.Database,
  config?: HouseholdConfig,
): void {
  const rows = db
    .prepare(
      'SELECT id,merchant,notes FROM transactions WHERE notes IS NOT NULL',
    )
    .all() as { id: string; merchant: string; notes: string }[]
  const update = db.prepare('UPDATE transactions SET is_internal=? WHERE id=?')
  db.transaction(() => {
    for (const row of rows) {
      if (ownAccountTransfer(row.notes, config)) update.run(1, row.id)
      else if (
        config?.ownAccounts?.length &&
        isGenericTransfer(row.merchant) &&
        transferPayee(row.notes)
      )
        update.run(0, row.id)
    }
  })()
}
