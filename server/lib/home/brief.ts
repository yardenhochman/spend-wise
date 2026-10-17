import type { RecurringMerchant } from '../../types.js'
import { addDays, monthOffset, round } from './dates.js'
import { stableId } from './obligations.js'
import { isChecking } from './household.js'
import {
  cardIssuer,
  formatMoney,
  isObligationNoise,
  transactionLabel,
} from './labels.js'
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
          (t) =>
            t.merchant === r.merchant &&
            t.amount < 0 &&
            t.date <= today &&
            !isObligationNoise(t),
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
          merchant: transactionLabel(txs.at(-1)!),
          amount: round(amount),
          cadence: yearly ? ('yearly' as const) : ('monthly' as const),
          annualized: round(amount * (yearly ? 1 : 12)),
          lastSeen: r.last_seen,
          flag,
          flagDetail:
            flag === 'price-up' || flag === 'price-down'
              ? `${Math.round(change * 100)}% compared with its historical average.`
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
    (t) =>
      t.amount < 0 &&
      !t.is_internal &&
      !(isChecking(t) && cardIssuer(t.merchant)) &&
      t.date >= start &&
      t.date < until,
  )
  const recentExpenses = expenses.filter(
    (t) => t.date >= monthOffset(today, -3) + '-01',
  )
  const recentUnknown = recentExpenses.filter((t) => !t.category_name)
  const uncategorizedShare = recentExpenses.length
    ? recentUnknown.length / recentExpenses.length
    : 0
  const comparedShare = expenses.length
    ? expenses.filter((t) => !t.category_name).length / expenses.length
    : 0
  const notices: (BriefResponse['notices'][number] & { impact: number })[] = []
  function notice(
    key: string,
    severity: 'action' | 'watch' | 'info',
    title: string,
    body: string,
    txs: HomeTransaction[] = [],
    points: number[] | null = null,
    impact = 0,
    context = '',
  ) {
    notices.push({
      id: stableId('notice', key),
      severity,
      title,
      body,
      impact,
      chart: points ? { points } : null,
      evidenceTransactionIds: txs
        .map((t) => Number(t.id))
        .filter((n) => Number.isSafeInteger(n) && n > 0),
      agentPrompt: `Review this SpendWise household finding as of ${today}: ${title}. ${body} Scope: routine household transactions, internal transfers excluded. ${context} ${txs.length ? `Transaction IDs: ${txs.map((t) => t.id).join(', ')}.` : ''} Check the source records and explain the evidence and uncertainty before proposing changes.`,
    })
  }
  const mismatches = commitments.filter((o) => o.note)
  if (mismatches.length) {
    const impact = mismatches.reduce(
      (sum, o) =>
        sum +
        Math.max(
          0,
          ...o.trail
            .filter((t) => t.amount !== null && t.status !== 'paid')
            .map((t) => Math.abs(t.amount! - (o.expectedAmount ?? 0))),
        ),
      0,
    )
    notice(
      `mismatch:${mismatches
        .map((o) => `${o.id}:${o.note}`)
        .sort()
        .join('|')}`,
      'watch',
      mismatches.length === 1
        ? `${mismatches[0].name}: payment differs`
        : `${mismatches.length} commitment payments differ`,
      mismatches
        .slice(0, 3)
        .map((o) => `${o.name}: ${o.note}`)
        .join(' ') +
        (mismatches.length > 3 ? ' Other commitments also need a look.' : ''),
      [],
      null,
      impact,
      `Obligation IDs: ${mismatches.map((o) => o.id).join(', ')}.`,
    )
  }
  if (comparedShare > 0.3) {
    notice(
      `coverage:${today.slice(0, 7)}`,
      'info',
      `${Math.round(uncategorizedShare * 100)}% of recent transactions are uncategorized`,
      `Categorize spending before comparing categories. ${Math.round(comparedShare * 100)}% of transactions in the six-month comparison are uncategorized.`,
      expenses.filter((t) => !t.category_name),
      null,
      recentUnknown.reduce((s, t) => s - t.amount, 0),
      `Categorize the uncategorized household outflows from ${monthOffset(today, -3)}-01 through ${addDays(until, -1)}. Also categorize any remaining uncategorized outflows in the preceding three months. Review ambiguous merchants before applying categories. Category drift is suppressed because coverage across the six-month comparison is incomplete.`,
    )
  } else if (rows.some((t) => t.date.slice(0, 7) <= start.slice(0, 7))) {
    const changes = series
      .flatMap((c) => {
        const prior = c.points.slice(0, 3).reduce((a, b) => a + b, 0) / 3
        const recent = c.points.slice(3).reduce((a, b) => a + b, 0) / 3
        return prior > 0 &&
          Math.abs(recent / prior - 1) >= 0.25 &&
          Math.abs(recent - prior) >= 100
          ? [{ ...c, prior, recent, impact: Math.abs(recent - prior) }]
          : []
      })
      .sort((a, b) => b.impact - a.impact || a.id.localeCompare(b.id))
    if (changes.length)
      notice(
        `drift:${changes.map((c) => c.id).join(',')}:${today.slice(0, 7)}`,
        'watch',
        changes.length === 1
          ? `${changes[0].name} spending changed`
          : `${changes.length} spending categories changed`,
        changes
          .slice(0, 3)
          .map(
            (c) =>
              `${c.name} averaged ${formatMoney(c.recent)} a month, compared with ${formatMoney(c.prior)} in the preceding three months.`,
          )
          .join(' '),
        expenses.filter((t) => changes.some((c) => c.name === t.category_name)),
        changes[0].points,
        changes.reduce((s, c) => s + c.impact, 0),
      )
  }
  const changedRecurring = recurring
    .filter(
      (item) =>
        item.flag && ['new', 'price-up', 'price-down'].includes(item.flag),
    )
    .sort(
      (a, b) =>
        b.annualized - a.annualized || a.merchant.localeCompare(b.merchant),
    )
  if (changedRecurring.length)
    notice(
      `recurring:${changedRecurring
        .map(
          (i) =>
            `${i.merchant}:${i.flag}:${i.flag === 'new' ? 'first-detected' : i.amount}`,
        )
        .sort()
        .join('|')}`,
      'info',
      changedRecurring.length === 1
        ? `${changedRecurring[0].merchant}: ${changedRecurring[0].flag === 'new' ? 'new recurring charge' : 'price changed'}`
        : 'Recurring charges changed',
      changedRecurring
        .slice(0, 3)
        .map(
          (i) =>
            `${i.merchant} ${i.flag === 'new' ? 'is a new recurring charge' : 'has changed price'}, at about ${formatMoney(i.amount)} per ${i.cadence === 'yearly' ? 'year' : 'month'}.`,
        )
        .join(' '),
      rows.filter((t) =>
        changedRecurring.some((i) => i.merchant === transactionLabel(t)),
      ),
      null,
      changedRecurring.reduce((s, i) => s + i.amount, 0),
    )
  const ended = projects.filter(
    (p) =>
      p.status === 'ended' &&
      p.lastActivity &&
      p.lastActivity >= addDays(today, -90),
  )
  if (ended.length)
    notice(
      `projects:${ended
        .map((p) => p.tag)
        .sort()
        .join('|')}`,
      'info',
      ended.length === 1
        ? `${ended[0].label} ended`
        : `${ended.length} projects ended`,
      ended
        .slice(0, 3)
        .map(
          (p) =>
            `${p.label} has ended, with a final net cost of ${formatMoney(p.net)}.`,
        )
        .join(' '),
      [],
      null,
      ended.reduce((s, p) => s + Math.abs(p.net), 0),
    )
  if (runway.low && runway.low.balance < floor)
    notice(
      `runway:${runway.low.date}:${today.slice(0, 7)}`,
      'action',
      'Projected balance below your floor',
      `Your balance may reach ${formatMoney(runway.low.balance)} on ${runway.low.date}, below your ${formatMoney(floor)} floor. The forecast uses estimated payments.`,
      [],
      runway.days.map((d) => d.balance),
      floor - runway.low.balance,
    )
  if (!lastImportAt || lastImportAt.slice(0, 10) < addDays(today, -7))
    notice(
      `stale:${lastImportAt ?? 'missing'}`,
      'watch',
      'Household data needs updating',
      lastImportAt
        ? `The last household import was on ${lastImportAt.slice(0, 10)}. Recent activity may be missing.`
        : 'No completed household import is available.',
    )
  const priority = { action: 0, watch: 1, info: 2 }
  notices.sort(
    (a, b) =>
      priority[a.severity] - priority[b.severity] ||
      b.impact - a.impact ||
      a.id.localeCompare(b.id),
  )
  const selected = notices.slice(0, 5)
  const coverageNotice = notices.find(
    (n) => n.id === stableId('notice', `coverage:${today.slice(0, 7)}`),
  )
  // Keep the reason for suppressed comparisons visible when other info is crowded out.
  if (coverageNotice && !selected.includes(coverageNotice)) {
    selected[selected.length - 1] = coverageNotice
    selected.sort(
      (a, b) =>
        priority[a.severity] - priority[b.severity] ||
        b.impact - a.impact ||
        a.id.localeCompare(b.id),
    )
  }
  const visible = selected.map(({ impact: _impact, ...n }) => n)
  const count = visible.filter((n) => n.severity !== 'info').length
  return {
    weekOf,
    headline: count
      ? `${count} thing${count === 1 ? '' : 's'} worth a look.`
      : 'All good.',
    notices: visible,
    coverage: { uncategorizedShare: round(uncategorizedShare), lastImportAt },
  }
}
