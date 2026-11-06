import type { ViewModeFilter } from '../types.js'
import { expandSqlTemplates, spendWiseConfig } from './private-config.js'

/** View-mode SQL, usable by the API and by read-only consumers without opening the app database. */
export function createViewModeFilter(
  getCategoryId: (name: string) => string | null,
) {
  return function buildViewModeFilter(
    mode: string,
    tableAlias: string = 't',
  ): ViewModeFilter {
    const a = tableAlias
    const homeLoanRules = expandSqlTemplates(
      spendWiseConfig.viewModeRules.homeInclude,
      a,
    )
    const weddingLoanRules = expandSqlTemplates(
      spendWiseConfig.viewModeRules.weddingInclude,
      a,
    )
    const allLoanRules = [...homeLoanRules, ...weddingLoanRules]
    const includeRulesSql = (rules: string[]): string =>
      rules.map((rule) => `(${rule})`).join(' OR ')
    const excludeRulesSql = (rules: string[]): string =>
      rules.map((rule) => `NOT (${rule})`).join(' AND ')

    if (mode === 'cashflow') {
      return {
        sql: '',
        params: [],
        includeInternal: false,
      }
    }

    if (mode === 'home') {
      const homeId = getCategoryId('Home Purchase')
      const mortgageId = getCategoryId('Mortgage')
      const propertyPriceId = getCategoryId('Property Price')
      const purchaseTaxId = getCategoryId('Purchase Tax')
      const closingCostsId = getCategoryId('Closing Costs')
      const homeLoansId = getCategoryId('Home Loans')
      const consultingId = getCategoryId('Consulting')
      return {
        sql:
          homeLoanRules.length > 0
            ? `AND (${a}.category_id IN (?, ?, ?, ?, ?, ?, ?) OR ${includeRulesSql(homeLoanRules)})`
            : `AND (${a}.category_id IN (?, ?, ?, ?, ?, ?, ?))`,
        params: [
          homeId,
          mortgageId,
          propertyPriceId,
          purchaseTaxId,
          closingCostsId,
          homeLoansId,
          consultingId,
        ],
        includeInternal: false,
      }
    }
    if (mode === 'wedding') {
      const weddingIds = [
        getCategoryId('Wedding'),
        getCategoryId('Venue & Catering'),
        getCategoryId('Music & Sound'),
        getCategoryId('Photography'),
        getCategoryId('Wedding Planning'),
        getCategoryId('Wedding Loan'),
      ]
      return {
        sql:
          weddingLoanRules.length > 0
            ? `AND (${a}.category_id IN (${weddingIds.map(() => '?').join(',')}) OR ${includeRulesSql(weddingLoanRules)})`
            : `AND (${a}.category_id IN (${weddingIds.map(() => '?').join(',')}))`,
        params: weddingIds,
        includeInternal: false,
      }
    }
    // routine (default) — exclude home + wedding + mortgage + all sub-categories and special loan/mortgage txns
    const excludeIds = [
      getCategoryId('Home Purchase'),
      getCategoryId('Wedding'),
      getCategoryId('Mortgage'),
      getCategoryId('Property Price'),
      getCategoryId('Purchase Tax'),
      getCategoryId('Closing Costs'),
      getCategoryId('Home Loans'),
      getCategoryId('Consulting'),
      getCategoryId('Venue & Catering'),
      getCategoryId('Music & Sound'),
      getCategoryId('Photography'),
      getCategoryId('Wedding Planning'),
      getCategoryId('Wedding Loan'),
    ]
    return {
      sql:
        allLoanRules.length > 0
          ? `AND (${a}.category_id IS NULL OR ${a}.category_id NOT IN (${excludeIds.map(() => '?').join(',')})) AND ${excludeRulesSql(allLoanRules)}`
          : `AND (${a}.category_id IS NULL OR ${a}.category_id NOT IN (${excludeIds.map(() => '?').join(',')}))`,
      params: excludeIds,
      includeInternal: false,
    }
  }
}
