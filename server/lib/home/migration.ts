import type Database from 'better-sqlite3'
/** Additive migration: retain the original primary rule and store its alternatives
 * alongside it, avoiding a table rebuild or changing existing foreign keys. */
export function migrateObligations(db: Database.Database): void {
  const add = (table: string, name: string, type: string) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string
    }[]
    if (!columns.some((c) => c.name === name))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
  }
  add('obligation_matching_rules', 'payee', 'TEXT')
  add('obligation_matching_rules', 'expected_amount', 'REAL')
  add('obligation_matching_rules', 'effective_from', 'TEXT')
  add(
    'obligation_matching_rules',
    'additional_rules',
    "TEXT NOT NULL DEFAULT '[]'",
  )
  add('obligations', 'paid_from', "TEXT NOT NULL DEFAULT 'tracked'")
  add('obligations', 'paid_from_label', 'TEXT')
  add('obligations', 'paid_from_since', 'TEXT')
  db.exec(`CREATE TABLE IF NOT EXISTS obligation_month_marks (
    obligation_id TEXT NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
    month TEXT NOT NULL, note TEXT, PRIMARY KEY(obligation_id,month))`)
}
