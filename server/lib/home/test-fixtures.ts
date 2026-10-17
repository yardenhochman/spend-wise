import type { HomeTransaction, Obligation } from './types.js'
import { extractLeumiMortgageSnapshot } from '../leumi-mortgage-import.js'
export function tx(overrides: Partial<HomeTransaction> = {}): HomeTransaction {
  return {
    id: '1',
    date: '2030-06-10',
    merchant: 'Synthetic standing order',
    amount: -100,
    notes: 'scraper account 111-22222_33',
    account_id: 'checking',
    account_label: 'Checking',
    bank_name: 'Leumi',
    category_name: 'Utilities',
    is_internal: 0,
    is_recurring_candidate: 1,
    ...overrides,
  }
}
export function obligation(overrides: Partial<Obligation> = {}): Obligation {
  return {
    id: 'test-obligation',
    name: 'Synthetic standing order',
    kind: 'utility',
    expectedAmount: 100,
    cadence: 'monthly',
    dueDay: 10,
    matchPattern: 'Synthetic standing order',
    confirmed: false,
    anchorMonth: '2030-01',
    tolerance: 0.15,
    ...overrides,
  }
}
export function snapshot() {
  return extractLeumiMortgageSnapshot(
    {
      loanMortgageItems: [
        {
          MortgageDetail: {
            mortgageKey: 'synthetic',
            dayOfPayment: 15,
            clearingBalance: 10000,
            mortgageAmount: 12000,
            lastPaymentAmount: 200,
            bookingDate: '2029-01-01',
            mortgageEndDate: '2035-01-01',
          },
        },
      ],
    },
    '2030-06-01T00:00:00Z',
  )
}
export const config = {
  accountNumbers: ['111-22222_33'],
  legacyAccountIds: ['legacy'],
  graceDays: 5,
  runwayFloor: 0,
}
