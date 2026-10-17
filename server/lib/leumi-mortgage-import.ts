export type LeumiMortgageSnapshot = {
  source: 'leumi-mortgages'
  scrapedAt: string
  asOfDate: string | null
  clearingBalanceAll: number | null
  mortgageCount: number
  trackCoverage: TrackCoverage
  mortgages: LeumiMortgage[]
}

export type TrackCoverage = {
  expected: number
  retrieved: number
  status: 'complete' | 'partial' | 'unavailable'
}

export type LeumiMortgageTrack = {
  loanId: string | null
  productName: string | null
  interestType: string | null
  repaymentMethod: string | null
  principalBalance: number | null
  clearingBalance: number | null
  originalAmount: number | null
  monthlyPayment: number | null
  annualInterestPercent: number | null
  effectiveAnnualInterestPercent: number | null
  originalAnnualInterestPercent: number | null
  interestFormula: string | null
  anchorRate: number | null
  anchorSpreadRate: number | string | null
  interestChangeFrequency: number | string | null
  nextRateChangeDate: string | null
  startDate: string | null
  firstPaymentDate: string | null
  endDate: string | null
  indexation: string | null
  indexationBalance: number | null
  accruedInterest: number | null
  fees: {
    total: number | null
    capitalization: number | null
    insufficientNotice: number | null
    averageIndex: number | null
  }
  recentPayments: Array<{ date: string | null; amount: number | null }>
}

export type LeumiMortgage = {
  tracks: LeumiMortgageTrack[]
  trackPaymentTotal: number | null
  trackPaymentDifference: number | null
  trackCoverage: TrackCoverage
  mortgageKey: string | null
  mortgageKeyFormatted: string | null
  source: string | null
  dayOfPayment: number | null
  clearingBalance: number | null
  currencyLeumi: string | null
  clearingCommission: number | null
  interestBalance: number | null
  arrearsTotalAmount: number | null
  interestPredicted: number | null
  interestForCompare: number | null
  additionalPaymentsAmount: number | null
  mortgageAmount: number | null
  bookingDate: string | null
  mortgagePurpose: string | null
  lastPaymentAmount: number | null
  mortgageEndDate: string | null
  linkToPDF6541: string | null
  address: string | null
  portfolioAccounts: string[]
  loanItems: LeumiMortgageLoanItem[]
  balanceItems: LeumiMortgageBalanceItem[]
  partnerDetails: LeumiMortgagePartnerDetail[]
}

export type LeumiMortgageLoanItem = {
  loanID: string | null
  externalLoanId: string | null
  loanStatus: string | null
}

export type LeumiMortgageBalanceItem = {
  operationalCommission: number | null
  clearingBalance: number | null
  validityDate: string | null
  fundBalance: number | null
  linkageEstimatedBalance: number | null
}

export type LeumiMortgagePartnerDetail = {
  partnerName: string | null
  roleInPartnership: string | null
}

export function extractLeumiMortgageSnapshot(
  response: unknown,
  scrapedAt: string = new Date().toISOString(),
): LeumiMortgageSnapshot {
  const root = isRecord(response) ? response : {}
  const mortgages = collectMortgageDetails(root.loanMortgageItems).map(
    (value) => normalizeMortgage(value, root.loanInfoResponses),
  )
  const asOfDate =
    firstNonNull(
      mortgages.flatMap((mortgage) =>
        mortgage.balanceItems.map((item) => item.validityDate),
      ),
    ) ?? null

  return {
    source: 'leumi-mortgages',
    scrapedAt,
    asOfDate,
    clearingBalanceAll: numberOrNull(root.clearingBalanceAll),
    mortgageCount: mortgages.length,
    trackCoverage: coverage(
      mortgages.reduce(
        (sum, mortgage) => sum + mortgage.trackCoverage.expected,
        0,
      ),
      mortgages.reduce(
        (sum, mortgage) => sum + mortgage.trackCoverage.retrieved,
        0,
      ),
    ),
    mortgages,
  }
}

function collectMortgageDetails(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!isRecord(item)) return null
      return isRecord(item.MortgageDetail) ? item.MortgageDetail : item
    })
    .filter((item): item is Record<string, unknown> => item !== null)
}

