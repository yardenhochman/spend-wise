import type { RecurringMerchant } from '../../types.js'
import { addDays, monthOffset, round } from './dates.js'
import { stableId } from './obligations.js'
import type {
  BriefResponse,
  Commitment,
  HomeTransaction,
  ProjectsResponse,
  RecurringItem,
  RunwayResponse,
} from './types.js'
export function recurringItems(
  items: RecurringMerchant[],
  rows: HomeTransaction[],
  today: string,
): RecurringItem[] {
  return items
    .filter((r) => r.avg_amount < 0)
    .flatMap((r) => {
      const txs = rows
        .filter(
          (t) => t.merchant === r.merchant && t.amount < 0 && t.date <= today,
        )
        .sort((a, b) => a.date.localeCompare(b.date))
      if (!txs.length) return []
      const gaps = txs
        .slice(1)
        .map(
          (t, i) => (Date.parse(t.date) - Date.parse(txs[i].date)) / 86400000,
        )
      const yearly = gaps.length > 0 && gaps.every((g) => g >= 330 && g <= 400)
      if (!yearly && !r.is_active) return []
      const amount = Math.abs(r.recent_avg_amount ?? r.avg_amount)
      const change =
        Math.abs(r.avg_amount) > 0 ? amount / Math.abs(r.avg_amount) - 1 : 0
      const flag: RecurringItem['flag'] =
        change > 0.1
          ? 'price-up'
          : change < -0.1
            ? 'price-down'
            : r.first_seen >= monthOffset(today, -3) + '-01'
              ? 'new'
              : yearly && addDays(r.last_seen, 365) <= addDays(today, 30)
                ? 'renewal-soon'
                : null
      return [
        {
          merchant: r.merchant,
          amount: round(amount),
          cadence: yearly ? ('yearly' as const) : ('monthly' as const),
          annualized: round(amount * (yearly ? 1 : 12)),
          lastSeen: r.last_seen,
          flag,
          flagDetail:
            flag === 'price-up' || flag === 'price-down'
              ? `${round(change * 100)}% vs historical average`
              : null,
        },
      ]
    })
}
export interface CategorySeries {
  id: string
  name: string
  points: number[]
}
export function buildBrief(
  today: string,
  rows: HomeTransaction[],
  commitments: Commitment[],
  recurring: RecurringItem[],
  series: CategorySeries[],
  projects: ProjectsResponse['projects'],
  runway: RunwayResponse,
  lastImportAt: string | null,
  floor = 0,
): BriefResponse {
  const day = new Date(today + 'T12:00:00Z').getUTCDay()
  const weekOf = addDays(today, -((day + 6) % 7))
  const start = monthOffset(today, -6) + '-01'
  const until = today.slice(0, 7) + '-01'
  const expenses = rows.filter(
    (t) => t.amount < 0 && t.date >= start && t.date < until,
  )
  const total = expenses.reduce((s, t) => s - t.amount, 0)
  const uncategorizedShare = total
    ? expenses
        .filter((t) => !t.category_name)
        .reduce((s, t) => s - t.amount, 0) / total
    : 0
  const notices: BriefResponse['notices'] = []
  function notice(
    key: string,
    severity: 'action' | 'watch' | 'info',
    title: string,
    body: string,
    txs: HomeTransaction[] = [],
    points: number[] | null = null,
  ) {
    notices.push({
      id: stableId('notice', key),
      severity,
      title,
      body,
      chart: points ? { points } : null,
      evidenceTransactionIds: txs
        .map((t) => Number(t.id))
        .filter((n) => Number.isSafeInteger(n) && n > 0),
      agentPrompt: `Review this SpendWise household finding as of ${today}: ${title}. ${body} Scope: routine household transactions, internal transfers excluded. ${txs.length ? `Transaction IDs: ${txs.map((t) => t.id).join(', ')}.` : ''} Check the source records and explain the evidence and uncertainty before proposing changes.`,
    })
  }
  for (const o of commitments)
    if (o.note)
      notice(
        `mismatch:${o.id}:${o.trail.filter((t) => t.amount !== null && t.status !== 'paid').at(-1)?.month}`,
        'watch',
        `${o.name}: payment differs`,
        `${o.note}. Expected per occurrence: ${o.expectedAmount ?? 'unavailable'} ILS. Obligation ID: ${o.id}.`,
        rows.filter((t) => t.merchant === o.name).slice(-8),
      )
  if (
    uncategorizedShare <= 0.2 &&
    rows.some((t) => t.date.slice(0, 7) <= start.slice(0, 7))
  )
    for (const c of series) {
      const prior = c.points.slice(0, 3).reduce((a, b) => a + b, 0) / 3
      const recent = c.points.slice(3).reduce((a, b) => a + b, 0) / 3
      if (
        prior > 0 &&
        Math.abs(recent / prior - 1) >= 0.25 &&
        Math.abs(recent - prior) >= 100
      )
        notice(
          `drift:${c.id}:${today.slice(0, 7)}`,
          'watch',
          `${c.name} spending changed`,
          `${round((recent / prior - 1) * 100)}% change comparing ${monthOffset(today, -3)}–${monthOffset(today, -1)} with ${monthOffset(today, -6)}–${monthOffset(today, -4)}. Monthly averages: ${round(recent)} ILS recent, ${round(prior)} ILS prior.`,
          expenses.filter((t) => t.category_name === c.name),
          c.points,
        )
    }
  for (const item of recurring)
    if (item.flag && ['new', 'price-up', 'price-down'].includes(item.flag))
      notice(
        `recurring:${item.merchant}:${item.flag}:${item.flag === 'new' ? 'first-detected' : item.amount}`,
        'info',
        `${item.merchant}: ${item.flag === 'new' ? 'new recurring charge' : 'price changed'}`,
        item.flagDetail ??
          `Recurring charge first detected recently; last seen ${item.lastSeen}.`,
        rows.filter((t) => t.merchant === item.merchant).slice(-12),
      )
  for (const p of projects)
    if (
      p.status === 'ended' &&
      p.lastActivity &&
      p.lastActivity >= addDays(today, -90)
    )
      notice(
        `project:${p.tag}`,
        'info',
        `${p.label} ended`,
        `The project has ended. Last transaction activity: ${p.lastActivity}. Final net cost: ${p.net} ILS.`,
      )
  if (runway.low && runway.low.balance < floor)
    notice(
      `runway:${runway.low.date}:${today.slice(0, 7)}`,
      'action',
      'Projected balance below your floor',
      `The estimated low point on ${runway.low.date} is ${runway.low.balance} ILS, below the configured floor of ${floor} ILS. Balance snapshot as of ${runway.balanceAsOf ?? 'unavailable'}. ${runway.warnings.join('; ')}`,
      [],
      runway.days.map((d) => d.balance),
    )
  if (!lastImportAt || lastImportAt.slice(0, 10) < addDays(today, -7))
    notice(
      `stale:${lastImportAt ?? 'missing'}`,
      'watch',
      'Household data needs updating',
      lastImportAt
        ? `Last household import: ${lastImportAt}. Forecasts may omit recent activity.`
        : 'No completed household import is available.',
    )
  notices.sort((a, b) => a.id.localeCompare(b.id))
  return {
    weekOf,
    headline: notices.length
      ? `${notices.length} thing${notices.length === 1 ? '' : 's'} worth a look.`
      : 'All good. Nothing needs a look.',
    notices,
    coverage: { uncategorizedShare: round(uncategorizedShare), lastImportAt },
  }
}
