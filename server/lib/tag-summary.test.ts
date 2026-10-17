import { describe, it, expect } from 'vitest'
import { summarizeTaggedAmounts } from './tag-summary.js'
describe('tag cost summaries', () => {
  it('nets refunds and counts estimates while using event dates for the daily average', () => {
    const result = summarizeTaggedAmounts(
      [
        {
          amount: -400,
          category_name: 'Trips Abroad',
          valuation_status: 'actual',
        },
        {
          amount: 100,
          category_name: 'Trips Abroad',
          valuation_status: 'actual',
        },
        { amount: -30, category_name: null, valuation_status: 'estimated' },
      ],
      '2030-02-01',
      '2030-02-11',
    )
    expect(result).toMatchObject({
      gross: 430,
      refunds: 100,
      net: 330,
      days: 11,
      per_day: 30,
      estimated_count: 1,
    })
    expect(result.categories[0]).toEqual({ name: 'Trips Abroad', amount: 300 })
  })
  it('retains net credits and does not invent a daily denominator', () => {
    expect(
      summarizeTaggedAmounts(
        [{ amount: 100, category_name: null, valuation_status: null }],
        null,
        null,
      ),
    ).toMatchObject({ net: -100, per_day: null })
  })
})
