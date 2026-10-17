import { describe, expect, it } from 'vitest'
import { recurringItems, buildBrief } from './brief.js'
import {
  detectObligations,
  obligationEvents,
  obligationTrail,
} from './obligations.js'
import { buildRunway } from './runway.js'
import { tx } from './test-fixtures.js'
import type { RecurringMerchant } from '../../types.js'

const today = '2030-06-18'
function history(
  merchant: string,
  category_name: string | null,
  amounts = [200, 200, 200],
) {
  return amounts.map((amount, i) =>
    tx({
      id: `${merchant}-${i}`,
      merchant,
      category_name,
      amount: -amount,
      date: `2030-0${i + 3}-10`,
    }),
  )
}
function candidate(merchant: string): RecurringMerchant {
  return {
    merchant,
    category_name: null,
    category_id: null,
    avg_amount: -200,
    recent_avg_amount: -200,
    months_active: 3,
    first_seen: '2030-03-10',
    last_seen: '2030-05-10',
    tx_count: 3,
    is_active: true,
  }
}
describe('home polish signals', () => {
  it('excludes habitual categories and merchants even with stable monthly amounts', () => {
    for (const [name, category] of [
      ['Synthetic food shop', 'Groceries'],
      ['Synthetic place', 'Dining'],
      ['Synthetic restaurant', null],
      ['פיצרייה לדוגמה', null],
      ['סופר לדוגמה', null],
      ['Synthetic bakery', 'Subscriptions'],
      ['Synthetic fuel', null],
    ])
      expect(
        recurringItems([candidate(name!)], history(name!, category), today),
        name!,
      ).toEqual([])
  })
  it('requires unknown merchants to have monthly cadence, stable amounts and one charge per month', () => {
    const name = 'Synthetic unknown'
    expect(
      recurringItems([candidate(name)], history(name, null), today),
    ).toHaveLength(1)
    expect(
      recurringItems(
        [candidate(name)],
        history(name, null, [100, 500, 200]),
        today,
      ),
    ).toEqual([])
    expect(
      recurringItems([candidate(name)], history(name, null).slice(1), today),
    ).toEqual([])
    const irregular = history(name, null).map((t, i) => ({
      ...t,
      date: ['2030-03-01', '2030-04-25', '2030-05-02'][i],
    }))
    expect(recurringItems([candidate(name)], irregular, today)).toEqual([])
    const frequent = [
      ...history(name, null),
      tx({
        merchant: name,
        category_name: null,
        date: '2030-05-20',
        amount: -200,
      }),
    ]
    expect(recurringItems([candidate(name)], frequent, today)).toEqual([])
    expect(
      recurringItems(
        [candidate(name)],
        history(name, 'Subscriptions', [100, 200, 300]),
        today,
      ),
    ).toHaveLength(1)
  })
  it('merges normalized service variants and aliases before computing per-occurrence cost', () => {
    const rows = history('GOOGLE YOUTUBEPREMIU', 'Subscriptions', [25, 25, 25])
    rows.push(...history('YouTube Premium', 'Subscriptions', [25, 25, 25]))
    const result = recurringItems(
      [candidate('GOOGLE YOUTUBEPREMIU'), candidate('YouTube Premium')],
      rows,
      today,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      merchant: 'YouTube Premium',
      amount: 25,
      annualized: 300,
    })
    const aliased = history('Synthetic raw', 'Subscriptions').map((t) => ({
      ...t,
      display_name: 'Synthetic Service',
    }))
    aliased.push(
      ...history('Synthetic.Service', 'Subscriptions').map((t) => ({
        ...t,
        display_name: 'Synthetic.Service',
      })),
    )
    expect(
      recurringItems(
        [candidate('Synthetic raw'), candidate('Synthetic.Service')],
        aliased,
        today,
      ),
    ).toHaveLength(1)
  })
  it('preserves separate same-service charges while merging their service row', () => {
    const rows = history('Synthetic insurance', 'Insurance', [60, 60, 60])
    rows.push(...history('Synthetic-insurance', 'Insurance', [40, 40, 40]))
    const result = recurringItems(
      [candidate('Synthetic insurance'), candidate('Synthetic-insurance')],
      rows,
      today,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ amount: 100, annualized: 1200 })
  })
  it('recognizes service merchants despite a broad shopping category and normalizes billing suffixes', () => {
    const rows = history('AMAZON PRIME PMTS', 'Online Shopping', [15, 15, 15])
    rows.push(
      ...history('AMAZON PRIME*SYNTHETIC', 'Online Shopping', [15, 15, 15]),
    )
    expect(
      recurringItems([candidate('AMAZON PRIME PMTS')], rows, today),
    ).toMatchObject([{ merchant: 'Amazon Prime', amount: 15, annualized: 180 }])
    expect(
      recurringItems(
        [candidate('Synthetic shop')],
        history('Synthetic shop', 'Online Shopping'),
        today,
      ),
    ).toEqual([])
  })
  it('detects stable monthly building fees on cards and checking, matches history and projects once', () => {
    const rows = history('חברת בניין לדוגמה דמי ניהול', 'Housing').map(
      (t, i) => ({ ...t, account_label: i === 0 ? 'Checking' : 'Credit Card' }),
    )
    const obligations = detectObligations(rows, today)
    expect(obligations).toHaveLength(1)
    expect(obligations[0]).toMatchObject({ kind: 'hoa', confirmed: false })
    expect(
      obligationTrail(obligations[0], rows, ['2030-05'], today).trail[0].status,
    ).toBe('paid')
    expect(
      obligationEvents(obligations, rows, today, '2030-07-31'),
    ).toHaveLength(0)
    const checking = rows.map((t) => ({ ...t, account_label: 'Checking' }))
    expect(
      obligationEvents(obligations, checking, today, '2030-07-31'),
    ).toHaveLength(1)
    expect(
      detectObligations(
        history('Synthetic building management', 'Housing', [100, 300, 200]),
        today,
      ),
    ).toEqual([])
    expect(
      detectObligations(
        history('Synthetic building management', 'Housing').slice(1),
        today,
      ),
    ).toEqual([])
    expect(
      detectObligations(
        history('Synthetic card shop', 'Shopping').map((t) => ({
          ...t,
          account_label: 'Credit Card',
        })),
        today,
      ),
    ).toEqual([])
  })
  it('isolates Hebrew names including trailing numbers inside English project/recurring sentences', () => {
    const label = 'פרויקט לדוגמה 2030'
    const b = buildBrief(
      today,
      [],
      [],
      [
        {
          merchant: 'שירות לדוגמה',
          amount: 100,
          cadence: 'monthly',
          annualized: 1200,
          flag: 'new',
          flagDetail: null,
          lastSeen: today,
        },
      ],
      [],
      [
        {
          tag: 'example',
          label,
          net: 100,
          status: 'ended',
          lastActivity: today,
        },
      ],
      buildRunway(today, 1, [], []),
      today,
    )
    expect(b.notices.map((n) => n.title)).toContain(
      `\u2068${label}\u2069 ended`,
    )
    expect(b.notices.find((n) => n.title.includes('ended'))!.body).toContain(
      `\u2068${label}\u2069 has ended`,
    )
    expect(b.notices.find((n) => n.title.includes('recurring'))!.title).toBe(
      '\u2068שירות לדוגמה\u2069: new recurring charge',
    )
  })
})
