import { addDays, round } from './dates.js'
import type { Balance, Event, RunwayResponse } from './types.js'
export function buildRunway(
  today: string,
  count: number,
  balances: Balance[],
  events: Event[],
  warnings: string[] = [],
): RunwayResponse {
  const accounts = balances.map((b) => ({
    label: b.label,
    balance: b.balance,
    asOf: b.as_of,
  }))
  const openingBalance = balances.length
    ? round(balances.reduce((s, b) => s + b.balance, 0))
    : null
  // The oldest constituent date describes how current the combined balance is.
  const balanceAsOf = balances.map((b) => b.as_of).sort()[0] ?? null
  const end = addDays(today, count - 1)
  const sorted = events
    .filter((e) => e.date >= today && e.date <= end)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.kind.localeCompare(b.kind) ||
        a.label.localeCompare(b.label),
    )
  const resultWarnings = [...warnings]
  if (openingBalance === null)
    resultWarnings.push('No household balance snapshots available')
  if (balanceAsOf && addDays(balanceAsOf.slice(0, 10), 3) < today)
    resultWarnings.push('Balance snapshot is more than 3 days old')
  if (sorted.some((e) => e.kind === 'card'))
    resultWarnings.push('Card settlement amounts and dates are estimates')
  let balance = openingBalance ?? 0
  const days =
    openingBalance === null
      ? []
      : Array.from({ length: count }, (_, i) => {
          const date = addDays(today, i)
          balance = round(
            balance +
              sorted
                .filter((e) => e.date === date)
                .reduce((s, e) => s + e.amount, 0),
          )
          return { date, balance }
        })
  const low = days.reduce<RunwayResponse['low']>(
    (min, d) => (!min || d.balance < min.balance ? d : min),
    null,
  )
  const salary = sorted.find((e) => e.kind === 'salary')
  const nextSalary = salary
    ? {
        date: salary.date,
        amount: round(
          sorted
            .filter((e) => e.kind === 'salary' && e.date === salary.date)
            .reduce((s, e) => s + e.amount, 0),
        ),
      }
    : null
  return {
    asOf: today,
    openingBalance,
    balanceAsOf,
    accounts,
    days,
    events: sorted,
    low,
    nextSalary,
    warnings: [...new Set(resultWarnings)],
  }
}
