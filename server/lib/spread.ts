/**
 * Billing spread utility — distributes large periodic expenses evenly across months.
 *
 * Spread goes **backward** from the payment date. E.g., an annual ₪6,000 payment
 * on 2026-01-15 with spread_months=12 distributes ₪500/month from 2025-02 to 2026-01.
 */

export interface SpreadTransaction {
  date: string
  amount: number
  spread_months: number
  category_id: string | null
}

export interface SpreadAdjustment {
  kind: 'expense' | 'income'
  month: string
  amount: number
  category_id: string | null
}

/**
 * Given spread transactions, compute per-month adjustments.
 * For each transaction:
 *   - Remove the full amount from its original month
 *   - Add (amount / spread_months) to each of the spread_months months ending at the payment month
 *
 * Returns an array of adjustments (additive deltas to apply to monthly totals).
 */
export function computeSpreadAdjustments(
  transactions: SpreadTransaction[],
): SpreadAdjustment[] {
  const adjustments: SpreadAdjustment[] = []

  for (const tx of transactions) {
    const n = tx.spread_months
    const perMonth = tx.amount / n
    const originalMonth = tx.date.slice(0, 7) // YYYY-MM

    // Remove the full amount from the original month
    adjustments.push({
      kind: tx.amount < 0 ? 'expense' : 'income',
      month: originalMonth,
      amount: -tx.amount,
      category_id: tx.category_id,
    })

    // Spread backward: from (payment month - n + 1) to payment month
    const [year, month] = originalMonth.split('-').map(Number)
    for (let i = 0; i < n; i++) {
      const d = new Date(year, month - 1 - (n - 1 - i), 1)
      const spreadMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      adjustments.push({
        kind: tx.amount < 0 ? 'expense' : 'income',
        month: spreadMonth,
        amount: perMonth,
        category_id: tx.category_id,
      })
    }
  }

  return adjustments
}

/**
 * Build a map of YYYY-MM → total adjustment amount from spread adjustments.
 * Optionally filter by category_id.
 */
export function buildSpreadMap(
  adjustments: SpreadAdjustment[],
  categoryId?: string | null,
): Map<string, number> {
  const map = new Map<string, number>()

  for (const adj of adjustments) {
    if (categoryId !== undefined && adj.category_id !== categoryId) continue
    map.set(adj.month, (map.get(adj.month) ?? 0) + adj.amount)
  }

  return map
}
