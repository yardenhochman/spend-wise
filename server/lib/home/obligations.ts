import { createHash } from 'node:crypto'
import { addDays, dueDate, median, monthOffset, round } from './dates.js'
import { isChecking } from './household.js'
import type {
  Cadence,
  Commitment,
  HomeTransaction,
  Kind,
  MortgageSnapshot,
  Obligation,
} from './types.js'
export function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 20)}`
}
export function inferCadence(dates: string[]): Cadence {
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))].sort()
  const gaps = months
    .slice(1)
    .map(
      (m, i) =>
        (Number(m.slice(0, 4)) - Number(months[i].slice(0, 4))) * 12 +
        Number(m.slice(5)) -
        Number(months[i].slice(5)),
    )
  const gap = median(gaps)
  return gap === 1
    ? 'monthly'
    : gap === 2
      ? 'bimonthly'
      : gap === 12
        ? 'yearly'
        : 'irregular'
}
export function matchesObligation(o: Obligation, tx: HomeTransaction): boolean {
  return (
    isChecking(tx) &&
    tx.amount < 0 &&
    !tx.is_internal &&
    (o.kind === 'mortgage'
      ? tx.category_name === 'Mortgage' ||
        tx.merchant.toLowerCase().includes(o.matchPattern.toLowerCase())
      : tx.merchant.toLowerCase().includes(o.matchPattern.toLowerCase()))
  )
}
export function detectObligations(
  rows: HomeTransaction[],
  today: string,
): Obligation[] {
  const groups = new Map<string, HomeTransaction[]>()
  for (const t of rows) {
    if (
      !isChecking(t) ||
      t.is_internal ||
      t.amount >= 0 ||
      t.date > today ||
      t.category_name === 'Mortgage'
    )
      continue
    const list = groups.get(t.merchant) ?? []
    list.push(t)
    groups.set(t.merchant, list)
  }
  return [...groups]
    .flatMap(([merchant, txs]) => {
      const dates = txs.map((t) => t.date).sort()
      const cadence = inferCadence(dates)
      if (
        new Set(dates.map((d) => d.slice(0, 7))).size < 3 ||
        cadence === 'irregular'
      )
        return []
      if (
        dates.at(-1)! <
        monthOffset(
          today,
          cadence === 'yearly' ? -13 : cadence === 'bimonthly' ? -4 : -3,
        ) +
          '-01'
      )
        return []
      const kind: Kind = /ארנונה|arnona|municipal/i.test(merchant)
        ? 'tax'
        : /tuition|שכר לימוד|גן ילדים|school/i.test(merchant)
          ? 'tuition'
          : /ועד|hoa/i.test(merchant)
            ? 'hoa'
            : /loan|הלוואה/i.test(merchant)
              ? 'loan'
              : /חשמל|מים|electric|water|utility/i.test(merchant)
                ? 'utility'
                : 'other'
      const monthly = [...new Set(dates.map((d) => d.slice(0, 7)))].map(
        (m) =>
          -txs
            .filter((t) => t.date.startsWith(m))
            .reduce((a, t) => a + t.amount, 0),
      )
      return [
        {
          id: stableId('suggested', merchant),
          name: merchant,
          kind,
          expectedAmount: round(median(monthly.slice(-3))),
          cadence,
          dueDay: Math.round(median(dates.map((d) => Number(d.slice(8))))),
          matchPattern: merchant,
          confirmed: false,
          anchorMonth: dates[0].slice(0, 7),
          tolerance: 0.15,
        },
      ]
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}
export function mortgageObligation(
  snapshot: MortgageSnapshot | null,
  today: string,
): Obligation[] {
  if (!snapshot?.mortgages.length) return []
  const active = snapshot.mortgages.filter(
    (m) => !m.mortgageEndDate || m.mortgageEndDate >= today,
  )
  const amounts = active.map((m) => m.lastPaymentAmount ?? m.trackPaymentTotal)
  const amount = amounts.every((a) => a !== null)
    ? round(amounts.reduce<number>((s, a) => s + (a ?? 0), 0))
    : null
  return active.length
    ? [
        {
          id: 'mortgage-household',
          name: 'Mortgage',
          kind: 'mortgage',
          expectedAmount: amount && amount > 0 ? amount : null,
          cadence: 'monthly',
          dueDay: active[0].dayOfPayment ?? 1,
          matchPattern: 'משכנת',
          confirmed: false,
          anchorMonth: active
            .map((m) => m.bookingDate?.slice(0, 7) ?? today.slice(0, 7))
            .sort()[0],
          tolerance: 0.15,
        },
      ]
    : []
}
export function occursInMonth(o: Obligation, month: string): boolean {
  const delta =
    (Number(month.slice(0, 4)) - Number(o.anchorMonth.slice(0, 4))) * 12 +
    Number(month.slice(5)) -
    Number(o.anchorMonth.slice(5))
  if (delta < 0) return false
  return (
    o.cadence === 'monthly' ||
    (o.cadence === 'bimonthly' && delta % 2 === 0) ||
    (o.cadence === 'yearly' && delta % 12 === 0)
  )
}
export function obligationTrail(
  o: Obligation,
  rows: HomeTransaction[],
  months: string[],
  today: string,
  graceDays = 5,
): Commitment {
  const payments = rows.filter(
    (t) => matchesObligation(o, t) && t.date <= today,
  )
  let note: string | null = null
  const trail = months.map((month) => {
    if (o.cadence !== 'irregular' && !occursInMonth(o, month))
      return { month, status: 'none' as const, amount: null }
    const matching = payments.filter((t) => t.date.startsWith(month))
    const amount = matching.length
      ? round(-matching.reduce((s, t) => s + t.amount, 0))
      : null
    if (
      amount !== null &&
      (o.expectedAmount === null ||
        Math.abs(amount - o.expectedAmount) <=
          Math.max(1, o.expectedAmount * o.tolerance))
    )
      return { month, status: 'paid' as const, amount }
    if (o.cadence === 'irregular' && amount === null)
      return { month, status: 'none' as const, amount: null }
    if (amount !== null && o.expectedAmount !== null)
      note = `Payment differs from expected by ${round(amount - o.expectedAmount)} ILS in ${month}`
    const status = !o.confirmed
      ? ('unconfirmed' as const)
      : o.cadence !== 'irregular' &&
          today > addDays(dueDate(month, o.dueDay), graceDays)
        ? ('late' as const)
        : ('due' as const)
    return { month, status, amount }
  })
  const { id, name, kind, expectedAmount, cadence, confirmed } = o
  return { id, name, kind, expectedAmount, cadence, confirmed, trail, note }
}
export function obligationEvents(
  obligations: Obligation[],
  rows: HomeTransaction[],
  today: string,
  end: string,
) {
  const events = []
  for (let m = today.slice(0, 7); m <= end.slice(0, 7); m = monthOffset(m, 1))
    for (const o of obligations) {
      const date = dueDate(m, o.dueDay)
      if (
        date < today ||
        date > end ||
        !occursInMonth(o, m) ||
        o.expectedAmount === null
      )
        continue
      if (obligationTrail(o, rows, [m], today).trail[0].status === 'paid')
        continue
      events.push({
        date,
        label: o.name,
        amount: -o.expectedAmount,
        kind:
          o.kind === 'mortgage'
            ? ('mortgage' as const)
            : ('obligation' as const),
        estimated: true,
      })
    }
  return events
}
export function mortgageRepayments(snapshot: MortgageSnapshot | null) {
  return (snapshot?.mortgages ?? []).flatMap((m, i) =>
    m.clearingBalance === null
      ? []
      : [
          {
            id: stableId('mortgage', m.mortgageKey ?? String(i)),
            name: `Mortgage ${i + 1}`,
            remaining: m.clearingBalance,
            original: m.mortgageAmount,
            monthly: m.lastPaymentAmount ?? m.trackPaymentTotal,
            endDate: m.mortgageEndDate,
            source: 'mortgage' as const,
          },
        ],
  )
}
