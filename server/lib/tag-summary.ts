export type TaggedAmount = {
  amount: number
  category_name: string | null
  valuation_status: string | null
}
export function summarizeTaggedAmounts(
  rows: TaggedAmount[],
  start: string | null,
  end: string | null,
) {
  const gross = rows.reduce((sum, r) => sum + Math.max(0, -r.amount), 0)
  const refunds = rows.reduce((sum, r) => sum + Math.max(0, r.amount), 0)
  const categories = new Map<string, number>()
  for (const row of rows) {
    const name = row.category_name ?? 'Uncategorized'
    categories.set(name, (categories.get(name) ?? 0) - row.amount)
  }
  const days =
    start && end
      ? Math.floor((Date.parse(end) - Date.parse(start)) / 86400000) + 1
      : null
  return {
    gross,
    refunds,
    net: gross - refunds,
    count: rows.length,
    estimated_count: rows.filter((r) => r.valuation_status === 'estimated')
      .length,
    days: days && days > 0 ? days : null,
    per_day: days && days > 0 ? (gross - refunds) / days : null,
    categories: Array.from(categories, ([name, amount]) => ({
      name,
      amount,
    })).sort((a, b) => b.amount - a.amount),
  }
}
