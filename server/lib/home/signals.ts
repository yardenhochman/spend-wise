import { merchantKey } from '../merchant-labels.js'
import { addDays, monthOffset } from './dates.js'
import { isChecking } from './household.js'
import { cardIssuer } from './labels.js'
import { isGenericTransfer } from '../payees.js'
import type { DataFreshness, HomeTransaction } from './types.js'

/** The private Telegram alerts use the same thresholds, so both channels agree. */
const DOUBLE_CHARGE_MINIMUM = 100
const DOUBLE_CHARGE_WINDOW_DAYS = 14
const DOUBLE_CHARGE_GAP_DAYS = 2
const AVOIDABLE_MINIMUM = 50
const STALE_AFTER_DAYS = 3
const INTEREST = /ריבית חובה|ריבית אשראים/
const FEE = /עמל/

/** One card, or the checking accounts. Two cards charged alike are two people's fees, not a double charge. */
function payingCard(t: HomeTransaction) {
  return (
    t.notes?.match(/ card (\d+)/)?.[1] ?? (isChecking(t) ? 'checking' : null)
  )
}
function dayGap(a: string, b: string) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
}
function cardCycle(t: HomeTransaction) {
  return t.notes?.match(/ cycle (.+)$/)?.[1] ?? null
}
function spending(t: HomeTransaction) {
  return (
    t.amount < 0 && !t.is_internal && !(isChecking(t) && cardIssuer(t.merchant))
  )
}

/**
 * Pairs that look like one purchase billed twice: identical merchant on the same card.
 * Installments bill in different cycles, so they never match. Two spellings of one
 * purchase are an import duplicate, which is a data problem and not the merchant's error.
 */
export function doubleCharges(rows: HomeTransaction[], today: string) {
  const latest = rows.reduce(
    (max, t) => (t.date <= today && t.date > max ? t.date : max),
    '',
  )
  const since = addDays(latest || today, -DOUBLE_CHARGE_WINDOW_DAYS)
  const candidates = rows.filter(
    (t) =>
      spending(t) &&
      t.date >= since &&
      t.date <= today &&
      -t.amount >= DOUBLE_CHARGE_MINIMUM &&
      !isGenericTransfer(t.merchant),
  )
  const pairs: [HomeTransaction, HomeTransaction][] = []
  const used = new Set<string>()
  for (const [index, a] of candidates.entries()) {
    if (used.has(a.id)) continue
    const b = candidates.slice(index + 1).find((other) => {
      const larger = Math.max(-a.amount, -other.amount)
      const cycleA = cardCycle(a)
      const cycleB = cardCycle(other)
      return (
        !used.has(other.id) &&
        merchantKey(a.merchant) === merchantKey(other.merchant) &&
        payingCard(a) === payingCard(other) &&
        dayGap(a.date, other.date) <= DOUBLE_CHARGE_GAP_DAYS &&
        Math.abs(a.amount - other.amount) <= Math.max(2, 0.01 * larger) &&
        !(cycleA && cycleB && cycleA !== cycleB)
      )
    })
    if (b) {
      used.add(a.id).add(b.id)
      pairs.push([a, b])
    }
  }
  return pairs
}

/** Fees and overdraft interest: money that buys no quality of life. */
export function avoidableCosts(rows: HomeTransaction[], today: string) {
  const month = monthOffset(today, -1)
  const yearStart = monthOffset(today, -12) + '-01'
  const until = today.slice(0, 7) + '-01'
  const matching = rows.filter(
    (t) =>
      t.amount < 0 &&
      !t.is_internal &&
      t.date >= yearStart &&
      t.date < until &&
      (FEE.test(t.merchant) || (isChecking(t) && INTEREST.test(t.merchant))),
  )
  const sum = (items: HomeTransaction[]) =>
    items.reduce((total, t) => total - t.amount, 0)
  const lastMonth = matching.filter((t) => t.date.startsWith(month))
  const total = sum(lastMonth)
  if (total < AVOIDABLE_MINIMUM) return null
  return {
    month,
    total,
    interest: sum(lastMonth.filter((t) => INTEREST.test(t.merchant))),
    yearTotal: sum(matching),
    rows: lastMonth,
  }
}

/** When each source last showed a transaction. A successful fetch alone does not prove new data arrived. */
export function dataFreshness(
  rows: HomeTransaction[],
  today: string,
): DataFreshness[] {
  const latest = (items: HomeTransaction[]) =>
    items.reduce<string | null>(
      (max, t) => (t.date <= today && (!max || t.date > max) ? t.date : max),
      null,
    )
  return (
    [
      ['Checking', latest(rows.filter(isChecking))],
      ['Cards', latest(rows.filter((t) => !isChecking(t)))],
    ] as const
  ).flatMap(([label, through]) =>
    through
      ? [
          {
            label,
            through,
            stale: dayGap(through, today) > STALE_AFTER_DAYS,
          },
        ]
      : [],
  )
}
