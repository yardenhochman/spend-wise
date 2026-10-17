import { describe, expect, it } from 'vitest'
import {
  assignPayments,
  matchesObligation,
  obligationEvents,
  obligationTrail,
} from './obligations.js'
import { obligation, tx } from './test-fixtures.js'

const months = ['2030-05', '2030-06']
const trail = (
  o: ReturnType<typeof obligation>,
  rows: ReturnType<typeof tx>[],
  today = '2030-06-30',
) => obligationTrail(assignPayments([o], rows)[0], rows, months, today).trail
const mortgages = () => [
  obligation({
    id: 'first',
    kind: 'mortgage',
    matchPattern: 'משכנת',
    expectedAmount: 800,
    dueDay: 15,
  }),
  obligation({
    id: 'second',
    kind: 'mortgage',
    matchPattern: 'משכנת',
    expectedAmount: 300,
    dueDay: 15,
  }),
]

describe('confirmation-independent payment evidence', () => {
  it('keeps variable and split payments paid on confirmation, including differences beyond 15%', () => {
    const o = obligation({ expectedAmount: 200 })
    const rows = [
      tx({ id: 'may', date: '2030-05-28', amount: -350 }),
      tx({ id: 'june-first', amount: -80 }),
      tx({ id: 'june-second', date: '2030-06-29', amount: -160 }),
    ]
    expect(trail(o, rows)).toEqual(trail({ ...o, confirmed: true }, rows))
    expect(trail(o, rows).map((t) => [t.status, t.amount])).toEqual([
      ['paid', 350],
      ['paid', 240],
    ])
  })
  it('uses amount tolerance to isolate a loan from smaller repayments with the same description', () => {
    const o = obligation({ kind: 'loan', expectedAmount: 500 })
    const rows = [
      tx({ id: 'main', amount: -510 }),
      tx({ id: 'small', amount: -70 }),
      tx({ id: 'unrelated', amount: -140 }),
    ]
    expect(trail(o, rows)[1]).toMatchObject({ status: 'paid', amount: 510 })
    expect(trail({ ...o, confirmed: true }, rows)[1]).toEqual(trail(o, rows)[1])
    expect(matchesObligation(o, tx({ amount: -576 }))).toBe(false)
  })
  it('does not change ownership of overlapping patterns when either obligation is confirmed', () => {
    const os = [obligation({ id: 'b' }), obligation({ id: 'a' })]
    const rows = [tx()]
    const original = assignPayments(os, rows).map((o) => o.paymentIds)
    for (let index = 0; index < os.length; index++)
      expect(
        assignPayments(
          os.map((o, i) => ({ ...o, confirmed: index === i })),
          rows,
        ).map((o) => o.paymentIds),
      ).toEqual(original)
  })
  it('is due through the grace boundary and late only with no payment in the whole occurrence month', () => {
    const o = obligation({ confirmed: true })
    expect(trail(o, [], '2030-06-15')[1].status).toBe('due')
    expect(trail(o, [], '2030-06-16')[1].status).toBe('late')
    expect(trail(o, [tx({ date: '2030-06-01' })], '2030-06-16')[1].status).toBe(
      'paid',
    )
    expect(trail(o, [tx({ date: '2030-06-20' })], '2030-06-16')[1].status).toBe(
      'late',
    )
    expect(trail(o, [tx({ date: '2030-06-20' })], '2030-06-20')[1].status).toBe(
      'paid',
    )
  })
  it('counts the same raw building merchant on checking and cards after normalization, independently of display labels', () => {
    const o = obligation({
      kind: 'hoa',
      matchPattern: 'Synthetic HOA',
      expectedAmount: 100,
    })
    const rows = [
      tx({ id: 'bank', merchant: 'Synthetic HOA', date: '2030-05-10' }),
      tx({
        id: 'card',
        merchant: 'SYNTHETIC  HOA כרטיס 1234',
        display_name: 'Unrelated display label',
        account_label: 'Credit Card',
        date: '2030-06-26',
      }),
    ]
    expect(trail(o, rows).map((t) => t.status)).toEqual(['paid', 'paid'])
    expect(trail({ ...o, confirmed: true }, rows)).toEqual(trail(o, rows))
    expect(obligationEvents([o], rows, '2030-07-01', '2030-07-31')).toEqual([])
    expect(
      matchesObligation(
        o,
        tx({ merchant: 'Another merchant', display_name: 'Synthetic HOA' }),
      ),
    ).toBe(false)
  })
})

describe('mortgage debit allocation', () => {
  it('allocates a combined mortgage debit proportionally, preserving the total and suppressing both forecasts', () => {
    const os = mortgages()
    const rows = [
      tx({ merchant: 'Synthetic mortgage', date: '2030-06-16', amount: -1122 }),
    ]
    const assigned = assignPayments(os, rows)
    const paid = assigned.map(
      (o) => obligationTrail(o, rows, ['2030-06'], '2030-06-16').trail[0],
    )
    expect(
      paid.map(({ month, status, amount }) => ({ month, status, amount })),
    ).toEqual([
      { month: '2030-06', status: 'paid', amount: 816 },
      { month: '2030-06', status: 'paid', amount: 306 },
    ])
    expect(paid.reduce((sum, t) => sum + t.amount!, 0)).toBe(1122)
    expect(
      obligationEvents(assigned, rows, '2030-06-14', '2030-06-30'),
    ).toHaveLength(2)
    expect(
      obligationEvents(assigned, rows, '2030-06-16', '2030-06-30'),
    ).toEqual([])
    expect(
      assignPayments(
        os.map((o) => ({ ...o, confirmed: true })),
        rows,
      ).map((o) => o.paymentAmounts),
    ).toEqual(assigned.map((o) => o.paymentAmounts))
  })
  it('assigns separate debits only once, including a standing-order mortgage, and rejects unrelated transfers', () => {
    const os = mortgages()
    const rows = [
      tx({
        id: 'one',
        merchant: 'Synthetic mortgage',
        date: '2030-06-15',
        amount: -810,
      }),
      tx({
        id: 'two',
        merchant: 'הוראת קבע',
        date: '2030-06-17',
        amount: -305,
      }),
      tx({
        id: 'unrelated',
        merchant: 'Digital transfer',
        date: '2030-05-15',
        amount: -1100,
      }),
    ]
    expect(assignPayments(os, rows).map((o) => o.paymentIds)).toEqual([
      ['one'],
      ['two'],
    ])
    expect(
      assignPayments([os[0], { ...os[0], id: 'overlap' }], [rows[0]]).flatMap(
        (o) => o.paymentIds!,
      ),
    ).toHaveLength(1)
  })
  it('matches mortgage delays across month/year boundaries and clamps month-end grace', () => {
    const o = mortgages()[0]
    o.dueDay = 1
    const rows = [
      tx({ merchant: 'Synthetic mortgage', date: '2029-12-31', amount: -800 }),
    ]
    const assigned = assignPayments([o], rows)[0]
    expect(
      obligationTrail(
        assigned,
        rows,
        ['2029-12', '2030-01'],
        '2030-01-07',
      ).trail.map((t) => t.status),
    ).toEqual(['none', 'paid'])
    const end = obligation({ dueDay: 31, confirmed: true })
    expect(
      obligationTrail(end, [], ['2030-02'], '2030-03-05').trail[0].status,
    ).toBe('due')
    expect(
      obligationTrail(end, [], ['2030-02'], '2030-03-06').trail[0].status,
    ).toBe('late')
  })
})
