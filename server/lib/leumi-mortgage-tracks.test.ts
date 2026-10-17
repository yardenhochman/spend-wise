import { describe, expect, it } from 'vitest'
import { extractLeumiMortgageSnapshot } from './leumi-mortgage-import.js'

const overview = {
  loanMortgageItems: [
    {
      MortgageDetail: {
        mortgageKey: 'synthetic-a',
        interestPredicted: 3.2,
        loanItems: [{ loanID: '1' }, { loanID: '2' }],
      },
    },
  ],
}
const fixed = {
  loanId: '01',
  productName: 'Fixed unlinked',
  interestType: 'FIXED',
  fundBalance: 120000,
  annualInterestPercent: 4.5,
  adjustedInterest: 4.59,
  annualOriginalInterestPercent: 4.5,
  calculatedAnnualInterest: '4.5%',
  clearingBalance: 121000,
  lastPaymentAmount: 950,
  calculateEndDate: '15.09.39',
  loanCreditDate: '02.03.30',
  loanFirstPayDate: '2030-04-15',
  linkageBase: 'לא',
  linkageEstimatedBalance: 0,
  anchorSpreadRate: null,
  currentAnchor: null,
  percentChgDate: null,
  capitalizationCommission: 500,
  failureToReportCommission: 120,
  clearingCommission: 620,
  paymentItems: [{ paymentDate: '2032-08-15T00:00:00', paymentAmount: 950 }],
}
const variable = {
  loanId: '02',
  productName: 'Annual Makam',
  interestType: 'VARIABLE',
  fundBalance: 250000,
  annualInterestPercent: 5.1,
  currentAnchor: 3.9,
  anchorSpreadRate: 1.2,
  percentChgDate: '15.12.32',
  frequencyOfInterestChange: 12,
  calculateEndDate: '15.12.48',
  capitalizationCommission: 0,
  linkageEstimatedBalance: 0,
}
function snapshot(loans: unknown[] = [fixed, variable], key = 'synthetic-a') {
  return extractLeumiMortgageSnapshot(
    {
      ...overview,
      loanInfoResponses: [
        { MortgageDetails: { mortgageKey: key, loansItems: loans } },
      ],
    },
    '2032-09-05T12:00:00Z',
  )
}

describe('mortgage track details', () => {
  it('joins by mortgage identity and matches padded loan IDs', () => {
    const result = snapshot()
    expect(result.trackCoverage).toEqual({
      expected: 2,
      retrieved: 2,
      status: 'complete',
    })
    expect(result.mortgages[0].tracks[0]).toMatchObject({
      loanId: '01',
      principalBalance: 120000,
      annualInterestPercent: 4.5,
      effectiveAnnualInterestPercent: 4.59,
      nextRateChangeDate: null,
      anchorRate: null,
      anchorSpreadRate: null,
      endDate: '2039-09-15',
      startDate: '2030-03-02',
      indexation: 'לא',
      indexationBalance: 0,
      fees: { total: 620, capitalization: 500, insufficientNotice: 120 },
      recentPayments: [{ date: '2032-08-15', amount: 950 }],
    })
    expect(result.mortgages[0].tracks[1]).toMatchObject({
      annualInterestPercent: 5.1,
      anchorRate: 3.9,
      anchorSpreadRate: 1.2,
      nextRateChangeDate: '2032-12-15',
      interestChangeFrequency: 12,
      fees: { capitalization: 0 },
    })
  })
  it('does not replace contractual rates with overview forecast rates', () => {
    const result = snapshot([{ loanId: '01' }])
    expect(result.mortgages[0].tracks[0]).toMatchObject({
      annualInterestPercent: null,
      principalBalance: null,
      endDate: null,
      fees: { total: null, capitalization: null },
    })
    expect(result.trackCoverage).toEqual({
      expected: 2,
      retrieved: 1,
      status: 'partial',
    })
  })
  it('reports missing or unrelated details as unavailable', () => {
    expect(snapshot([fixed], 'other-mortgage').trackCoverage).toEqual({
      expected: 2,
      retrieved: 0,
      status: 'unavailable',
    })
    expect(extractLeumiMortgageSnapshot(overview).mortgages[0].tracks).toEqual(
      [],
    )
  })
  it('does not count duplicate or unexpected loan IDs as complete coverage', () => {
    const result = snapshot([fixed, fixed, { ...variable, loanId: '99' }])
    expect(result.trackCoverage).toEqual({
      expected: 2,
      retrieved: 1,
      status: 'partial',
    })
    expect(result.mortgages[0].tracks).toHaveLength(1)
  })
  it('preserves bank-provided margin and reset-frequency descriptions', () => {
    const result = snapshot([
      fixed,
      {
        ...variable,
        anchorSpreadRate: 'עוגן + % 0.53',
        frequencyOfInterestChange: '12 חודשים',
      },
    ])
    expect(result.mortgages[0].tracks[1]).toMatchObject({
      anchorSpreadRate: 'עוגן + % 0.53',
      interestChangeFrequency: '12 חודשים',
    })
  })
  it('exposes an overview/track payment discrepancy without adjusting source values', () => {
    const result = extractLeumiMortgageSnapshot({
      loanMortgageItems: [
        {
          MortgageDetail: {
            mortgageKey: 'fixture-gap',
            lastPaymentAmount: 1012,
            loanItems: [{ loanID: '1' }],
          },
        },
      ],
      loanInfoResponses: [
        {
          MortgageDetails: {
            mortgageKey: 'fixture-gap',
            loansItems: [{ loanId: '01', lastPaymentAmount: 1000 }],
          },
        },
      ],
    })
    expect(result.mortgages[0]).toMatchObject({
      lastPaymentAmount: 1012,
      trackPaymentTotal: 1000,
      trackPaymentDifference: 12,
    })
    expect(
      snapshot([{ loanId: '01' }]).mortgages[0].trackPaymentDifference,
    ).toBeNull()
  })
})
