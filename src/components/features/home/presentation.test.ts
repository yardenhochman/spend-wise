import { describe, expect, it } from 'vitest'
import { paymentCounts, upcomingEvents } from './presentation'
import { createHomeFixtures } from '../../../lib/home-fixtures'

describe('home presentation', () => {
  it('counts current-month paid/due/late statuses across confirmed and suggested obligations', () => {
    const base = createHomeFixtures().commitments.obligations[0]
    const obligations = (
      ['paid', 'due', 'late', 'unconfirmed', 'none'] as const
    ).flatMap((status) =>
      [true, false].map((confirmed) => ({
        ...base,
        confirmed,
        trail: [
          { month: '2030-05', status: 'paid' as const, amount: 100 },
          { month: '2030-06', status, amount: null },
        ],
      })),
    )
    expect(paymentCounts(obligations, '2030-06')).toEqual({
      paid: 2,
      due: 2,
      late: 2,
    })
    expect(paymentCounts([], '2030-06')).toEqual({ paid: 0, due: 0, late: 0 })
  })
  const base = {
    ...createHomeFixtures().runway,
    asOf: '2030-06-01',
    nextSalary: { date: '2030-06-03', amount: 1000 },
  }
  const events = [
    '2030-06-16',
    '2030-05-31',
    '2030-06-03',
    '2030-06-15',
    '2030-06-04',
  ].map((date) => ({
    date,
    label: 'Synthetic event',
    amount: -100,
    kind: 'obligation' as const,
    estimated: true,
  }))
  it('extends sparse salary windows through the inclusive next 14 days and sorts them', () => {
    expect(upcomingEvents({ ...base, events }).map((e) => e.date)).toEqual([
      '2030-06-03',
      '2030-06-04',
      '2030-06-15',
    ])
  })
  it('keeps every salary-day event and does not extend a window with at least three events', () => {
    const sameDay = Array.from({ length: 4 }, (_, i) => ({
      ...events[2],
      label: `Synthetic ${i}`,
    }))
    expect(
      upcomingEvents({ ...base, events: [...events.slice(0, 2), ...sameDay] }),
    ).toEqual(sameDay)
  })
  it('does not shorten a later salary window and keeps all available events when salary is unknown', () => {
    expect(
      upcomingEvents({
        ...base,
        nextSalary: { date: '2030-06-20', amount: 1000 },
        events,
      }),
    ).toHaveLength(4)
    expect(upcomingEvents({ ...base, nextSalary: null, events })).toHaveLength(
      4,
    )
  })
})
