import { transferPayee, isGenericTransfer } from '../payees.js'
import { createHash } from 'node:crypto'
import { merchantKey } from '../merchant-labels.js'
import { addDays, dueDate, median, monthOffset, round } from './dates.js'
import { isChecking } from './household.js'
import {
  formatMoney,
  isBuildingFee,
  isObligationNoise,
  stableAmounts,
  transactionLabel,
} from './labels.js'
import type {
  Cadence,
  Commitment,
  HomeTransaction,
  Kind,
  MortgageSnapshot,
  Obligation,
  MatchingRule,
  TrailEntry,
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
  return gap === 1 || (gap <= 2 && gaps.includes(1))
    ? 'monthly'
    : gap === 2
      ? 'bimonthly'
      : gap === 12
        ? 'yearly'
        : 'irregular'
}
/** Whole calendar months for bills; nearest due date ±10 days for mortgage banking delays. */
function paymentMonth(o: Obligation, tx: HomeTransaction): string | null {
  const month = tx.date.slice(0, 7)
  if (o.kind !== 'mortgage') return month
  const nearest = [-1, 0, 1]
    .map((offset) => monthOffset(month, offset))
    .map((month) => ({
      month,
      distance: Math.abs(
        Date.parse(tx.date) - Date.parse(dueDate(month, o.dueDay)),
      ),
    }))
    .sort((a, b) => a.distance - b.distance)[0]
  return nearest.distance <= 10 * 86400000 ? nearest.month : null
}
function mortgageMerchant(o: Obligation, tx: HomeTransaction): boolean {
  return (
    /משכנת|mortgage|פרעון הלוואה|פירעון הלוואה|loan repayment|הוראת קבע|standing order/i.test(
      `${tx.merchant} ${tx.category_name ?? ''}`,
    ) || merchantKey(tx.merchant).includes(merchantKey(o.matchPattern))
  )
}
function amountMatches(
  actual: number,
  expected: number,
  tolerance: number,
): boolean {
  return Math.abs(actual - expected) <= Math.max(1, expected * tolerance)
}
export function activeRules(o: Obligation, month: string): MatchingRule[] {
  const rules = o.matchingRules ?? [{ pattern: o.matchPattern }]
  return rules.filter(
    (r) =>
      (!r.effectiveFrom || r.effectiveFrom <= month) &&
      !rules.some(
        (newer) =>
          merchantKey(newer.pattern) === merchantKey(r.pattern) &&
          merchantKey(newer.payee ?? '') === merchantKey(r.payee ?? '') &&
          (newer.effectiveFrom ?? '') > (r.effectiveFrom ?? '') &&
          newer.effectiveFrom! <= month,
      ),
  )
}
function matchingRule(
  o: Obligation,
  tx: HomeTransaction,
): MatchingRule | undefined {
  return activeRules(o, tx.date.slice(0, 7)).find((r) => {
    if (!merchantKey(tx.merchant).includes(merchantKey(r.pattern))) return false
    if (
      r.payee &&
      !merchantKey(transferPayee(tx.notes) ?? '').includes(merchantKey(r.payee))
    )
      return false
    const expected = r.expectedAmount ?? o.expectedAmount
    return !(
      (o.kind === 'loan' || o.kind === 'hoa') &&
      expected !== null &&
      !amountMatches(-tx.amount, expected, r.tolerance ?? o.tolerance)
    )
  })
}
export function matchesObligation(o: Obligation, tx: HomeTransaction): boolean {
  if (
    (!isChecking(tx) && o.kind !== 'hoa') ||
    tx.amount >= 0 ||
    isObligationNoise(tx)
  )
    return false
  if (o.paymentIds) return o.paymentIds.includes(tx.id)
  if (o.kind === 'mortgage') {
    return (
      mortgageMerchant(o, tx) &&
      o.expectedAmount !== null &&
      amountMatches(-tx.amount, o.expectedAmount, o.tolerance) &&
      paymentMonth(o, tx) !== null
    )
  }
  return !!matchingRule(o, tx)
}
/** Assign debits independently of confirmation. Combined mortgages share only an allocated amount. */
export function assignPayments(
  obligations: Obligation[],
  rows: HomeTransaction[],
): Obligation[] {
  const result = obligations.map((o) => ({
    ...o,
    paymentIds: [] as string[],
    paymentAmounts: {} as Record<string, number>,
  }))
  const used = new Set<string>()
  const mortgages = obligations
    .map((o, index) => ({ o, index }))
    .filter(({ o }) => o.kind === 'mortgage' && o.expectedAmount !== null)
  const groups = mortgages.map((m) => [m])
  // Consider pairs and complete same-pattern/day groups, without exponential subset search.
  for (let i = 0; i < mortgages.length; i++) {
    const group = mortgages.filter(
      ({ o }) =>
        o.dueDay === mortgages[i].o.dueDay &&
        merchantKey(o.matchPattern) ===
          merchantKey(mortgages[i].o.matchPattern),
    )
    for (const other of group.filter((m) => m.index > mortgages[i].index))
      groups.push([mortgages[i], other])
    if (group.length > 2 && group[0].index === mortgages[i].index)
      groups.push(group)
  }
  const edges = groups
    .flatMap((group) => {
      const expected = group.reduce((sum, { o }) => sum + o.expectedAmount!, 0)
      const tolerance = Math.min(...group.map(({ o }) => o.tolerance))
      return rows
        .filter(
          (t) =>
            isChecking(t) &&
            t.amount < 0 &&
            !isObligationNoise(t) &&
            group.every(
              ({ o }) =>
                mortgageMerchant(o, t) &&
                paymentMonth(o, t) !== null &&
                occursInMonth(o, paymentMonth(o, t)!),
            ) &&
            amountMatches(-t.amount, expected, tolerance),
        )
        .map((t) => ({
          group,
          expected,
          t,
          score:
            Math.abs(-t.amount / expected - 1) +
            Math.abs(
              Date.parse(t.date) -
                Date.parse(
                  dueDate(paymentMonth(group[0].o, t)!, group[0].o.dueDay),
                ),
            ) /
              86400000 /
              1000,
        }))
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.t.id.localeCompare(b.t.id) ||
        a.group[0].o.id.localeCompare(b.group[0].o.id),
    )
  const occurrences = new Set<string>()
  for (const { group, expected, t } of edges) {
    const keys = group.map(({ o, index }) => `${index}:${paymentMonth(o, t)}`)
    if (used.has(t.id) || keys.some((key) => occurrences.has(key))) continue
    let allocated = 0
    group.forEach(({ o, index }, i) => {
      const amount =
        i === group.length - 1
          ? round(-t.amount - allocated)
          : round((-t.amount * o.expectedAmount!) / expected)
      result[index].paymentIds.push(t.id)
      result[index].paymentAmounts[t.id] = amount
      allocated += amount
      occurrences.add(keys[i])
    })
    used.add(t.id)
  }
  const ordered = obligations
    .map((o, index) => ({ o, index }))
    .filter(({ o }) => o.kind !== 'mortgage')
    .sort(
      (a, b) =>
        Math.max(
          0,
          ...(b.o.matchingRules ?? []).map((r) => r.payee?.length ?? 0),
        ) -
          Math.max(
            0,
            ...(a.o.matchingRules ?? []).map((r) => r.payee?.length ?? 0),
          ) ||
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
      (!isChecking(t) && !isBuildingFee(t)) ||
      isObligationNoise(t) ||
      t.amount >= 0 ||
      t.date > today ||
      t.category_name === 'Mortgage'
    )
      continue
    const payee = isGenericTransfer(t.merchant) ? transferPayee(t.notes) : null
    const key = payee ? `payee:${merchantKey(payee)}` : t.merchant
    const list = groups.get(key) ?? []
    list.push(t)
    groups.set(key, list)
  }
  return [...groups]
    .flatMap(([groupKey, txs]) => {
      const merchant = txs.at(-1)!.merchant
      const payee = groupKey.startsWith('payee:')
        ? transferPayee(txs.at(-1)!.notes)
        : null
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
      const buildingFee =
        txs.some(isBuildingFee) ||
        /ועד בית|building committee/i.test(payee ?? '')
      if (
        buildingFee &&
        (cadence !== 'monthly' ||
          !stableAmounts(txs.slice(-6).map((t) => -t.amount)))
      )
        return []
      const kind: Kind = buildingFee
        ? 'hoa'
        : /ארנונה|arnona|municipal/i.test(merchant)
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
          id: stableId('suggested', groupKey),
          name:
            txs.at(-1)!.display_name && txs.at(-1)!.display_name !== merchant
              ? transactionLabel(txs.at(-1)!)
              : (payee ?? transactionLabel(txs.at(-1)!)),
          ...(payee
            ? {
                matchingRules: [...new Set(txs.map((t) => t.merchant))].map(
                  (pattern) => ({ pattern, payee }),
                ),
              }
            : {}),
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
function monthsBefore(
  o: Obligation,
  payments: HomeTransaction[],
  month: string,
): number[] {
  const totals = new Map<string, number>()
  for (const t of payments) {
    const m = paymentMonth(o, t)
    if (m && m < month)
      totals.set(
        m,
        (totals.get(m) ?? 0) + (o.paymentAmounts?.[t.id] ?? -t.amount),
      )
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
  const trail: TrailEntry[] = months.map((month): TrailEntry => {
    if (
      o.cadence !== 'irregular' &&
      !occursInMonth(o, month) &&
      !Object.hasOwn(o.monthMarks ?? {}, month)
    )
      return { month, status: 'none' as const, amount: null }
    const matching = payments.filter((t) => paymentMonth(o, t) === month)
    const amount = matching.length
      ? round(
          matching.reduce(
            (s, t) => s + (o.paymentAmounts?.[t.id] ?? -t.amount),
            0,
          ),
        )
      : null
    const expected = matching.length
      ? (matchingRule(o, matching[0])?.expectedAmount ?? o.expectedAmount)
      : o.expectedAmount
    const prior = monthsBefore(o, payments, month)
    const stable =
      prior.length >= 3 && coefficientOfVariation(prior.slice(-6)) <= 0.05
    const mismatch =
      amount !== null &&
      expected !== null &&
      (o.confirmed || stable) &&
      Math.abs(amount - expected) >
        Math.max(20, expected * (o.kind === 'mortgage' ? o.tolerance : 0.05))
    if (
      o.cadence === 'irregular' &&
      amount === null &&
      !Object.hasOwn(o.monthMarks ?? {}, month)
    )
      return { month, status: 'none' as const, amount: null }
    if (mismatch)
      note = `The payment in ${month} was ${formatMoney(Math.abs(amount! - expected!))} ${amount! > expected! ? 'above' : 'below'} the expected ${formatMoney(expected!)}.`
    const evidence = matching.map((t) => ({
      date: t.date,
      amount: o.paymentAmounts?.[t.id] ?? -t.amount,
      payee: transferPayee(t.notes) ?? t.merchant,
    }))
    if (Object.hasOwn(o.monthMarks ?? {}, month))
      return {
        month,
        status: 'paid',
        amount,
        markedByYou: true,
        manualNote: o.monthMarks![month],
        payments: evidence,
      }
    if (amount !== null)
      return { month, status: 'paid', amount, payments: evidence }
    if (
      o.paidFrom === 'untracked' &&
      (!o.paidFromSince || month >= o.paidFromSince)
    )
      return { month, status: 'external', amount: null }
    const status = !o.confirmed
      ? ('unconfirmed' as const)
      : o.cadence !== 'irregular' &&
          today > addDays(dueDate(month, o.dueDay), graceDays)
        ? ('late' as const)
        : ('due' as const)
    return { month, status, amount }
  })
  const { id, name, kind, expectedAmount, cadence, confirmed } = o
  return {
    id,
    name,
    kind,
    expectedAmount,
    cadence,
    confirmed,
    trail,
    note,
    rawMerchant: o.rawMerchant,
    paidFrom: o.paidFrom,
    paidFromLabel: o.paidFromLabel,
  }
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
      if (
        (o.paidFrom === 'untracked' &&
          (!o.paidFromSince || m >= o.paidFromSince)) ||
        Object.hasOwn(o.monthMarks ?? {}, m)
      )
        continue
      // Card-paid commitments are already included in the checking card settlement.
      const latestPayment = rows
        .filter((t) => t.date <= today && matchesObligation(o, t))
        .sort((a, b) => a.date.localeCompare(b.date))
        .at(-1)
      if (latestPayment && !isChecking(latestPayment)) continue
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
            t.date <= today &&
            paymentMonth(o, t) === m &&
            matchesObligation(o, t),
        )
      )
        continue
      events.push({
        date,
        label: o.name,
        rawMerchant: latestPayment?.merchant,
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