function normalizeMortgage(
  value: Record<string, unknown>,
  details: unknown,
): LeumiMortgage {
  const loanItems = normalizeLoanItems(value.loanItems)
  const expectedIds = new Set(
    loanItems.map((item) => canonicalLoanId(item.loanID)).filter(Boolean),
  )
  const detail = Array.isArray(details)
    ? details.find(
        (item) =>
          isRecord(item) &&
          isRecord(item.MortgageDetails) &&
          typeof value.mortgageKey === 'string' &&
          item.MortgageDetails.mortgageKey === value.mortgageKey,
      )
    : undefined
  const loans =
    isRecord(detail) &&
    isRecord(detail.MortgageDetails) &&
    Array.isArray(detail.MortgageDetails.loansItems)
      ? detail.MortgageDetails.loansItems
      : []
  const seen = new Set<string>()
  const tracks = loans
    .filter(isRecord)
    .filter((item) => {
      const id = canonicalLoanId(item.loanId)
      if (!id || !expectedIds.has(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })
    .map(normalizeTrack)
  const trackCoverage = coverage(loanItems.length, tracks.length)
  const trackPaymentTotal =
    trackCoverage.status === 'complete' &&
    tracks.every((track) => track.monthlyPayment !== null)
      ? Math.round(
          tracks.reduce((sum, track) => sum + (track.monthlyPayment ?? 0), 0) *
            100,
        ) / 100
      : null
  const lastPaymentAmount = numberOrNull(value.lastPaymentAmount)
  return {
    trackPaymentTotal,
    trackPaymentDifference:
      trackPaymentTotal !== null && lastPaymentAmount !== null
        ? Math.round((lastPaymentAmount - trackPaymentTotal) * 100) / 100
        : null,
    tracks,
    trackCoverage,
    mortgageKey: stringOrNull(value.mortgageKey),
    mortgageKeyFormatted: stringOrNull(value.mortgageKeyFormatted),
    source: stringOrNull(value.source),
    dayOfPayment: numberOrNull(value.dayOfPayment),
    clearingBalance: numberOrNull(value.clearingBalance),
    currencyLeumi: stringOrNull(value.currencyLeumi),
    clearingCommission: numberOrNull(value.clearingCommission),
    interestBalance: numberOrNull(value.interestBalance),
    arrearsTotalAmount: numberOrNull(value.arrearsTotalAmount),
    interestPredicted: numberOrNull(value.interestPredicted),
    interestForCompare: numberOrNull(value.interestForCompare),
    additionalPaymentsAmount: numberOrNull(value.additionalPaymentsAmount),
    mortgageAmount: numberOrNull(value.mortgageAmount),
    bookingDate: dateOrNull(value.bookingDate),
    mortgagePurpose: stringOrNull(value.mortgagePurpose),
    lastPaymentAmount: numberOrNull(value.lastPaymentAmount),
    mortgageEndDate: dateOrNull(value.mortgageEndDate),
    linkToPDF6541: stringOrNull(value.linkToPDF6541),
    address: stringOrNull(value.address),
    portfolioAccounts: normalizePortfolioAccounts(value.portfolioAccountsItems),
    loanItems: normalizeLoanItems(value.loanItems),
    balanceItems: normalizeBalanceItems(value.balanceItems),
    partnerDetails: normalizePartnerDetails(value.partnerDetailsItems),
  }
}

function normalizePortfolioAccounts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) =>
      isRecord(item) ? stringOrNull(item.portfolioAccountNum) : null,
    )
    .filter((item): item is string => item !== null)
}

function normalizeLoanItems(value: unknown): LeumiMortgageLoanItem[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((item) => ({
    loanID: stringOrNull(item.loanID),
    externalLoanId: stringOrNull(item.externalLoanId),
    loanStatus: stringOrNull(item.loanStatus),
  }))
}

function normalizeBalanceItems(value: unknown): LeumiMortgageBalanceItem[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((item) => ({
    operationalCommission: numberOrNull(item.operationalCommission),
    clearingBalance: numberOrNull(item.clearingBalance),
    validityDate: dateOrNull(item.validityDate),
    fundBalance: numberOrNull(item.fundBalance),
    linkageEstimatedBalance: numberOrNull(item.linkageEstimatedBalance),
  }))
}

function normalizePartnerDetails(value: unknown): LeumiMortgagePartnerDetail[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((item) => ({
    partnerName: stringOrNull(item.partnerName),
    roleInPartnership: stringOrNull(item.roleInPartnership),
  }))
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  const local = value.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/)
  if (local)
    return `${local[3].length === 2 ? '20' : ''}${local[3]}-${local[2]}-${local[1]}`
  return value.trim()
}

function firstNonNull<T>(values: Array<T | null>): T | null {
  return values.find((value): value is T => value !== null) ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function canonicalLoanId(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^0+(?=\d)/, '') : ''
}

function coverage(expected: number, retrieved: number): TrackCoverage {
  return {
    expected,
    retrieved,
    status:
      retrieved === 0
        ? 'unavailable'
        : retrieved === expected
          ? 'complete'
          : 'partial',
  }
}

function normalizeTrack(value: Record<string, unknown>): LeumiMortgageTrack {
  return {
    loanId: stringOrNull(value.loanId),
    productName: stringOrNull(value.productName),
    interestType: stringOrNull(value.interestType),
    repaymentMethod: stringOrNull(value.clearingTableDescription),
    principalBalance: numberOrNull(value.fundBalance),
    clearingBalance: numberOrNull(value.clearingBalance),
    originalAmount: numberOrNull(value.loanAmount),
    monthlyPayment: numberOrNull(value.lastPaymentAmount),
    annualInterestPercent: numberOrNull(value.annualInterestPercent),
    effectiveAnnualInterestPercent: numberOrNull(value.adjustedInterest),
    originalAnnualInterestPercent: numberOrNull(
      value.annualOriginalInterestPercent,
    ),
    interestFormula: stringOrNull(value.calculatedAnnualInterest),
    anchorRate: numberOrNull(value.currentAnchor),
    anchorSpreadRate:
      numberOrNull(value.anchorSpreadRate) ??
      stringOrNull(value.anchorSpreadRate),
    interestChangeFrequency:
      numberOrNull(value.frequencyOfInterestChange) ??
      stringOrNull(value.frequencyOfInterestChange),
    nextRateChangeDate: dateOrNull(value.percentChgDate),
    startDate: dateOrNull(value.loanCreditDate),
    firstPaymentDate: dateOrNull(value.loanFirstPayDate),
    endDate: dateOrNull(value.calculateEndDate),
    indexation: stringOrNull(value.linkageBase),
    indexationBalance: numberOrNull(value.linkageEstimatedBalance),
    accruedInterest: numberOrNull(value.dailyInterest),
    fees: {
      total: numberOrNull(value.clearingCommission),
      capitalization: numberOrNull(value.capitalizationCommission),
      insufficientNotice: numberOrNull(value.failureToReportCommission),
      averageIndex: numberOrNull(value.averageIndexCommission),
    },
    recentPayments: Array.isArray(value.paymentItems)
      ? value.paymentItems.filter(isRecord).map((item) => ({
          date: dateOrNull(item.paymentDate),
          amount: numberOrNull(item.paymentAmount),
        }))
      : [],
  }
}
