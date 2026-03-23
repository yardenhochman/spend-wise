import { createHash } from 'crypto'
import type { FuzzyIndex, FuzzyIndexEntry } from '../types.js'

/**
 * Normalize merchant name for consistent hashing across all sources.
 * Strips card/account suffixes, normalizes whitespace, trims.
 */
export function normalizeMerchant(merchant: string): string {
  return (merchant || 'Unknown')
    .replace(/\s+כרטיס\s+\d+\s*$/, '') // "פלאפל כרטיס 4" → "פלאפל"
    .replace(/\s+חשבון\s+[\d-]+\s*$/, '') // "פלאפל חשבון 123" → "פלאפל"
    .replace(/\s{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .trim()
}

/**
 * Normalize amount to integer agorot (cents) to avoid float issues.
 */
export function normalizeAmount(amount: number): number {
  return Math.round(amount * 100)
}

/**
 * Generate a dedup hash from normalized fields.
 * All sources produce the same hash for the same real-world transaction.
 */
export function generateDedupHash(
  date: string,
  amount: number,
  merchant: string,
): string {
  const normalMerchant = normalizeMerchant(merchant)
  const normalAmount = normalizeAmount(amount)
  return createHash('sha256')
    .update(`${date}|${normalAmount}|${normalMerchant}`)
    .digest('hex')
}

/**
 * Build a fuzzy lookup index from existing transactions.
 * Groups by date for fast querying, including ±1 day neighbors.
 */
export function buildFuzzyIndex(existingTxns: FuzzyIndexEntry[]): FuzzyIndex {
  const byDate: FuzzyIndex = new Map()
  for (const tx of existingTxns) {
    const d = tx.date
    if (!byDate.has(d)) byDate.set(d, [])
    byDate.get(d)!.push(tx)
    // Also index ±1 day for settlement date mismatches
    const prev = shiftDate(d, -1)
    const next = shiftDate(d, +1)
    if (!byDate.has(prev)) byDate.set(prev, [])
    byDate.get(prev)!.push({ ...tx, _fuzzyDate: true })
    if (!byDate.has(next)) byDate.set(next, [])
    byDate.get(next)!.push({ ...tx, _fuzzyDate: true })
  }
  return byDate
}

/**
 * Check if a transaction has a fuzzy duplicate in the index.
 * Returns the matching existing transaction, or null.
 *
 * Match criteria:
 * - Date: exact or ±1 day (via the index)
 * - Amount: within ±50 agorot (0.5 ILS)
 * - Merchant: exact match after normalization
 */
export function findFuzzyDuplicate(
  tx: { date: string; amount: number; merchant: string },
  fuzzyIndex: FuzzyIndex,
): FuzzyIndexEntry | null {
  const candidates = fuzzyIndex.get(tx.date) || []
  const normalMerchant = normalizeMerchant(tx.merchant)
  const normalAmount = normalizeAmount(tx.amount)

  for (const existing of candidates) {
    const existingMerchant = normalizeMerchant(existing.merchant)
    const existingAmount = normalizeAmount(existing.amount)

    // Amount within ±50 agorot
    if (Math.abs(normalAmount - existingAmount) > 50) continue

    // Merchant must match after normalization
    if (normalMerchant !== existingMerchant) continue

    return existing
  }
  return null
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
