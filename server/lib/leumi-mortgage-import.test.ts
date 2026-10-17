import { describe, expect, it } from 'vitest'

import { extractLeumiMortgageSnapshot } from './leumi-mortgage-import.js'

// Synthetic loan identities, balances and borrower details.
describe('extractLeumiMortgageSnapshot', () => {
  it('normalizes Leumi mortgageDetails responses', () => {
    const snapshot = extractLeumiMortgageSnapshot(
      {
        clearingBalanceAll: 1234567.89,
        loanMortgageItems: [
          {
            MortgageDetail: {
              mortgageKey: 'loan-a',
              mortgageKeyFormatted: '00-000-01-00',
              dayOfPayment: 15,
              clearingBalance: 700000,
              clearingCommission: 1200.5,
              interestBalance: 456.7,
              arrearsTotalAmount: 0,
              interestPredicted: 3.75,
              interestForCompare: 4.2,
              additionalPaymentsAmount: 99,
              mortgageAmount: 750000,
              bookingDate: '2030-03-02T00:00:00',
              mortgagePurpose: 'דיור',
              lastPaymentAmount: 4100,
              mortgageEndDate: '2048-12-15T00:00:00',
              address: 'Example Street 1',
              portfolioAccountsItems: [{ portfolioAccountNum: '12345' }],
              loanItems: [
                {
                  loanID: '1',
                  externalLoanId: 'ext-1',
                  loanStatus: 'active',
                },
              ],
              balanceItems: [
                {
                  operationalCommission: 12,
                  clearingBalance: 700000,
                  validityDate: '2032-06-10T00:00:00',
                  fundBalance: 690000,
                  linkageEstimatedBalance: 10000,
                },
              ],
              partnerDetailsItems: [
                { partnerName: 'Synthetic Borrower', roleInPartnership: 'Borrower' },
              ],
            },
          },
          {
            MortgageDetail: {
              mortgageKey: 'loan-b',
              mortgageKeyFormatted: '00-000-02-00',
              clearingBalance: 534567.89,
              bookingDate: '2030-03-02T00:00:00',
              mortgageEndDate: '2039-12-15T00:00:00',
              balanceItems: [{ validityDate: '2032-06-10T00:00:00' }],
            },
          },
        ],
      },
      '2032-06-12T10:00:00.000Z',
    )

    expect(snapshot).toMatchObject({
      source: 'leumi-mortgages',
      scrapedAt: '2032-06-12T10:00:00.000Z',
      asOfDate: '2032-06-10',
      clearingBalanceAll: 1234567.89,
      mortgageCount: 2,
    })
    expect(snapshot.mortgages[0]).toMatchObject({
      mortgageKey: 'loan-a',
      mortgageKeyFormatted: '00-000-01-00',
      dayOfPayment: 15,
      clearingBalance: 700000,
      clearingCommission: 1200.5,
      interestPredicted: 3.75,
      interestForCompare: 4.2,
      bookingDate: '2030-03-02',
      mortgageEndDate: '2048-12-15',
      portfolioAccounts: ['12345'],
      loanItems: [
        {
          loanID: '1',
          externalLoanId: 'ext-1',
          loanStatus: 'active',
        },
      ],
      balanceItems: [
        {
          validityDate: '2032-06-10',
          clearingBalance: 700000,
        },
      ],
      partnerDetails: [
        {
          partnerName: 'Synthetic Borrower',
          roleInPartnership: 'Borrower',
        },
      ],
    })
    expect(snapshot.mortgages[1]).toMatchObject({
      mortgageKey: 'loan-b',
      mortgageKeyFormatted: '00-000-02-00',
      clearingBalance: 534567.89,
      mortgageEndDate: '2039-12-15',
    })
  })

  it('returns an empty snapshot for missing mortgage items', () => {
    expect(
      extractLeumiMortgageSnapshot({}, '2032-06-12T10:00:00.000Z'),
    ).toEqual({
      source: 'leumi-mortgages',
      scrapedAt: '2032-06-12T10:00:00.000Z',
      asOfDate: null,
      clearingBalanceAll: null,
      mortgageCount: 0,
      trackCoverage: { expected: 0, retrieved: 0, status: 'unavailable' },
      mortgages: [],
    })
  })
})
