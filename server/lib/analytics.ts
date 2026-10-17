import type Database from 'better-sqlite3'
import type { ViewModeFilter, TrendPoint, RecurringMerchant } from '../types.js'
import {
  computeSpreadAdjustments,
  buildSpreadMap,
  type SpreadTransaction,
} from './spread.js'
export function queryCategoryTrend(
  db: Database.Database,
  viewMode: ViewModeFilter,
  categoryId?: string,
  dateFrom?: string,
  dateTo?: string,
  granularity: 'day' | 'month' = 'month',
) {
  const where: string[] = ['t.is_internal = 0']
  const params: string[] = []

  if (categoryId) {
    where.push('t.category_id = ?')
    params.push(categoryId)
  } else {
    where.push('t.category_id IS NULL')
  }

  if (dateFrom) {
    where.push('t.date >= ?')
    params.push(dateFrom)
  }
  if (dateTo) {
    where.push('t.date <= ?')
    params.push(dateTo)
  }

  const whereSql = `WHERE ${where.join(' AND ')} ${viewMode.sql}`
  const allParams = [...params, ...viewMode.params]

  const periodExpr = granularity === 'day' ? 't.date' : 'substr(t.date, 1, 7)'

  const rows = db
    .prepare(
      `SELECT ${periodExpr} AS period, SUM(ABS(t.amount)) AS total
       FROM transactions t
       ${whereSql} AND t.amount < 0
       GROUP BY ${periodExpr}
       ORDER BY period ASC`,
    )
    .all(...allParams) as TrendPoint[]

  // ── Spread adjustments for category-trend ───────────────────────────────
  if (granularity === 'month') {
    const spreadExtra: string[] = ['t.amount < 0']
    const spreadParams: (string | number | null)[] = []
    if (categoryId) {
      spreadExtra.push('t.category_id = ?')
      spreadParams.push(categoryId)
    } else {
      spreadExtra.push('t.category_id IS NULL')
    }
    const spreadTxns = db
      .prepare(
        `SELECT t.date,t.amount,t.spread_months,t.category_id FROM transactions t WHERE t.spread_months IS NOT NULL AND t.is_internal=0 AND ${spreadExtra.join(' AND ')} ${viewMode.sql}`,
      )
      .all(...spreadParams, ...viewMode.params) as SpreadTransaction[]
    const spreadAdjs = computeSpreadAdjustments(spreadTxns)
    const spreadMap = buildSpreadMap(spreadAdjs)

    const rowMap = new Map(rows.map((r) => [r.period, r]))
    for (const [month, delta] of spreadMap) {
      if (dateFrom && month + '-31' < dateFrom) continue
      if (dateTo && month + '-01' > dateTo) continue
      const existing = rowMap.get(month)
      if (existing) {
        // Signed expense deltas reverse the payment before adding allocations.
        existing.total -= delta
      } else if (delta < 0) {
        // Only add months with expense spread
        const newRow = { period: month, total: Math.abs(delta) }
        rowMap.set(month, newRow)
        rows.push(newRow)
      }
    }
    rows.sort((a, b) => a.period.localeCompare(b.period))
  }

  const average =
    rows.length > 0
      ? rows.reduce((sum, r) => sum + r.total, 0) / rows.length
      : 0

  let peak: TrendPoint | null = null
  let lowest: TrendPoint | null = null
  for (const row of rows) {
    if (peak === null || row.total > peak.total) peak = row
    if (lowest === null || row.total < lowest.total) lowest = row
  }

  return {
    points: rows,
    average: Math.round(average * 100) / 100,
    peak: peak ?? null,
    lowest: lowest ?? null,
  }
}

export function queryRecurring(
  db: Database.Database,
  vmf: ViewModeFilter,
  now = new Date(),
) {
  // Compute a cutoff date for "recent" average (last 3 months)
  const recentCutoff = new Date(now)
  recentCutoff.setMonth(recentCutoff.getMonth() - 3)
  const recentDate = recentCutoff.toISOString().slice(0, 7) // YYYY-MM

  const rows = db
    .prepare(`
    SELECT
      t.merchant,
      c.name AS category_name,
      t.category_id,
      ROUND(AVG(t.amount), 2) AS avg_amount,
      ROUND((
        SELECT AVG(t2.amount)
        FROM transactions t2
        WHERE t2.merchant = t.merchant
          AND t2.is_recurring_candidate = 1
          AND t2.is_internal = 0
          AND substr(t2.date, 1, 7) >= ?
          ${vmf.sql.replaceAll('t.', 't2.')}
      ), 2) AS recent_avg_amount,
      COUNT(DISTINCT substr(t.date, 1, 7)) AS months_active,
      MAX(t.date) AS last_seen,
      MIN(t.date) AS first_seen,
      COUNT(*) AS tx_count
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.is_recurring_candidate = 1 AND t.is_internal = 0
      ${vmf.sql}
    GROUP BY t.merchant
    ORDER BY avg_amount ASC
  `)
    .all(recentDate, ...vmf.params, ...vmf.params) as Omit<
    RecurringMerchant,
    'is_active'
  >[]

  const twoMonthsAgo = new Date(now)
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)
  const cutoff = twoMonthsAgo.toISOString().slice(0, 10)

  const items: RecurringMerchant[] = rows.map((r) => ({
    ...r,
    is_active: r.last_seen >= cutoff,
  }))

  return items
}
