import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { CommitmentsResponse, RunwayResponse } from '@/lib/types'

export function paymentCounts(
  obligations: CommitmentsResponse['obligations'],
  month: string,
) {
  const counts = { paid: 0, due: 0, late: 0 }
  for (const obligation of obligations) {
    const status = obligation.trail.find((t) => t.month === month)?.status
    if (status === 'paid' || status === 'due' || status === 'late')
      counts[status]++
  }
  return counts
}

export function upcomingEvents(data: RunwayResponse) {
  const future = data.events
    .filter((e) => e.date >= data.asOf)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!data.nextSalary) return future
  const fortnight = format(addDays(parseISO(data.asOf), 14), 'yyyy-MM-dd')
  const end =
    data.nextSalary.date > fortnight ? data.nextSalary.date : fortnight
  return future.filter((e) => e.date <= end)
}

export function relativeDay(date: string, today: string) {
  const days = differenceInCalendarDays(parseISO(date), parseISO(today))
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

/** Upcoming payments split into the next seven days and later, with what each group takes out. */
export function upcomingGroups(data: RunwayResponse) {
  const weekEnd = format(addDays(parseISO(data.asOf), 7), 'yyyy-MM-dd')
  const events = upcomingEvents(data)
  return [
    { title: 'Next 7 days', events: events.filter((e) => e.date <= weekEnd) },
    { title: 'Later', events: events.filter((e) => e.date > weekEnd) },
  ]
    .filter((group) => group.events.length > 0)
    .map((group) => ({
      ...group,
      out: group.events.reduce(
        (sum, e) => (e.amount < 0 ? sum - e.amount : sum),
        0,
      ),
    }))
}

/** The forecast balance at the end of the day before the next salary. */
export function leftBeforeSalary(data: RunwayResponse) {
  if (!data.nextSalary) return null
  const dayBefore = format(
    addDays(parseISO(data.nextSalary.date), -1),
    'yyyy-MM-dd',
  )
  return data.days.find((d) => d.date === dayBefore)?.balance ?? null
}

export function dueThisMonth(
  obligations: CommitmentsResponse['obligations'],
  month: string,
) {
  return obligations.reduce((sum, obligation) => {
    const status = obligation.trail.find((t) => t.month === month)?.status
    return status === 'due' || status === 'late'
      ? sum + (obligation.expectedAmount ?? 0)
      : sum
  }, 0)
}
