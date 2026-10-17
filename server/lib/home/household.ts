import type { HouseholdConfig } from '../private-config.js'
import type { HomeTransaction } from './types.js'
export function accountKey(value: string): string {
  return value.replace(/^\d+-/, '').replace(/[_/]/g, '/').trim()
}
export function allowedAccount(
  value: string,
  config?: HouseholdConfig,
): boolean {
  return !!config?.accountNumbers.some(
    (n) => accountKey(n) === accountKey(value),
  )
}
/** Fail closed for numbered records; legacy PDF provenance requires explicit opt-in. */
export function householdTransaction(
  tx: HomeTransaction,
  config?: HouseholdConfig,
): boolean {
  if (tx.bank_name !== 'Leumi') return false
  const number = tx.notes?.match(/(?:scraper|leumi) account ([^ ;]+)/)?.[1]
  return number
    ? allowedAccount(number, config)
    : !!config?.legacyAccountIds?.includes(tx.account_id)
}
export function isChecking(tx: HomeTransaction): boolean {
  return (
    !/card/i.test(tx.account_label) && !tx.notes?.startsWith('leumi account ')
  )
}
