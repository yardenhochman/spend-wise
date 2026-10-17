import type Database from 'better-sqlite3'
import { normalizeMerchant } from './dedup.js'

export interface MerchantAlias {
  raw_pattern: string
  canonical_name: string
  match_type: string
  source?: string
}
export const merchantKey = (raw: string) =>
  normalizeMerchant(raw.normalize('NFKC'))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

export function migrateMerchantLabels(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(merchant_aliases)').all() as {
    name: string
  }[]
  db.transaction(() => {
    if (!columns.some((c) => c.name === 'source'))
      db.exec(
        "ALTER TABLE merchant_aliases ADD COLUMN source TEXT NOT NULL DEFAULT 'seed'",
      )
    const obligationColumns = db
      .prepare('PRAGMA table_info(obligations)')
      .all() as { name: string }[]
    if (!obligationColumns.some((c) => c.name === 'name_is_user'))
      db.exec(
        'ALTER TABLE obligations ADD COLUMN name_is_user INTEGER NOT NULL DEFAULT 1',
      )
    db.exec(`DROP INDEX IF EXISTS idx_merchant_aliases_pattern;
      CREATE UNIQUE INDEX idx_merchant_aliases_pattern ON merchant_aliases(raw_pattern,source)`)
  })()
}
export function readMerchantAliases(db: Database.Database): MerchantAlias[] {
  return db
    .prepare(`SELECT raw_pattern,canonical_name,match_type,source FROM merchant_aliases
    ORDER BY CASE source WHEN 'user' THEN 0 ELSE 1 END,
    CASE match_type WHEN 'exact' THEN 0 ELSE 1 END,length(raw_pattern) DESC,raw_pattern`)
    .all() as MerchantAlias[]
}
export function displayName(
  merchant: string,
  aliases: MerchantAlias[],
): string {
  const matches = (a: MerchantAlias) => {
    if (a.match_type === 'exact')
      return merchantKey(merchant) === merchantKey(a.raw_pattern)
    if (a.match_type === 'regex') {
      try {
        return new RegExp(a.raw_pattern, 'i').test(merchant)
      } catch {
        return false
      }
    }
    return merchant.toLowerCase().includes(a.raw_pattern.toLowerCase())
  }
  return (
    (
      aliases.find((a) => a.source === 'user' && matches(a)) ??
      aliases.find(matches)
    )?.canonical_name ?? merchant
  )
}
export function merchantFields(db: Database.Database, rawMerchant: string) {
  return {
    merchant: rawMerchant,
    displayName: displayName(rawMerchant, readMerchantAliases(db)),
  }
}
/** Search labels using the same resolver as display, including exact normalized matches. */
export function merchantSearch(db: Database.Database, query: string) {
  const aliases = readMerchantAliases(db)
  const rawNames = db
    .prepare('SELECT DISTINCT merchant FROM transactions')
    .all() as { merchant: string }[]
  const needle = query.toLowerCase()
  return rawNames
    .filter((r) =>
      displayName(r.merchant, aliases).toLowerCase().includes(needle),
    )
    .map((r) => r.merchant)
}
