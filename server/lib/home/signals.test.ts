import { describe, expect, it } from 'vitest'
import { buildBrief } from './brief.js'
import { avoidableCosts, dataFreshness, doubleCharges } from './signals.js'
import { tx } from './test-fixtures.js'
import type { RunwayResponse } from './types.js'

const today = '2030-06-15'
const card = (id: string, date: string, amount: number, cycle = 'June 2030') =>
  tx({
    id,
    date,
    amount,
    merchant: 'Synthetic shop',
    account_label: 'Credit Card',
    notes: `leumi account 111-22222_33 card 1234 cycle ${cycle}`,
  })
const runway: RunwayResponse = {
  asOf: today,
  openingBalance: 1000,
  balanceAsOf: null,
  accounts: [],
  days: [],
  events: [],
  low: null,
  nextSalary: null,
  warnings: [],
  freshness: [],
}
const brief = (rows: ReturnType<typeof tx>[], lastImport = today) =>
  buildBrief(today, rows, [], [], [], [], runway, lastImport)

describe('double charges', () => {
  it('pairs the same merchant and amount within two days', () => {
    const pairs = doubleCharges(
      [card('a', '2030-06-10', -250), card('b', '2030-06-11', -250)],
      today,
    )
    expect(pairs.map((p) => p.map((t) => t.id))).toEqual([['a', 'b']])
  })
  it('counts the window from the latest data', () => {
    const pairs = doubleCharges(
      [
        card('a', '2030-05-20', -250),
        card('b', '2030-05-20', -250),
        card('latest', '2030-05-28', -20),
      ],
      today,
    )
    expect(pairs).toHaveLength(1)
  })
  it('never pairs two cards or two spellings', () => {
    const other = {
      ...card('b', '2030-06-10', -106),
      notes: 'leumi account 111-22222_33 card 9999 cycle June 2030',
    }
    expect(
      doubleCharges([card('a', '2030-06-10', -106), other], today),
    ).toEqual([])
    expect(
      doubleCharges(
        [
          card('a', '2030-06-10', -250),
          { ...card('b', '2030-06-10', -250), merchant: 'Synthetic shop 2' },
        ],
        today,
      ),
    ).toEqual([])
  })
  it('drops a pair once the merchant has refunded one charge', () => {
    expect(
      doubleCharges(
        [
          card('a', '2030-06-10', -250),
          card('b', '2030-06-11', -250),
          card('refund', '2030-06-12', 250),
        ],
        today,
      ),
    ).toEqual([])
  })
  it('never pairs installments in different billing cycles', () => {
    expect(
      doubleCharges(
        [
          card('a', '2030-06-10', -250, 'June 2030'),
          card('b', '2030-06-11', -250, 'July 2030'),
        ],
        today,
      ),
    ).toEqual([])
  })
  it('ignores small, distant, old, internal and generic-transfer rows', () => {
    const cases = [
      [card('a', '2030-06-10', -40), card('b', '2030-06-10', -40)],
      [card('a', '2030-06-05', -250), card('b', '2030-06-10', -250)],
      [
        card('a', '2030-05-01', -250),
        card('b', '2030-05-01', -250),
        card('latest', '2030-06-14', -20),
      ],
      [
        { ...card('a', '2030-06-10', -250), is_internal: 1 },
        { ...card('b', '2030-06-10', -250), is_internal: 1 },
      ],
      [
        tx({
          id: 'a',
          merchant: 'הוראת קבע',
          date: '2030-06-10',
          amount: -250,
        }),
        tx({
          id: 'b',
          merchant: 'הוראת קבע',
          date: '2030-06-10',
          amount: -250,
        }),
      ],
    ]
    for (const rows of cases) expect(doubleCharges(rows, today)).toEqual([])
  })
  it('uses each charge in one pair only', () => {
    const pairs = doubleCharges(
      [
        card('a', '2030-06-10', -250),
        card('b', '2030-06-10', -250),
        card('c', '2030-06-10', -250),
      ],
      today,
    )
    expect(pairs).toHaveLength(1)
  })
  it('is an action notice showing both transactions', () => {
    const notice = brief([
      card('a', '2030-06-10', -250),
      card('b', '2030-06-10', -250),
    ]).notices[0]
    expect(notice.severity).toBe('action')
    expect(notice.evidence.map((e) => e.id).sort()).toEqual(['a', 'b'])
  })
})

describe('avoidable costs', () => {
  const fee = (date: string, amount: number, merchant = 'עמלת פעולה') =>
    tx({ id: `${date}-${amount}`, date, amount, merchant })
  it('totals last month and the last twelve months', () => {
    const costs = avoidableCosts(
      [
        fee('2030-05-02', -60),
        fee('2030-05-03', -40, 'ריבית חובה'),
        fee('2029-12-01', -200),
        fee('2030-06-01', -999),
        fee('2028-01-01', -999),
      ],
      today,
    )
    expect(costs).toMatchObject({
      month: '2030-05',
      total: 100,
      interest: 40,
      yearTotal: 300,
    })
  })
  it('stays quiet under the minimum', () => {
    expect(avoidableCosts([fee('2030-05-02', -10)], today)).toBeNull()
  })
  it('states the amount and shows the rows', () => {
    const notice = brief([fee('2030-05-02', -60)]).notices.find((n) =>
      n.title.includes('fees and interest'),
    )
    expect(notice?.title).toBe('₪60 went to fees and interest in May')
    expect(notice?.evidenceCount).toBe(1)
  })
})

describe('data freshness', () => {
  it('reports each source and marks gaps over three days', () => {
    expect(
      dataFreshness(
        [
          tx({ id: 'a', date: '2030-06-10' }),
          card('b', '2030-06-14', -10),
          card('future', '2030-07-01', -10),
        ],
        today,
      ),
    ).toEqual([
      { label: 'Checking', through: '2030-06-10', stale: true },
      { label: 'Cards', through: '2030-06-14', stale: false },
    ])
  })
  it('never says all good while a source is stale', () => {
    const result = brief([
      tx({ id: 'a', date: '2030-06-01' }),
      card('b', '2030-06-14', -10),
    ])
    expect(result.headline).toBe('1 thing worth a look.')
    expect(result.notices[0].title).toBe('No new checking activity since 1 Jun')
  })
})
