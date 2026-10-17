import { INTERNAL_SETTLEMENT_MERCHANTS } from '../internal-settlements.js'
import { dueDate, median, monthOffset, round } from './dates.js'
import { isChecking } from './household.js'
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
  const debits = rows.filter(
    (t) =>
      isChecking(t) &&
      t.amount < 0 &&
      t.date <= today &&
      /ויזה|visa|mastercard|ישראכרט|כרטיס|card settlement/i.test(t.merchant) &&
      (t.is_internal || INTERNAL_SETTLEMENT_MERCHANTS.includes(t.merchant)),
  )
  const day = debits.length
    ? Math.round(
        median(
          debits
            .filter((t) => t.date >= monthOffset(today, -6) + '-01')
            .map((t) => Number(t.date.slice(8))),
        ),
      )
    : 0
  // Without a source billing day, do not invent a debit date.
  if (!day) return []
  const cards = new Map<string, Map<string, number>>()
  for (const t of rows) {
    if (t.date > today || isChecking(t)) continue
    const c = parseBillingCycle(t.notes)
    if (!c || c.month < monthOffset(today, -3)) continue
    const cycles = cards.get(c.card) ?? new Map<string, number>()
    cycles.set(c.month, (cycles.get(c.month) ?? 0) + t.amount)
    cards.set(c.card, cycles)
  }
  if (!cards.size) {
    const byMonth = new Map<string, number>()
    for (const t of debits)
      byMonth.set(
        t.date.slice(0, 7),
        (byMonth.get(t.date.slice(0, 7)) ?? 0) + t.amount,
      )
    if (!byMonth.size) return []
    const amount = round(
      median(
        [...byMonth.entries()]
          .sort()
          .slice(-3)
          .map(([, v]) => v),
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
        !debits.some((t) => t.date.startsWith(m))
      )
        result.push({
          date,
          label: 'Card settlement',
          amount,
          kind: 'card',
          estimated: true,
        })
    }
    return result
  }
  const result: Event[] = []
  for (const [i, [card, cycles]] of [...cards.entries()].sort().entries()) {
    const suffix = card.split(':').at(-1)!
    const identifiedDebits = debits.filter((t) =>
      `${t.merchant} ${t.notes ?? ''}`.split(/\D+/).includes(suffix),
    )
    const cardDebits = identifiedDebits.length ? identifiedDebits : debits
    const cardDay = identifiedDebits.length
      ? Math.round(median(identifiedDebits.map((t) => Number(t.date.slice(8)))))
      : day
    const recent = [...cycles.entries()]
      .sort()
      .filter(([m]) => m >= monthOffset(today, -3) && m <= today.slice(0, 7))
    for (
      let m = today.slice(0, 7);
      m <= end.slice(0, 7);
      m = monthOffset(m, 1)
    ) {
      const date = dueDate(m, cardDay)
      if (date < today || date > end || cardDebits.some((t) => t.date === date))
        continue
      const knownAmount =
        cycles.get(m) ??
        (recent.length ? median(recent.map(([, v]) => v)) : null)
      if (knownAmount === null) continue
      const amount = round(knownAmount)
      if (amount < 0)
        result.push({
          date,
          label: `Card ${i + 1} settlement`,
          amount,
          kind: 'card',
          estimated: true,
        })
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
          label: 'Salary',
          amount,
          kind: 'salary',
          estimated: true,
        })
    }
    return result
  })
}
