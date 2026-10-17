import type Database from 'better-sqlite3'
import type { HouseholdConfig } from '../private-config.js'
import { accountKey, allowedAccount } from './household.js'
import type { Balance } from './types.js'
export function extractBalances(
  payload: unknown,
  asOf: string,
  config?: HouseholdConfig,
): Balance[] {
  if (!Number.isFinite(Date.parse(asOf)))
    throw new Error('Invalid balance timestamp')
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('accounts' in payload) ||
    !Array.isArray(payload.accounts)
  )
    return []
  const result = new Map<string, Balance>()
  for (const a of payload.accounts as unknown[]) {
    if (
      !a ||
      typeof a !== 'object' ||
      !('accountNumber' in a) ||
      typeof a.accountNumber !== 'string' ||
      !allowedAccount(a.accountNumber, config)
    )
      continue
    if (
      !('balance' in a) ||
      typeof a.balance !== 'number' ||
      !Number.isFinite(a.balance)
    )
      continue
    const key = accountKey(a.accountNumber)
    result.set(key, {
      account_key: key,
      label: 'Checking',
      balance: a.balance,
      currency:
        'currency' in a && typeof a.currency === 'string' ? a.currency : 'ILS',
      as_of: new Date(asOf).toISOString(),
      source: 'leumi-bank',
    })
  }
  return [...result.values()]
    .sort((a, b) => a.account_key.localeCompare(b.account_key))
    .map((a, i) => ({ ...a, label: `Checking ${i + 1}` }))
}
export function persistBalances(
  db: Database.Database,
  balances: Balance[],
  importedAt: string,
): void {
  const insert = db.prepare(
    'INSERT INTO account_balances (account_key,label,balance,currency,as_of,source,imported_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(account_key,source,as_of) DO UPDATE SET balance=excluded.balance,currency=excluded.currency,imported_at=excluded.imported_at',
  )
  db.transaction(() => {
    for (const b of balances)
      insert.run(
        b.account_key,
        b.label,
        b.balance,
        b.currency,
        b.as_of,
        b.source,
        importedAt,
      )
  })()
}
export function latestBalances(
  rows: Balance[],
  today: string,
  config?: HouseholdConfig,
): Balance[] {
  const latest = new Map<string, Balance>()
  for (const b of rows) {
    if (
      b.source !== 'leumi-bank' ||
      b.currency !== 'ILS' ||
      !allowedAccount(b.account_key, config) ||
      b.as_of.slice(0, 10) > today
    )
      continue
    const key = accountKey(b.account_key)
    if (!latest.has(key) || latest.get(key)!.as_of < b.as_of) latest.set(key, b)
  }
  return [...latest.values()]
    .sort((a, b) => a.account_key.localeCompare(b.account_key))
    .map((b, i) => ({ ...b, label: `Checking ${i + 1}` }))
}
