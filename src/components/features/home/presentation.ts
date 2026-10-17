import { addDays, format, parseISO } from 'date-fns'
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
