import { dueDate, median, monthOffset, round } from './dates.js'
import { accountKey, isChecking } from './household.js'
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
function settlementAccount(t: HomeTransaction): string {
  const number = t.notes?.match(/(?:scraper|leumi) account ([^ ;]+)/)?.[1]
  return number ? accountKey(number) : t.account_id
}
function billLabel(issuer: string | null, ordinal: number): string {
  const names: Record<string, string> = {
    visa: 'Visa card bill',
    mastercard: 'Mastercard bill',
    isracard: 'Isracard bill',
    cal: 'Cal card bill',
    max: 'Max card bill',
    'international-card': 'International card bill',
  }
  return issuer && names[issuer] ? names[issuer] : `Card ${ordinal} bill`
}
export function cardSettlementEvents(
  rows: HomeTransaction[],
  today: string,
  end: string,
): Event[] {
  const cycles = new Map<
    string,
    { account: string; months: Map<string, number> }
  >()
  for (const t of rows) {
    if (t.date > today || isChecking(t)) continue
    const cycle = parseBillingCycle(t.notes)
    if (!cycle || cycle.month < monthOffset(today, -6)) continue
    const item = cycles.get(cycle.card) ?? {
      account: settlementAccount(t),
      months: new Map<string, number>(),
    }
    item.months.set(cycle.month, (item.months.get(cycle.month) ?? 0) + t.amount)
    cycles.set(cycle.card, item)
  }
  const numberedCard = (t: HomeTransaction) =>
    [...cycles.keys()].find(
      (key) =>
        cycles.get(key)!.account === settlementAccount(t) &&
        `${t.merchant} ${(t.notes ?? '').replace(/(?:scraper|leumi) account [^ ;]+/, '')}`
          .split(/\D+/)
          .includes(key.split(':').at(-1)!),
    )
  const debits: HomeTransaction[] = []
  for (const t of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (
      !isChecking(t) ||
      !cardIssuer(t.merchant) ||
      t.amount >= 0 ||
      t.date > today ||
      t.date < monthOffset(today, -6) + '-01'
    )
      continue
    // Only duplicate source spellings collapse; separate debits remain evidence.
    if (
      debits.some(
        (p) =>
          settlementAccount(p) === settlementAccount(t) &&
          cardIssuer(p.merchant) === cardIssuer(t.merchant) &&
          numberedCard(p) === numberedCard(t) &&
          round(p.amount) === round(t.amount) &&
          p.date.slice(0, 7) === t.date.slice(0, 7) &&
          (p.date === t.date || p.merchant !== t.merchant),
      )
    )
      continue
    debits.push(t)
  }
  const linked = new Map<string, HomeTransaction[]>()
  for (const t of debits) {
    const eligible = [...cycles].filter(
      ([, c]) => c.account === settlementAccount(t),
    )
    const numbered = eligible.filter(([key]) =>
      `${t.merchant} ${(t.notes ?? '').replace(/(?:scraper|leumi) account [^ ;]+/, '')}`
        .split(/\D+/)
        .includes(key.split(':').at(-1)!),
    )
    const matching = numbered.length
      ? numbered
      : eligible.filter(
          ([, c]) =>
            Math.abs(
              (c.months.get(t.date.slice(0, 7)) ?? Infinity) - t.amount,
            ) < 1,
        )
    // Ambiguous equal-amount cards cannot both own the same checking debit.
    if (
      !matching.length &&
      eligible.length === 1 &&
      cardIssuer(t.merchant) === 'card'
    )
      matching.push(eligible[0])
    if (matching.length !== 1) continue
    const key = matching[0][0]
    linked.set(key, [...(linked.get(key) ?? []), t])
  }
  const result: Event[] = []
  let ordinal = 0
  for (const [key, cycle] of [...cycles].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    ordinal++
    const own = linked.get(key) ?? []
    const history = own.length ? own : debits
    if (!history.length) continue // Never invent a payment day without bank evidence.
    // Use the latest complete month's household debit days for unlinked cards.
    // Partial current-month early debits do not shift the remaining billing run.
    const complete = history.filter(
      (t) => t.date.slice(0, 7) < today.slice(0, 7),
    )
    const latestMonth = complete.at(-1)?.date.slice(0, 7)
    const datingHistory = own.length
      ? own
      : latestMonth
        ? complete.filter((t) => t.date.startsWith(latestMonth))
        : history
    const day = Math.round(
      median(datingHistory.map((t) => Number(t.date.slice(8)))),
    )
    const issuer = own.length ? cardIssuer(own.at(-1)!.merchant) : null
    const latest = own.at(-1)
    const label =
      latest?.display_name && latest.display_name !== latest.merchant
        ? transactionLabel(latest)
        : billLabel(issuer, ordinal)
    const recent = [...cycle.months]
      .sort()
      .filter(([m]) => m <= today.slice(0, 7))
      .slice(-3)
    for (
      let m = today.slice(0, 7);
      m <= end.slice(0, 7);
      m = monthOffset(m, 1)
    ) {
      const date = dueDate(m, day)
      if (date < today || date > end || own.some((t) => t.date.startsWith(m)))
        continue
      const amount = round(
        cycle.months.get(m) ?? median(recent.map(([, a]) => a)),
      )
      if (amount < 0)
        result.push({ date, label, amount, kind: 'card', estimated: true })
    }
  }
  // Detail cycles replace issuer aggregates for that account. Adding both would
  // count the same card twice when the ledger does not expose card identity.
  const detailAccounts = new Set([...cycles.values()].map((c) => c.account))
  const ledger = new Map<string, HomeTransaction[]>()
  for (const t of debits) {
    if (detailAccounts.has(settlementAccount(t))) continue
    const key = `${settlementAccount(t)}:${cardIssuer(t.merchant)}`
    ledger.set(key, [...(ledger.get(key) ?? []), t])
  }
  for (const ts of ledger.values()) {
    const monthly = new Map<string, number>()
    for (const t of ts)
      monthly.set(
        t.date.slice(0, 7),
        (monthly.get(t.date.slice(0, 7)) ?? 0) + t.amount,
      )
    const day = Math.round(median(ts.map((t) => Number(t.date.slice(8)))))
    const latest = ts.at(-1)!
    const label =
      latest.display_name && latest.display_name !== latest.merchant
        ? transactionLabel(latest)
        : billLabel(cardIssuer(latest.merchant), ++ordinal)
    const amount = round(
      median(
        [...monthly]
          .sort()
          .slice(-3)
          .map(([, a]) => a),
      ),
    )
    for (
      let m = today.slice(0, 7);
      m <= end.slice(0, 7);
      m = monthOffset(m, 1)
    ) {
      const date = dueDate(m, day)
      if (date >= today && date <= end && !monthly.has(m) && amount < 0)
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
  const employers = new Map<string, HomeTransaction[]>()
  for (const t of rows)
    if (
      isChecking(t) &&
      !t.is_internal &&
      t.category_name === 'Salary' &&
      t.amount > 0 &&
      t.date <= today &&
      t.date >= monthOffset(today, -4) + '-01'
    ) {
      const key = `${settlementAccount(t)}:${t.merchant}`
      employers.set(key, [...(employers.get(key) ?? []), t])
    }
  // Generic bank descriptions can represent both earners. Cluster recurring
  // payment days within each receiving account, allowing up to 3 days' delay.
  const streams: HomeTransaction[][] = []
  for (const [, txs] of [...employers].sort(([a], [b]) => a.localeCompare(b))) {
    const clusters: HomeTransaction[][] = []
    for (const t of [...txs].sort(
      (a, b) => Number(a.date.slice(8)) - Number(b.date.slice(8)),
    )) {
      const day = Number(t.date.slice(8))
      const cluster = clusters.find(
        (ts) =>
          Math.abs(day - median(ts.map((p) => Number(p.date.slice(8))))) <= 3,
      )
      if (cluster) cluster.push(t)
      else clusters.push([t])
    }
    streams.push(
      ...clusters.filter(
        (ts) => new Set(ts.map((t) => t.date.slice(0, 7))).size >= 2,
      ),
    )
  }
  return streams.flatMap((txs, index) => {
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
          label:
            streams.filter(
              (ts) =>
                transactionLabel(ts.at(-1)!) === transactionLabel(txs.at(-1)!),
            ).length > 1
              ? `Salary ${index + 1}`
              : transactionLabel(txs.at(-1)!),
          amount,
          kind: 'salary',
          estimated: true,
        })
    }
    return result
  })
}
