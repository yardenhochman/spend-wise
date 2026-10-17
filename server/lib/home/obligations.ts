import { createHash } from 'node:crypto'
import { addDays, dueDate, median, monthOffset, round } from './dates.js'
import { isChecking } from './household.js'
import { formatMoney, isObligationNoise, transactionLabel } from './labels.js'
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
  if (!isChecking(tx) || tx.amount >= 0 || isObligationNoise(tx)) return false
  if (o.paymentIds) return o.paymentIds.includes(tx.id)
  if (o.kind === 'mortgage') {
    const date = dueDate(tx.date.slice(0, 7), o.dueDay)
    return (
      (/משכנת|mortgage|פרעון הלוואה|פירעון הלוואה|loan repayment/i.test(
        `${tx.merchant} ${tx.category_name ?? ''}`,
      ) ||
        tx.merchant.toLowerCase().includes(o.matchPattern.toLowerCase())) &&
      o.expectedAmount !== null &&
      Math.abs(-tx.amount - o.expectedAmount) <=
        Math.max(1, o.expectedAmount * o.tolerance) &&
      Math.abs(Date.parse(tx.date) - Date.parse(date)) <= 5 * 86400000
    )
  }
  return tx.merchant.toLowerCase().includes(o.matchPattern.toLowerCase())
}
/** Assign mortgages first by closest amount/day; every debit has exactly one owner. */
export function assignPayments(
  obligations: Obligation[],
  rows: HomeTransaction[],
): Obligation[] {
  const result = obligations.map((o) => ({ ...o, paymentIds: [] as string[] }))
  const used = new Set<string>()
  const edges = obligations
    .flatMap((o, index) =>
      o.kind !== 'mortgage'
        ? []
        : rows
            .filter((t) =>
              matchesObligation({ ...o, paymentIds: undefined }, t),
            )
            .map((t) => ({
              index,
              t,
              score:
                Math.abs(-t.amount / o.expectedAmount! - 1) +
                Math.abs(Number(t.date.slice(8)) - o.dueDay) / 1000,
            })),
    )
    .sort(
      (a, b) =>
        a.score - b.score || a.t.id.localeCompare(b.t.id) || a.index - b.index,
    )
  const occurrences = new Set<string>()
  for (const { index, t } of edges) {
    const key = `${index}:${t.date.slice(0, 7)}`
    if (used.has(t.id) || occurrences.has(key)) continue
    result[index].paymentIds.push(t.id)
    used.add(t.id)
    occurrences.add(key)
  }
  const ordered = obligations
    .map((o, index) => ({ o, index }))
    .filter(({ o }) => o.kind !== 'mortgage')
    .sort(
      (a, b) =>
        Number(b.o.confirmed) - Number(a.o.confirmed) ||
        b.o.matchPattern.length - a.o.matchPattern.length ||
        a.o.id.localeCompare(b.o.id),
    )
  for (const t of rows) {
    if (used.has(t.id)) continue
    const owner = ordered.find(({ o }) =>
      matchesObligation({ ...o, paymentIds: undefined }, t),
    )
    if (owner) {
      result[owner.index].paymentIds.push(t.id)
      used.add(t.id)
    }
  }
  return result
}
export function detectObligations(
  rows: HomeTransaction[],
  today: string,
  minimum = 100,
): Obligation[] {
  const groups = new Map<string, HomeTransaction[]>()
  for (const t of rows) {
    if (
      !isChecking(t) ||
      isObligationNoise(t) ||
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
      const expectedAmount = round(median(monthly.slice(-3)))
      if (expectedAmount < minimum) return []
      return [
        {
          id: stableId('suggested', merchant),
          name: transactionLabel(txs.at(-1)!),
          kind,
          expectedAmount,
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
  return snapshot.mortgages.flatMap((m, i) => {
    if (m.mortgageEndDate && m.mortgageEndDate < today) return []
    const amount = m.lastPaymentAmount ?? m.trackPaymentTotal
    return [
      {
        id: stableId('mortgage', m.mortgageKey ?? String(i)),
        name: `Mortgage ${i + 1}`,
        kind: 'mortgage' as const,
        expectedAmount: amount && amount > 0 ? amount : null,
        cadence: 'monthly' as const,
        dueDay: m.dayOfPayment ?? 1,
        matchPattern: 'משכנת',
        confirmed: false,
        anchorMonth: m.bookingDate?.slice(0, 7) ?? today.slice(0, 7),
        tolerance: 0.15,
      },
    ]
  })
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
function monthsBefore(payments: HomeTransaction[], month: string): number[] {
  const totals = new Map<string, number>()
  for (const t of payments) {
    const m = t.date.slice(0, 7)
    if (m < month) totals.set(m, (totals.get(m) ?? 0) - t.amount)
  }
  return [...totals.entries()].sort().map(([, amount]) => amount)
}
function coefficientOfVariation(amounts: number[]): number {
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length
  return mean
    ? Math.sqrt(
        amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length,
      ) / mean
    : Infinity
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
    const prior = monthsBefore(payments, month)
    const stable =
      prior.length >= 3 && coefficientOfVariation(prior.slice(-6)) <= 0.05
    const mismatch =
      amount !== null &&
      o.expectedAmount !== null &&
      (o.confirmed || stable) &&
      Math.abs(amount - o.expectedAmount) >
        Math.max(
          20,
          o.expectedAmount * (o.kind === 'mortgage' ? o.tolerance : 0.05),
        )
    if (amount !== null && !mismatch)
      return { month, status: 'paid' as const, amount }
    if (o.cadence === 'irregular' && amount === null)
      return { month, status: 'none' as const, amount: null }
    if (mismatch)
      note = `The payment in ${month} was ${formatMoney(Math.abs(amount! - o.expectedAmount!))} ${amount! > o.expectedAmount! ? 'above' : 'below'} the expected ${formatMoney(o.expectedAmount!)}.`
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
  obligations = assignPayments(obligations, rows)
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
      if (
        rows.some(
          (t) =>
            t.date <= today && t.date.startsWith(m) && matchesObligation(o, t),
        )
      )
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
