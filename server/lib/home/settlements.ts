import { dueDate, median, monthOffset, round } from './dates.js'
import { isChecking } from './household.js'
import { cardIssuer, transactionLabel } from './labels.js'
import type { Event, HomeTransaction } from './types.js'
const hebrewMonths = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
]
export function parseBillingCycle(
  notes: string | null,
): { card: string; month: string } | null {
  const m = notes?.match(/leumi account (\S+) card (\S+) cycle ([^;]+)/)
  if (!m) return null
  const label = m[3].trim()
  const iso = label.match(/^(\d{4}-\d{2})(?:-\d{2})?$/)
  const he = label.match(/^(\S+) (\d{4})$/)
  const index = he ? hebrewMonths.indexOf(he[1]) : -1
  const month =
    iso?.[1] ??
    (he && index >= 0 ? `${he[2]}-${String(index + 1).padStart(2, '0')}` : null)
  if (!month || Number(month.slice(5)) < 1 || Number(month.slice(5)) > 12)
    return null
  return { card: `${m[1]}:${m[2]}`, month }
}
export function cardSettlementEvents(
  rows: HomeTransaction[],
  today: string,
  end: string,
): Event[] {
  const cycles = new Map<string, Map<string, number>>()
  for (const t of rows) {
    if (t.date > today || isChecking(t)) continue
    const cycle = parseBillingCycle(t.notes)
    if (!cycle || cycle.month < monthOffset(today, -6)) continue
    const months = cycles.get(cycle.card) ?? new Map<string, number>()
    months.set(cycle.month, (months.get(cycle.month) ?? 0) + t.amount)
    cycles.set(cycle.card, months)
  }
  const groups = new Map<
    string,
    { issuer: string; debits: HomeTransaction[]; cards: string[] }
  >()
  const seen = new Map<string, HomeTransaction[]>()
  for (const t of rows) {
    const issuer = cardIssuer(t.merchant)
    if (
      !issuer ||
      !isChecking(t) ||
      t.amount >= 0 ||
      t.date > today ||
      t.date < monthOffset(today, -6) + '-01'
    )
      continue
    const card = [...cycles.keys()].find((key) =>
      `${t.merchant} ${t.notes ?? ''}`
        .split(/\D+/)
        .includes(key.split(':').at(-1)!),
    )
    const key = `${issuer}:${card ?? ''}`
    // Source spelling variants describe the same debit, not another card cycle.
    const debitKey = `${key}:${t.date.slice(0, 7)}:${round(t.amount)}`
    const previous = seen.get(debitKey) ?? []
    if (previous.some((p) => p.date === t.date || p.merchant !== t.merchant))
      continue
    previous.push(t)
    seen.set(debitKey, previous)
    const group = groups.get(key) ?? { issuer, debits: [], cards: [] }
    group.debits.push(t)
    if (card && !group.cards.includes(card)) group.cards.push(card)
    groups.set(key, group)
  }
  // Link unnumbered ledger entries only with unique observed cycle-amount evidence.
  // Otherwise the issuer ledger is the forecast source; never add unlinked cards on top.
  for (const [card, months] of cycles) {
    if ([...groups.values()].some((g) => g.cards.includes(card))) continue
    const candidates = [...groups.values()].filter((g) =>
      [...months].some(([month, amount]) =>
        g.debits.some(
          (t) => t.date.startsWith(month) && Math.abs(t.amount - amount) < 1,
        ),
      ),
    )
    if (candidates.length === 1) candidates[0].cards.push(card)
    else if (groups.size === 1 && [...groups.values()][0].issuer === 'card')
      [...groups.values()][0].cards.push(card)
  }
  const result: Event[] = []
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const monthly = new Map<string, HomeTransaction[]>()
    for (const t of group.debits) {
      const m = t.date.slice(0, 7)
      monthly.set(m, [...(monthly.get(m) ?? []), t])
    }
    const day = Math.round(
      median(
        [...monthly.values()].map((ts) =>
          Number([...ts].sort((a, b) => a.amount - b.amount)[0].date.slice(8)),
        ),
      ),
    )
    const ledgerEstimate = median(
      [...monthly]
        .sort()
        .slice(-3)
        .map(([, ts]) => ts.reduce((s, t) => s + t.amount, 0)),
    )
    const label = transactionLabel(
      [...group.debits].sort(
        (a, b) =>
          b.date.localeCompare(a.date) || a.merchant.localeCompare(b.merchant),
      )[0],
    )
    const known = new Map<string, number>()
    for (const card of group.cards)
      for (const [m, amount] of cycles.get(card)!)
        known.set(m, (known.get(m) ?? 0) + amount)
    const recent = [...known]
      .sort()
      .filter(([m]) => m <= today.slice(0, 7))
      .slice(-3)
    for (
      let m = today.slice(0, 7);
      m <= end.slice(0, 7);
      m = monthOffset(m, 1)
    ) {
      const date = dueDate(m, day)
      if (date < today || date > end || monthly.has(m)) continue
      const amount = round(
        known.get(m) ??
          (recent.length ? median(recent.map(([, a]) => a)) : ledgerEstimate),
      )
      if (amount < 0)
        result.push({ date, label, amount, kind: 'card', estimated: true })
    }
  }
  return result
}
export function salaryEvents(
  rows: HomeTransaction[],
  today: string,
  end: string,
): Event[] {
  const groups = new Map<string, HomeTransaction[]>()
  for (const t of rows)
    if (
      t.category_name === 'Salary' &&
      t.amount > 0 &&
      t.date <= today &&
      t.date >= monthOffset(today, -4) + '-01'
    ) {
      const list = groups.get(t.merchant) ?? []
      list.push(t)
      groups.set(t.merchant, list)
    }
  return [...groups.values()].flatMap((txs) => {
    const monthly = new Map<string, HomeTransaction[]>()
    for (const t of txs) {
      const list = monthly.get(t.date.slice(0, 7)) ?? []
      list.push(t)
      monthly.set(t.date.slice(0, 7), list)
    }
    if (
      monthly.size < 2 ||
      txs.every((t) => t.date < monthOffset(today, -2) + '-01')
    )
      return []
    const day = Math.round(median(txs.map((t) => Number(t.date.slice(8)))))
    const amount = round(
      median(
        [...monthly.values()].map((ts) => ts.reduce((s, t) => s + t.amount, 0)),
      ),
    )
    const result: Event[] = []
    for (
      let m = today.slice(0, 7);
      m <= end.slice(0, 7);
      m = monthOffset(m, 1)
    ) {
      const date = dueDate(m, day)
      if (
        date >= today &&
        date <= end &&
        !txs.some((t) => t.date.startsWith(m))
      )
        result.push({
          date,
          label: transactionLabel(txs.at(-1)!),
          amount,
          kind: 'salary',
          estimated: true,
        })
    }
    return result
  })
}
