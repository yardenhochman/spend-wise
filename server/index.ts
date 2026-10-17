import express from 'express'
import { summarizeTaggedAmounts, type TaggedAmount } from './lib/tag-summary.js'
import type { Request, Response, NextFunction } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import * as trpcExpress from '@trpc/server/adapters/express'
import {
  db,
  nowIso,
  toBool,
  dataDir,
  dbPath,
  schemaPath,
  ensureAccount,
  getCategoryId,
} from './db.js'
import { parsePdf } from './parsers/index.js'
import { parseIbkrFlexXml } from './parsers/ibkr-flex.js'
import { buildFuzzyIndex, findFuzzyDuplicate } from './lib/dedup.js'
import { expandSqlTemplates, spendWiseConfig } from './lib/private-config.js'
import { computeSpreadAdjustments, buildSpreadMap } from './lib/spread.js'
import type { SpreadTransaction } from './lib/spread.js'
import { router, publicProcedure } from './trpc.js'
import type {
  TransactionRow,
  TransactionApiRow,
  TransactionWithCategory,
  RuleRow,
  RuleApiRow,
  TagRow,
  ViewModeFilter,
  CategoryRow,
  StatementFileRow,
  InvestmentReportRow,
  InvestmentPositionRow,
  CountRow,
  SummaryTotals,
  CategoryBreakdown,
  CategoryAvgMonthly,
  SpendingTypeTotal,
  TrendingCategory,
  TopMerchant,
  MonthlyRow,
  CategoryByMonthRow,
  TrendPoint,
  RecurringCandidate,
  DateRange,
  RecurringMerchant,
  CashAllocationRow,
  InvestmentHistoryPointRow,
  InvestmentPerformancePointRow,
  InvestmentBreakdownRow,
  HomeInvestmentSnapshotRow,
} from './types.js'

const app = express()
const upload = multer({ storage: multer.memoryStorage() })
const port = Number(process.env.PORT ?? 4000)

app.use(express.json({ limit: '2mb' }))

const mapTransaction = (
  row: TransactionRow | TransactionWithCategory | null,
): TransactionApiRow | null =>
  row
    ? {
        ...row,
        is_recurring_candidate: toBool(row.is_recurring_candidate),
        is_internal: toBool(row.is_internal),
      }
    : null

const mapRule = (row: RuleRow | null): RuleApiRow | null =>
  row
    ? {
        ...row,
        enabled: toBool(row.enabled),
      }
    : null

const isXmlUpload = (filename: string): boolean =>
  filename.toLowerCase().endsWith('.xml')

const TEL_AVIV_ANNUAL_RENT_YIELD = 0.028

const HOME_PROPERTY_CATEGORIES = new Set(['Property Price', 'Home Purchase'])
const HOME_HARD_COST_CATEGORIES = new Set([
  'Purchase Tax',
  'Closing Costs',
  'Consulting',
])

type HomeInvestmentTransactionRow = {
  id: string
  date: string
  amount: number
  merchant: string
  is_internal: number
  category_name: string | null
}

function startOfMonthIso(value: string): string {
  return `${value.slice(0, 7)}-01`
}

function endOfMonth(value: string): Date {
  const [year, month] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0))
}

function enumerateMonths(startDate: string, endDate: string): string[] {
  const [startYear, startMonth] = startDate.split('-').map(Number)
  const [endYear, endMonth] = endDate.split('-').map(Number)
  const months: string[] = []
  let year = startYear
  let month = startMonth

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(
      `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-01`,
    )
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }

  return months
}

function daysBetween(startDate: string, endDate: Date): number {
  const start = new Date(`${startDate}T00:00:00.000Z`)
  return Math.max((endDate.getTime() - start.getTime()) / 86_400_000, 0)
}

function isHomeInterestTransaction(row: HomeInvestmentTransactionRow): boolean {
  return (
    row.merchant.startsWith('תשלום ריבית') ||
    row.merchant.startsWith('ריבית על הלוואה')
  )
}

function isHomeFinancingCashTransaction(
  row: HomeInvestmentTransactionRow,
): boolean {
  return (
    row.category_name === 'Mortgage' ||
    row.category_name === 'Home Loans' ||
    row.merchant === 'לאומי למשכנת-י' ||
    row.merchant === 'פרעון הלוואה' ||
    row.merchant.startsWith('תשלום קרן') ||
    isHomeInterestTransaction(row)
  )
}

function getBrokerageInvestmentsSummary() {
  const latest = db
    .prepare(
      'SELECT * FROM investment_reports ORDER BY report_date DESC, imported_at DESC LIMIT 1',
    )
    .get() as InvestmentReportRow | undefined

  if (!latest) {
    return {
      kind: 'brokerage' as const,
      latest: null,
      holdings: [],
      history: [],
      performance: [],
      breakdown: [],
    }
  }

  const holdings = db
    .prepare(
      'SELECT * FROM investment_positions WHERE report_id = ? ORDER BY market_value_base DESC, symbol ASC',
    )
    .all(latest.id) as InvestmentPositionRow[]

  const history = db
    .prepare(
      `SELECT
         report_date,
         SUM(portfolio_value_base) as portfolio_value_base,
         SUM(unrealized_pnl_base) as unrealized_pnl_base,
         COUNT(DISTINCT account_number) as accounts_count
       FROM investment_reports
       GROUP BY report_date
       ORDER BY report_date ASC`,
    )
    .all() as InvestmentHistoryPointRow[]

  const latestDateAccounts = db
    .prepare(
      'SELECT COUNT(DISTINCT account_number) as count FROM investment_reports WHERE report_date = ?',
    )
    .get(latest.report_date) as CountRow

  const performance = history.map((point) => {
    const costBasis = point.portfolio_value_base - point.unrealized_pnl_base
    return {
      date: point.report_date,
      asset_value: point.portfolio_value_base,
      cost_basis: costBasis,
      net_gain: point.unrealized_pnl_base,
      saved_rent: 0,
      total_benefit: point.portfolio_value_base,
    } satisfies InvestmentPerformancePointRow
  })

  const latestCostBasis =
    latest.portfolio_value_base - latest.unrealized_pnl_base
  const breakdown: InvestmentBreakdownRow[] = [
    {
      label: 'Cost Basis',
      amount: latestCostBasis,
      detail: 'Latest imported purchase basis across open positions',
    },
    {
      label: 'Unrealized Gain',
      amount: latest.unrealized_pnl_base,
      detail: 'Mark-to-market gain/loss from the latest snapshot set',
    },
    {
      label: 'Imported Snapshots',
      amount: history.length,
      detail: 'Distinct market dates available for trend tracking',
    },
  ]

  return {
    kind: 'brokerage' as const,
    latest: {
      ...latest,
      accounts_count: latestDateAccounts.count,
      positions_count: holdings.length,
    },
    holdings,
    history,
    performance,
    breakdown,
  }
}

function getHomeInvestmentSummary() {
  const homeViewMode = buildViewModeFilter('home', 't')
  const rows = db
    .prepare(
      `SELECT
         t.id,
         t.date,
         t.amount,
         t.merchant,
         t.is_internal,
         c.name as category_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE 1=1 ${homeViewMode.sql}
       ORDER BY t.date ASC, t.id ASC`,
    )
    .all(...homeViewMode.params) as HomeInvestmentTransactionRow[]

  if (rows.length === 0) {
    return {
      kind: 'home' as const,
      latest: {
        latest_date: '',
        occupancy_date: null,
        estimated_home_value: 0,
        purchase_basis: 0,
        net_cash_invested: 0,
        saved_rent: 0,
        net_gain: 0,
        monthly_rent_estimate: 0,
        annual_rent_yield: TEL_AVIV_ANNUAL_RENT_YIELD,
        hard_costs: 0,
        financing_cash_paid: 0,
      } satisfies HomeInvestmentSnapshotRow,
      holdings: [] as [],
      history: [] as InvestmentPerformancePointRow[],
      breakdown: [] as InvestmentBreakdownRow[],
    }
  }

  const purchaseBasis = rows.reduce((sum, row) => {
    if (!HOME_PROPERTY_CATEGORIES.has(row.category_name ?? '')) return sum
    return sum + Math.max(-row.amount, 0)
  }, 0)

  const hardCosts = rows.reduce((sum, row) => {
    if (!HOME_HARD_COST_CATEGORIES.has(row.category_name ?? '')) return sum
    return sum + Math.max(-row.amount, 0)
  }, 0)

  const financingCashPaid = rows.reduce((sum, row) => {
    if (!isHomeFinancingCashTransaction(row) || toBool(row.is_internal)) {
      return sum
    }
    return sum + Math.max(-row.amount, 0)
  }, 0)

  const occupancyDate =
    rows.find((row) => row.category_name === 'Mortgage')?.date ??
    rows.find(
      (row) =>
        !toBool(row.is_internal) &&
        HOME_PROPERTY_CATEGORIES.has(row.category_name ?? ''),
    )?.date ??
    rows[0].date

  const latestDate = rows[rows.length - 1].date
  const months = enumerateMonths(
    startOfMonthIso(rows[0].date),
    startOfMonthIso(latestDate),
  )

  let cumulativePurchaseBasis = 0
  let cumulativeNetCashInvested = 0
  let cumulativeHardCosts = 0
  let cumulativeInterestCosts = 0
  let rowIndex = 0

  const performance: InvestmentPerformancePointRow[] = months.map((month) => {
    const monthEnd = endOfMonth(month)
    while (
      rowIndex < rows.length &&
      new Date(`${rows[rowIndex].date}T00:00:00.000Z`).getTime() <=
        monthEnd.getTime()
    ) {
      const row = rows[rowIndex]
      if (HOME_PROPERTY_CATEGORIES.has(row.category_name ?? '')) {
        cumulativePurchaseBasis += Math.max(-row.amount, 0)
      }
      if (!toBool(row.is_internal)) {
        cumulativeNetCashInvested += -row.amount
      }
      if (HOME_HARD_COST_CATEGORIES.has(row.category_name ?? '')) {
        cumulativeHardCosts += Math.max(-row.amount, 0)
      }
      if (!toBool(row.is_internal) && isHomeInterestTransaction(row)) {
        cumulativeInterestCosts += Math.max(-row.amount, 0)
      }
      rowIndex += 1
    }

    const savedRent =
      occupancyDate &&
      monthEnd.getTime() >= new Date(`${occupancyDate}T00:00:00.000Z`).getTime()
        ? (purchaseBasis *
            TEL_AVIV_ANNUAL_RENT_YIELD *
            daysBetween(occupancyDate, monthEnd)) /
          365.2425
        : 0

    return {
      date: month,
      asset_value: Math.min(cumulativePurchaseBasis, purchaseBasis),
      cost_basis: cumulativeNetCashInvested,
      net_gain: savedRent - cumulativeHardCosts - cumulativeInterestCosts,
      saved_rent: savedRent,
      total_benefit:
        Math.min(cumulativePurchaseBasis, purchaseBasis) + savedRent,
    }
  })

  const latestPerformance =
    performance[performance.length - 1] ??
    ({
      date: latestDate,
      asset_value: purchaseBasis,
      cost_basis: 0,
      net_gain: 0,
      saved_rent: 0,
      total_benefit: purchaseBasis,
    } satisfies InvestmentPerformancePointRow)

  const monthlyRentEstimate = (purchaseBasis * TEL_AVIV_ANNUAL_RENT_YIELD) / 12

  const breakdown: InvestmentBreakdownRow[] = [
    {
      label: 'Purchase Basis',
      amount: purchaseBasis,
      detail:
        'Tracked apartment purchase payments, including home-tagged purchase transfers',
    },
    {
      label: 'Hard Costs',
      amount: hardCosts,
      detail: 'Purchase tax, legal/closing costs, and consulting',
    },
    {
      label: 'Financing Cash Paid',
      amount: financingCashPaid,
      detail: 'Visible mortgage and home-loan cash outflows',
    },
    {
      label: 'Saved Rent',
      amount: latestPerformance.saved_rent,
      detail: `Modeled at ${(TEL_AVIV_ANNUAL_RENT_YIELD * 100).toFixed(1)}% of purchase basis per year`,
    },
  ]

  return {
    kind: 'home' as const,
    latest: {
      latest_date: latestDate,
      occupancy_date: occupancyDate,
      estimated_home_value: purchaseBasis,
      purchase_basis: purchaseBasis,
      net_cash_invested: latestPerformance.cost_basis,
      saved_rent: latestPerformance.saved_rent,
      net_gain: latestPerformance.net_gain,
      monthly_rent_estimate: monthlyRentEstimate,
      annual_rent_yield: TEL_AVIV_ANNUAL_RENT_YIELD,
      hard_costs: hardCosts,
      financing_cash_paid: financingCashPaid,
    } satisfies HomeInvestmentSnapshotRow,
    holdings: [] as [],
    history: performance,
    breakdown,
  }
}

// ── View Mode Filter ──────────────────────────────────────────────────────
type ExcludedKind = 'wedding' | 'loans' | 'mortgage' | 'home'

const EXCLUDED_KIND_VALUES = new Set<ExcludedKind>([
  'wedding',
  'loans',
  'mortgage',
  'home',
])
const viewModeSchema = z
  .enum(['cashflow', 'routine', 'home', 'wedding'])
  .default('cashflow')
const excludedKindsSchema = z
  .array(z.enum(['wedding', 'loans', 'mortgage', 'home']))
  .default([])

function parseExcludedKinds(value: unknown): ExcludedKind[] {
  const rawValues = Array.isArray(value)
    ? value.flatMap((item) => String(item).split(','))
    : String(value ?? '').split(',')

  return rawValues
    .map((item) => item.trim())
    .filter((item): item is ExcludedKind =>
      EXCLUDED_KIND_VALUES.has(item as ExcludedKind),
    )
}

function getCategoryIds(names: string[]): string[] {
  return names
    .map((name) => getCategoryId(name))
    .filter((id): id is string => Boolean(id))
}

function buildExcludedKindsFilter(
  excludedKinds: ExcludedKind[],
  tableAlias: string = 't',
): Pick<ViewModeFilter, 'sql' | 'params'> {
  if (excludedKinds.length === 0) return { sql: '', params: [] }

  const a = tableAlias
  const sqlParts: string[] = []
  const params: string[] = []
  const homeRules = expandSqlTemplates(
    spendWiseConfig.viewModeRules.homeInclude,
    a,
  )
  const weddingRules = expandSqlTemplates(
    spendWiseConfig.viewModeRules.weddingInclude,
    a,
  )
  const addCategoryExclusion = (names: string[]) => {
    const ids = getCategoryIds(names)
    if (ids.length === 0) return
    sqlParts.push(
      `(${a}.category_id IS NULL OR ${a}.category_id NOT IN (${ids.map(() => '?').join(',')}))`,
    )
    params.push(...ids)
  }
  const addRuleExclusion = (rules: string[]) => {
    sqlParts.push(...rules.map((rule) => `NOT (${rule})`))
  }

  if (excludedKinds.includes('wedding')) {
    addCategoryExclusion([
      'Wedding',
      'Venue & Catering',
      'Music & Sound',
      'Photography',
      'Wedding Planning',
    ])
  }

  if (excludedKinds.includes('loans')) {
    addCategoryExclusion(['Wedding Loan', 'Home Loans'])
    addRuleExclusion([
      ...homeRules.filter((rule) => !rule.includes('למשכנת')),
      ...weddingRules,
    ])
  }

  if (excludedKinds.includes('mortgage')) {
    addCategoryExclusion(['Mortgage'])
    addRuleExclusion(homeRules.filter((rule) => rule.includes('למשכנת')))
  }

  if (excludedKinds.includes('home')) {
    addCategoryExclusion([
      'Home Purchase',
      'Property Price',
      'Purchase Tax',
      'Closing Costs',
      'Consulting',
    ])
  }

  return {
    sql: sqlParts.length ? `AND ${sqlParts.join(' AND ')}` : '',
    params,
  }
}

function buildViewModeFilter(
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

function buildFinancialFilter(
  mode: string,
  excludedKinds: ExcludedKind[] = [],
  tableAlias: string = 't',
): ViewModeFilter {
  const viewMode = buildViewModeFilter(mode, tableAlias)
  const exclusions = buildExcludedKindsFilter(excludedKinds, tableAlias)
  return {
    sql: [viewMode.sql, exclusions.sql].filter(Boolean).join(' '),
    params: [...viewMode.params, ...exclusions.params],
    includeInternal: viewMode.includeInternal,
  }
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    data_dir: dataDir,
    db_path: dbPath,
    schema_path: schemaPath,
  })
})

app.get('/api/actions/cards', (_req: Request, res: Response) => {
  res.json({ items: spendWiseConfig.actionCards })
})

// ── Import PDF ──────────────────────────────────────────────────────────────
app.post(
  '/api/import',
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res
        .status(400)
        .json({ error: { code: 'missing_file', message: 'file is required' } })
    }

    const importId = randomUUID()
    const parserId =
      (req.body as Record<string, string | undefined>)?.parser_id ?? 'auto'
    const uploadType = isXmlUpload(req.file.originalname) ? 'xml' : 'pdf'

    try {
      if (uploadType === 'xml') {
        const result = parseIbkrFlexXml(req.file.buffer.toString('utf8'))
        ensureAccount(
          'Interactive Brokers',
          `Brokerage ${result.account_number.slice(-4)}`,
          result.base_currency,
        )

        db.prepare(
          'INSERT INTO statement_files (id, filename, type, imported_at, parser_id, status) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(
          importId,
          req.file.originalname,
          uploadType,
          nowIso(),
          result.parserId,
          'completed',
        )

        const existingReport = db
          .prepare(
            'SELECT * FROM investment_reports WHERE account_number = ? AND report_date = ?',
          )
          .get(result.account_number, result.report_date) as
          | InvestmentReportRow
          | undefined

        const reportId = existingReport?.id ?? randomUUID()
        const replacedCount = existingReport ? 1 : 0

        const saveReport = db.transaction(() => {
          if (existingReport) {
            db.prepare(
              'DELETE FROM investment_positions WHERE report_id = ?',
            ).run(existingReport.id)
            db.prepare(
              `UPDATE investment_reports
               SET statement_file_id = ?, account_name = ?, base_currency = ?, from_date = ?, to_date = ?, period = ?, portfolio_value_base = ?, unrealized_pnl_base = ?, imported_at = ?
               WHERE id = ?`,
            ).run(
              importId,
              result.account_name,
              result.base_currency,
              result.from_date,
              result.to_date,
              result.period,
              result.portfolio_value_base,
              result.unrealized_pnl_base,
              nowIso(),
              existingReport.id,
            )
          } else {
            db.prepare(
              `INSERT INTO investment_reports
               (id, statement_file_id, account_number, account_name, base_currency, from_date, to_date, report_date, period, portfolio_value_base, unrealized_pnl_base, imported_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
              reportId,
              importId,
              result.account_number,
              result.account_name,
              result.base_currency,
              result.from_date,
              result.to_date,
              result.report_date,
              result.period,
              result.portfolio_value_base,
              result.unrealized_pnl_base,
              nowIso(),
            )
          }

          const insertPosition = db.prepare(
            `INSERT INTO investment_positions
             (id, report_id, symbol, description, asset_category, sub_category, listing_exchange, currency, fx_rate_to_base, quantity, market_price, market_value, market_value_base, cost_basis, cost_basis_base, avg_open_price, unrealized_pnl, unrealized_pnl_base, portfolio_weight, side, isin)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )

          for (const position of result.positions) {
            insertPosition.run(
              randomUUID(),
              reportId,
              position.symbol,
              position.description,
              position.asset_category,
              position.sub_category,
              position.listing_exchange,
              position.currency,
              position.fx_rate_to_base,
              position.quantity,
              position.market_price,
              position.market_value,
              position.market_value_base,
              position.cost_basis,
              position.cost_basis_base,
              position.avg_open_price,
              position.unrealized_pnl,
              position.unrealized_pnl_base,
              position.portfolio_weight,
              position.side,
              position.isin,
            )
          }
        })

        saveReport()

        return res.json({
          import_id: importId,
          status: 'completed',
          parser_used: result.parserId,
          parsed_count: result.positions.length,
          inserted_count: result.positions.length,
          replaced_count: replacedCount,
          deduped_count: 0,
          unparsed_count: result.unparsed.length,
          errors: [],
        })
      }

      const result = await parsePdf(req.file.buffer, parserId)

      db.prepare(
        'INSERT INTO statement_files (id, filename, type, imported_at, parser_id, status) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        importId,
        req.file.originalname,
        uploadType,
        nowIso(),
        result.parserId,
        'completed',
      )

      // Ensure account exists
      const accountLabel =
        result.parserId === 'leumi-credit' ? 'Credit Card' : 'Checking'
      const accountId = ensureAccount('Leumi', accountLabel, 'ILS')

      // Insert transactions with dedupe (hash + fuzzy cross-source matching)
      const existingTxns = db
        .prepare('SELECT date, amount, merchant, raw_hash FROM transactions')
        .all() as {
        date: string
        amount: number
        merchant: string
        raw_hash: string
      }[]
      const existingHashes = new Set(existingTxns.map((t) => t.raw_hash))
      const fuzzyIndex = buildFuzzyIndex(existingTxns)

      const insertTx = db.prepare(`
      INSERT OR IGNORE INTO transactions
        (id, date, merchant, amount, currency, account_id, category_id, confidence, is_recurring_candidate, notes, source_file_id, raw_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

      let inserted = 0
      let deduped = 0
      let crossSourceDupe = 0

      const insertAll = db.transaction((txns: typeof result.transactions) => {
        for (const tx of txns) {
          if (existingHashes.has(tx.raw_hash)) {
            deduped++
            continue
          }

          const fuzzyMatch = findFuzzyDuplicate(tx, fuzzyIndex)
          if (fuzzyMatch) {
            crossSourceDupe++
            continue
          }

          const txId = randomUUID()
          const categoryId = applyCategoryRules(tx.merchant)
          const r = insertTx.run(
            txId,
            tx.date,
            tx.merchant,
            tx.amount,
            tx.currency,
            accountId,
            categoryId,
            0,
            0,
            null,
            importId,
            tx.raw_hash,
          )
          if (r.changes > 0) {
            inserted++
            existingHashes.add(tx.raw_hash)
          } else {
            deduped++
          }
        }
      })

      insertAll(result.transactions)

      res.json({
        import_id: importId,
        status: 'completed',
        parser_used: result.parserId,
        parsed_count: result.transactions.length,
        inserted_count: inserted,
        deduped_count: deduped,
        cross_source_dupe_count: crossSourceDupe,
        unparsed_count: result.unparsed.length,
        errors: [],
      })
    } catch (err) {
      console.error('[import] Error:', err)

      db.prepare(
        'INSERT INTO statement_files (id, filename, type, imported_at, parser_id, status) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        importId,
        req.file.originalname,
        uploadType,
        nowIso(),
        uploadType === 'xml' ? 'ibkr-flex' : parserId,
        'failed',
      )

      res.status(500).json({
        import_id: importId,
        status: 'failed',
        error: { code: 'parse_error', message: (err as Error).message },
      })
    }
  },
)

// Apply category rules to a merchant name
function applyCategoryRules(merchant: string): string | null {
  const rules = db
    .prepare('SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC')
    .all() as RuleRow[]

  for (const rule of rules) {
    let matches = false
    if (rule.match_type === 'contains') {
      matches = merchant.toLowerCase().includes(rule.pattern.toLowerCase())
    } else if (rule.match_type === 'exact') {
      matches = merchant.toLowerCase() === rule.pattern.toLowerCase()
    } else if (rule.match_type === 'regex') {
      try {
        matches = new RegExp(rule.pattern, 'i').test(merchant)
      } catch {
        /* skip bad regex */
      }
    }

    if (matches) return rule.category_id
  }

  return null
}

app.get('/api/import/:import_id', (req: Request, res: Response) => {
  const row = db
    .prepare('SELECT * FROM statement_files WHERE id = ?')
    .get(req.params.import_id) as StatementFileRow | undefined

  if (!row) {
    return res
      .status(404)
      .json({ error: { code: 'not_found', message: 'import not found' } })
  }

  const counts = db
    .prepare(
      'SELECT COUNT(*) as count FROM transactions WHERE source_file_id = ?',
    )
    .get(row.id) as CountRow

  res.json({
    import_id: row.id,
    filename: row.filename,
    parser_id: row.parser_id,
    status: row.status,
    imported_at: row.imported_at,
    transaction_count: counts.count,
  })
})

app.get('/api/investments/summary', (req: Request, res: Response) => {
  const viewMode = (req.query.view_mode as string) || 'routine'
  if (viewMode === 'home') {
    return res.json(getHomeInvestmentSummary())
  }
  res.json(getBrokerageInvestmentsSummary())
})

// ── Tags CRUD ────────────────────────────────────────────────────────────────
app.get('/api/tags', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM tags ORDER BY name').all() as TagRow[]
  res.json({ items: rows })
})

app.get('/api/tag-summaries', (req: Request, res: Response) => {
  const scope = buildFinancialFilter(
    (req.query.view_mode as string) || 'cashflow',
    parseExcludedKinds(req.query.excluded_kinds),
  )
  const tags = db
    .prepare(
      `SELECT tags.*, p.start_date,p.end_date,p.review_note FROM tags LEFT JOIN tag_profiles p ON p.tag_id=tags.id ORDER BY p.start_date IS NULL, tags.name`,
    )
    .all() as (TagRow & {
    start_date: string | null
    end_date: string | null
    review_note: string | null
  })[]
  const items = tags.map((tag) => {
    const rows = db
      .prepare(
        `SELECT t.amount,c.name AS category_name,v.valuation_status FROM transactions t JOIN transaction_tags tt ON tt.transaction_id=t.id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN transaction_valuations v ON v.transaction_id=t.id WHERE tt.tag_id=? AND t.is_internal=0 ${scope.sql}`,
      )
      .all(tag.id, ...scope.params) as TaggedAmount[]
    const subtags = db
      .prepare(
        `SELECT st.id,st.name,-SUM(t.amount) AS amount FROM transactions t JOIN transaction_tags tt ON tt.transaction_id=t.id JOIN transaction_tags detail ON detail.transaction_id=t.id JOIN tags st ON st.id=detail.tag_id WHERE tt.tag_id=? AND detail.tag_id<>? AND t.is_internal=0 ${scope.sql} GROUP BY st.id ORDER BY amount DESC`,
      )
      .all(tag.id, tag.id, ...scope.params)
    return {
      ...tag,
      ...summarizeTaggedAmounts(rows, tag.start_date, tag.end_date),
      subtags,
    }
  })
  res.json({ items })
})

app.post('/api/tags', (req: Request, res: Response) => {
  const name = (req.body as { name?: string })?.name?.trim()
  if (!name) {
    return res
      .status(400)
      .json({ error: { code: 'invalid_name', message: 'name is required' } })
  }
  const id = randomUUID()
  const color = (req.body as { color?: string | null })?.color ?? null
  db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(
    id,
    name,
    color,
  )
  const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow
  res.status(201).json({ tag: row })
})

app.delete('/api/tags/:id', (req: Request, res: Response) => {
  const result = db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id)
  if (result.changes === 0) {
    return res
      .status(404)
      .json({ error: { code: 'not_found', message: 'tag not found' } })
  }
  res.status(204).end()
})

app.post('/api/transactions/:id/tags', (req: Request, res: Response) => {
  const tagId = (req.body as { tag_id?: string })?.tag_id
  if (!tagId) {
    return res.status(400).json({
      error: { code: 'invalid_payload', message: 'tag_id is required' },
    })
  }
  try {
    db.prepare(
      'INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)',
    ).run(req.params.id, tagId)
  } catch (err) {
    return res.status(400).json({
      error: { code: 'invalid_reference', message: (err as Error).message },
    })
  }
  res.json({ status: 'ok' })
})

app.delete(
  '/api/transactions/:id/tags/:tagId',
  (req: Request, res: Response) => {
    db.prepare(
      'DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?',
    ).run(req.params.id, req.params.tagId)
    res.status(204).end()
  },
)

// Helper: batch-fetch tags for a list of transaction IDs
function fetchTagsForTransactions(txIds: string[]): Record<string, TagRow[]> {
  if (!txIds.length) return {}
  const placeholders = txIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT tt.transaction_id, t.id, t.name, t.color, t.icon
     FROM transaction_tags tt
     JOIN tags t ON t.id = tt.tag_id
     WHERE tt.transaction_id IN (${placeholders})`,
    )
    .all(...txIds) as (TagRow & { transaction_id: string })[]

  const map: Record<string, TagRow[]> = {}
  for (const row of rows) {
    if (!map[row.transaction_id]) map[row.transaction_id] = []
    map[row.transaction_id].push({
      id: row.id,
      name: row.name,
      color: row.color,
      icon: row.icon,
    })
  }
  return map
}

// Helper: compute set of review-flagged transaction IDs for a view mode
function getReviewFlaggedIds(viewMode: ViewModeFilter): Set<string> {
  const a = 't'
  const internalFilter = viewMode.includeInternal
    ? ''
    : `AND ${a}.is_internal = 0`
  const baseWhere = `WHERE 1=1 ${internalFilter} ${viewMode.sql}`
  const baseParams = [...viewMode.params]

  // Amount outliers: ABS(amount) > 2 * category average
  const outlierIds = db
    .prepare(
      `SELECT t.id FROM transactions t
       JOIN (
         SELECT category_id, AVG(ABS(amount)) as avg_amt
         FROM transactions t ${baseWhere} AND category_id IS NOT NULL
         GROUP BY category_id
       ) cavg ON cavg.category_id = t.category_id
       ${baseWhere} AND t.category_id IS NOT NULL
       AND ABS(t.amount) > 2 * cavg.avg_amt`,
    )
    .all(...baseParams, ...baseParams) as { id: string }[]

  // Singleton category: merchant has 1 txn in this category but 3+ in another
  const singletonIds = db
    .prepare(
      `SELECT t.id FROM transactions t
       JOIN (
         SELECT merchant, category_id as main_cat_id, COUNT(*) as main_count
         FROM transactions t ${baseWhere} AND category_id IS NOT NULL
         GROUP BY merchant, category_id
         HAVING COUNT(*) >= 3
       ) mc ON mc.merchant = t.merchant AND mc.main_cat_id != t.category_id
       ${baseWhere} AND t.category_id IS NOT NULL
       AND t.id IN (
         SELECT t2.id FROM transactions t2
         WHERE t2.merchant = t.merchant AND t2.category_id = t.category_id
         GROUP BY t2.merchant, t2.category_id
         HAVING COUNT(*) = 1
       )`,
    )
    .all(...baseParams, ...baseParams) as { id: string }[]

  const ids = new Set<string>()
  for (const r of outlierIds) ids.add(r.id)
  for (const r of singletonIds) ids.add(r.id)
  return ids
}

// ── Transactions CRUD ───────────────────────────────────────────────────────
app.get('/api/transactions', (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)
  const sort = ['date', 'amount', 'merchant'].includes(req.query.sort as string)
    ? (req.query.sort as string)
    : 'date'
  const order = req.query.order === 'asc' ? 'asc' : 'desc'

  const where: string[] = []
  const params: (string | number)[] = []

  if (req.query.account_id) {
    where.push('account_id = ?')
    params.push(req.query.account_id as string)
  }

  if (req.query.tag_id) {
    where.push(
      'EXISTS (SELECT 1 FROM transaction_tags ft WHERE ft.transaction_id=t.id AND ft.tag_id=?)',
    )
    params.push(req.query.tag_id as string)
  }

  if (req.query.category_id) {
    where.push('category_id = ?')
    params.push(req.query.category_id as string)
  }

  if (req.query.q) {
    where.push('merchant LIKE ?')
    params.push(`%${req.query.q}%`)
  }

  if (req.query.date_from) {
    where.push('date >= ?')
    params.push(req.query.date_from as string)
  }

  if (req.query.date_to) {
    where.push('date <= ?')
    params.push(req.query.date_to as string)
  }

  if (req.query.exclude_internal === '1') {
    where.push('is_internal = 0')
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : 'WHERE 1=1'

  const viewMode = buildFinancialFilter(
    (req.query.view_mode as string) || 'cashflow',
    parseExcludedKinds(req.query.excluded_kinds),
  )

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM transactions t ${whereSql} ${viewMode.sql}`,
      )
      .get(...params, ...viewMode.params) as CountRow
  ).count

  const rows = db
    .prepare(
      `SELECT t.*, c.name as category_name, v.original_amount, v.original_currency, v.valuation_status, v.valuation_note
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN transaction_valuations v ON v.transaction_id=t.id
       ${whereSql} ${viewMode.sql}
       ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`,
    )
    .all(...params, ...viewMode.params, limit, offset)
    .map((r) =>
      mapTransaction(r as TransactionWithCategory),
    ) as TransactionApiRow[]

  // Batch-fetch tags and review flags for returned transactions
  const tagMap = fetchTagsForTransactions(rows.map((r) => r.id))
  const reviewIds = getReviewFlaggedIds(viewMode)
  const items = rows.map((r) => ({
    ...r,
    tags: tagMap[r.id] || [],
    needs_review: reviewIds.has(r.id),
  }))

  res.json({ items, total })
})

app.get('/api/transactions/:id', (req: Request, res: Response) => {
  const row = db
    .prepare('SELECT * FROM transactions WHERE id = ?')
    .get(req.params.id) as TransactionRow | undefined

  if (!row) {
    return res
      .status(404)
      .json({ error: { code: 'not_found', message: 'transaction not found' } })
  }

  res.json({ transaction: mapTransaction(row) })
})

app.patch('/api/transactions/:id', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const updates: string[] = []
  const params: (string | number | null)[] = []

  if ('category_id' in body) {
    updates.push('category_id = ?')
    params.push(body.category_id as string | null)
  }

  if ('notes' in body) {
    updates.push('notes = ?')
    params.push(body.notes as string | null)
  }

  if ('is_recurring_candidate' in body) {
    updates.push('is_recurring_candidate = ?')
    params.push(body.is_recurring_candidate ? 1 : 0)
  }

  if ('is_internal' in body) {
    updates.push('is_internal = ?')
    params.push(body.is_internal ? 1 : 0)
  }

  if ('spread_months' in body) {
    updates.push('spread_months = ?')
    params.push(body.spread_months as number | null)
  }

  if (!updates.length) {
    return res.status(400).json({
      error: { code: 'no_updates', message: 'no valid fields to update' },
    })
  }

  const stmt = db.prepare(
    `UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`,
  )
  const result = stmt.run(...params, req.params.id)

  if (result.changes === 0) {
    return res
      .status(404)
      .json({ error: { code: 'not_found', message: 'transaction not found' } })
  }

  const row = db
    .prepare('SELECT * FROM transactions WHERE id = ?')
    .get(req.params.id) as TransactionRow
  res.json({ transaction: mapTransaction(row) })
})

// ── Categories CRUD ─────────────────────────────────────────────────────────
app.get('/api/categories', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM categories').all() as CategoryRow[]
  res.json({ items: rows })
})

app.post('/api/categories', (req: Request, res: Response) => {
  const name = (req.body as { name?: string })?.name?.trim()
  if (!name) {
    return res
      .status(400)
      .json({ error: { code: 'invalid_name', message: 'name is required' } })
  }

  const id = randomUUID()
  const parentId =
    (req.body as { parent_id?: string | null })?.parent_id ?? null

  db.prepare(
    'INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)',
  ).run(id, name, parentId)

  const row = db
    .prepare('SELECT * FROM categories WHERE id = ?')
    .get(id) as CategoryRow
  res.status(201).json({ category: row })
})

app.patch('/api/categories/:id', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const updates: string[] = []
  const params: (string | null)[] = []

  if ('name' in body) {
    updates.push('name = ?')
    params.push(body.name as string)
  }

  if ('parent_id' in body) {
    updates.push('parent_id = ?')
    params.push(body.parent_id as string | null)
  }

  if (!updates.length) {
    return res.status(400).json({
      error: { code: 'no_updates', message: 'no valid fields to update' },
    })
  }

  const stmt = db.prepare(
    `UPDATE categories SET ${updates.join(', ')} WHERE id = ?`,
  )
  const result = stmt.run(...params, req.params.id)

  if (result.changes === 0) {
    return res
      .status(404)
      .json({ error: { code: 'not_found', message: 'category not found' } })
  }

  const row = db
    .prepare('SELECT * FROM categories WHERE id = ?')
    .get(req.params.id) as CategoryRow
  res.json({ category: row })
})

app.delete('/api/categories/:id', (req: Request, res: Response) => {
  const result = db
    .prepare('DELETE FROM categories WHERE id = ?')
    .run(req.params.id)

  if (result.changes === 0) {
    return res
      .status(404)
      .json({ error: { code: 'not_found', message: 'category not found' } })
  }

  res.status(204).end()
})

// ── Rules CRUD ──────────────────────────────────────────────────────────────
app.get('/api/rules', (_req: Request, res: Response) => {
  const rows = (db.prepare('SELECT * FROM rules').all() as RuleRow[]).map(
    mapRule,
  )
  res.json({ items: rows })
})

app.post('/api/rules', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const matchType = body?.match_type as string | undefined
  const pattern = body?.pattern as string | undefined
  const categoryId = body?.category_id as string | undefined
  const priority = Number(body?.priority ?? 0)

  if (!matchType || !pattern || !categoryId) {
    return res.status(400).json({
      error: {
        code: 'invalid_payload',
        message: 'match_type, pattern, and category_id are required',
      },
    })
  }

  const id = randomUUID()
  db.prepare(
    'INSERT INTO rules (id, match_type, pattern, category_id, priority, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, matchType, pattern, categoryId, priority, 1, nowIso())

  const row = db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow
  res.status(201).json({ rule: mapRule(row) })
})

app.patch('/api/rules/:id', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const updates: string[] = []
  const params: (string | number)[] = []

  if ('pattern' in body) {
    updates.push('pattern = ?')
    params.push(body.pattern as string)
  }

  if ('category_id' in body) {
    updates.push('category_id = ?')
    params.push(body.category_id as string)
  }

  if ('priority' in body) {
    updates.push('priority = ?')
    params.push(body.priority as number)
  }

  if ('enabled' in body) {
    updates.push('enabled = ?')
    params.push(body.enabled ? 1 : 0)
  }

  if (!updates.length) {
    return res.status(400).json({
      error: { code: 'no_updates', message: 'no valid fields to update' },
    })
  }

  const stmt = db.prepare(`UPDATE rules SET ${updates.join(', ')} WHERE id = ?`)
  const result = stmt.run(...params, req.params.id)

  if (result.changes === 0) {
    return res
      .status(404)
      .json({ error: { code: 'not_found', message: 'rule not found' } })
  }

  const row = db
    .prepare('SELECT * FROM rules WHERE id = ?')
    .get(req.params.id) as RuleRow
  res.json({ rule: mapRule(row) })
})

app.delete('/api/rules/:id', (req: Request, res: Response) => {
  const result = db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id)

  if (result.changes === 0) {
    return res
      .status(404)
      .json({ error: { code: 'not_found', message: 'rule not found' } })
  }

  res.status(204).end()
})

// ── Spread helper ─────────────────────────────────────────────────────────
function querySpreadTransactions(
  viewMode: ViewModeFilter,
  extraWhere: string[] = [],
  extraParams: (string | number | null)[] = [],
): SpreadTransaction[] {
  const where = ['t.spread_months IS NOT NULL', ...extraWhere]
  if (!viewMode.includeInternal) where.push('t.is_internal = 0')
  const whereSql = `WHERE ${where.join(' AND ')} ${viewMode.sql}`
  const allParams = [...extraParams, ...viewMode.params]
  return db
    .prepare(
      `SELECT t.date, t.amount, t.spread_months, t.category_id
       FROM transactions t ${whereSql}`,
    )
    .all(...allParams) as SpreadTransaction[]
}

function spreadAdjustmentInDateRange(
  month: string,
  dateFrom?: string,
  dateTo?: string,
): boolean {
  if (dateFrom && `${month}-31` < dateFrom) return false
  if (dateTo && `${month}-01` > dateTo) return false
  return true
}

// ── Insights ────────────────────────────────────────────────────────────────
app.get('/api/insights/summary', (req: Request, res: Response) => {
  const viewMode = buildFinancialFilter(
    (req.query.view_mode as string) || 'cashflow',
    parseExcludedKinds(req.query.excluded_kinds),
  )
  const where: string[] = []
  const params: string[] = []

  if (!viewMode.includeInternal) {
    where.push('t.is_internal = 0')
  }

  const dateFrom = req.query.date_from as string | undefined
  const dateTo = req.query.date_to as string | undefined

  if (dateFrom) {
    where.push('t.date >= ?')
    params.push(dateFrom)
  }

  if (dateTo) {
    where.push('t.date <= ?')
    params.push(dateTo)
  }

  const insightWhere = where.length
    ? `WHERE ${where.join(' AND ')} ${viewMode.sql}`
    : `WHERE 1=1 ${viewMode.sql}`
  const allParams = [...params, ...viewMode.params]

  const totals = db
    .prepare(
      `SELECT
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS spend,
        SUM(CASE WHEN amount >= 0 THEN amount ELSE 0 END) AS income
      FROM transactions t ${insightWhere}`,
    )
    .get(...allParams) as SummaryTotals | undefined
  const mutableTotals = {
    spend: totals?.spend ?? 0,
    income: totals?.income ?? 0,
  }

  // 1b. Include spending_type and category_group in by_category query
  const byCategory = db
    .prepare(
      `SELECT
        t.category_id,
        c.name AS category_name,
        c.spending_type,
        c.category_group,
        SUM(t.amount) AS total,
        COUNT(*) AS count
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      ${insightWhere}
      GROUP BY t.category_id
      ORDER BY total ASC`,
    )
    .all(...allParams) as CategoryBreakdown[]

  const topMerchants = db
    .prepare(
      `SELECT
        t.merchant,
        SUM(t.amount) AS total,
        COUNT(*) AS count,
        c.name AS category_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      ${insightWhere}
      GROUP BY t.merchant
      ORDER BY total ASC
      LIMIT 20`,
    )
    .all(...allParams) as TopMerchant[]

  // Spread adjustments redistribute payments inside the requested date range.
  const spreadTxns = dateFrom || dateTo ? querySpreadTransactions(viewMode) : []
  const spreadAdjs = computeSpreadAdjustments(spreadTxns).filter((adj) =>
    spreadAdjustmentInDateRange(adj.month, dateFrom, dateTo),
  )
  for (const adj of spreadAdjs) {
    // Totals
    if (adj.kind === 'expense') mutableTotals.spend += adj.amount
    else mutableTotals.income += adj.amount

    // By category
    const existing = byCategory.find((c) => c.category_id === adj.category_id)
    if (existing) {
      existing.total += adj.amount
    } else {
      const catRow = adj.category_id
        ? (db
            .prepare(
              'SELECT name, spending_type, category_group FROM categories WHERE id = ?',
            )
            .get(adj.category_id) as
            | {
                name: string
                spending_type: string | null
                category_group: string | null
              }
            | undefined)
        : undefined
      byCategory.push({
        category_id: adj.category_id,
        category_name: catRow?.name ?? null,
        total: adj.amount,
        count: 0,
        spending_type: catRow?.spending_type,
        category_group: catRow?.category_group,
      })
    }
  }
  byCategory.sort((a, b) => a.total - b.total)

  // 1a. Avg monthly spend per category across all DB months (expenses only)
  const avgMonthlyRows = db
    .prepare(
      `SELECT sub.category_id, AVG(sub.monthly_total) AS avg_monthly
       FROM (
         SELECT t.category_id, substr(t.date, 1, 7) AS month, SUM(CASE WHEN t.spread_months IS NOT NULL THEN t.amount / t.spread_months ELSE t.amount END) AS monthly_total
         FROM transactions t
         WHERE t.is_internal = 0 AND t.amount < 0 ${viewMode.sql}
         GROUP BY t.category_id, month
       ) sub
       GROUP BY sub.category_id`,
    )
    .all(...viewMode.params) as CategoryAvgMonthly[]

  const avgMonthlyMap = new Map<string | null, number>(
    avgMonthlyRows.map((r) => [r.category_id, r.avg_monthly]),
  )

  // Determine vs_avg_pct: compare current period total to average
  // For a monthly or yearly date range, compare; for "all" (no dates), use last complete month
  let lastCompleteMonthTotals: Map<string | null, number> | undefined
  if (!dateFrom && !dateTo) {
    // Find the last complete month (the month before the current month)
    const now = new Date('2026-02-28')
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`
    const lastMonthRows = db
      .prepare(
        `SELECT t.category_id, SUM(CASE WHEN t.spread_months IS NOT NULL THEN t.amount / t.spread_months ELSE t.amount END) AS total
         FROM transactions t
         WHERE t.is_internal = 0 AND t.amount < 0
           AND substr(t.date, 1, 7) = ? ${viewMode.sql}
         GROUP BY t.category_id`,
      )
      .all(lastMonthStr, ...viewMode.params) as {
      category_id: string | null
      total: number
    }[]
    lastCompleteMonthTotals = new Map(
      lastMonthRows.map((r) => [r.category_id, r.total]),
    )
  }

  const byCategoryEnriched = byCategory.map((cat) => {
    const avg = avgMonthlyMap.get(cat.category_id ?? null)
    let vs_avg_pct: number | null = null

    if (avg && avg !== 0) {
      if (dateFrom || dateTo) {
        // Current period total vs monthly average
        const currentTotal = cat.total < 0 ? Math.abs(cat.total) : cat.total
        vs_avg_pct = (currentTotal / Math.abs(avg) - 1) * 100
      } else if (lastCompleteMonthTotals) {
        // Last complete month vs average
        const lastMonthTotal = lastCompleteMonthTotals.get(
          cat.category_id ?? null,
        )
        if (lastMonthTotal !== undefined) {
          vs_avg_pct = (Math.abs(lastMonthTotal) / Math.abs(avg) - 1) * 100
        }
      }
    }

    return {
      ...cat,
      avg_monthly: avg !== undefined ? Math.abs(avg) : undefined,
      vs_avg_pct,
    }
  })

  // 1c. by_spending_type — aggregate expenses by spending_type
  const spendingTypeRows = db
    .prepare(
      `SELECT c.spending_type, SUM(t.amount) AS total
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       ${insightWhere} AND t.amount < 0 AND c.spending_type IN ('needs', 'wants', 'savings')
       GROUP BY c.spending_type`,
    )
    .all(...allParams) as SpendingTypeTotal[]

  // Add spread adjustments to spending type totals
  for (const adj of spreadAdjs) {
    if (adj.kind !== 'expense') continue
    const catRow = adj.category_id
      ? (db
          .prepare('SELECT spending_type FROM categories WHERE id = ?')
          .get(adj.category_id) as { spending_type: string | null } | undefined)
      : undefined
    const st = catRow?.spending_type
    if (st && ['needs', 'wants', 'savings'].includes(st)) {
      const existing = spendingTypeRows.find((r) => r.spending_type === st)
      if (existing) existing.total += adj.amount
      else spendingTypeRows.push({ spending_type: st, total: adj.amount })
    }
  }

  const totalExpensesByType = spendingTypeRows.reduce(
    (sum, r) => sum + Math.abs(r.total),
    0,
  )

  const bySpendingType: Record<string, { total: number; pct: number }> = {
    needs: { total: 0, pct: 0 },
    wants: { total: 0, pct: 0 },
    savings: { total: 0, pct: 0 },
    structural: { total: 0, pct: 0 },
  }
  for (const row of spendingTypeRows) {
    if (row.spending_type && row.spending_type in bySpendingType) {
      const absTotal = Math.abs(row.total)
      bySpendingType[row.spending_type] = {
        total: -absTotal,
        pct:
          totalExpensesByType > 0
            ? Math.round((absTotal / totalExpensesByType) * 100)
            : 0,
      }
    }
  }

  // 1d. trending_up — top 3 categories with highest positive % change (recent 3 months vs prior 3)
  // Current date: 2026-02-28
  // Recent 3 months: 2025-12, 2026-01, 2026-02
  // Prior 3 months: 2025-09, 2025-10, 2025-11
  const now = new Date('2026-02-28')
  const recentMonths: string[] = []
  const priorMonths: string[] = []
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    recentMonths.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    )
  }
  for (let i = 3; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    priorMonths.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    )
  }
  const recentStart = recentMonths[recentMonths.length - 1]
  const recentEnd = recentMonths[0]
  const priorStart = priorMonths[priorMonths.length - 1]
  const priorEnd = priorMonths[0]

  const recentRows = db
    .prepare(
      `SELECT t.category_id, c.name AS category_name, SUM(CASE WHEN t.spread_months IS NOT NULL THEN t.amount / t.spread_months ELSE t.amount END) / 3.0 AS recent_avg
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.is_internal = 0 AND t.amount < 0
         AND substr(t.date, 1, 7) >= ? AND substr(t.date, 1, 7) <= ?
         ${viewMode.sql}
       GROUP BY t.category_id`,
    )
    .all(recentStart, recentEnd, ...viewMode.params) as {
    category_id: string
    category_name: string
    recent_avg: number
  }[]

  const priorRows = db
    .prepare(
      `SELECT t.category_id, SUM(CASE WHEN t.spread_months IS NOT NULL THEN t.amount / t.spread_months ELSE t.amount END) / 3.0 AS prior_avg
       FROM transactions t
       WHERE t.is_internal = 0 AND t.amount < 0
         AND substr(t.date, 1, 7) >= ? AND substr(t.date, 1, 7) <= ?
         ${viewMode.sql}
       GROUP BY t.category_id`,
    )
    .all(priorStart, priorEnd, ...viewMode.params) as {
    category_id: string
    prior_avg: number
  }[]

  const priorMap = new Map(priorRows.map((r) => [r.category_id, r.prior_avg]))

  const trendingUp: TrendingCategory[] = recentRows
    .filter((r) => {
      const prior = priorMap.get(r.category_id)
      return prior !== undefined && prior < 0 && r.recent_avg < 0
    })
    .map((r) => {
      const prior = priorMap.get(r.category_id)!
      const change_pct = (Math.abs(r.recent_avg) / Math.abs(prior) - 1) * 100
      return {
        category_id: r.category_id,
        category_name: r.category_name,
        recent_avg: Math.abs(r.recent_avg),
        prior_avg: Math.abs(prior),
        change_pct: Math.round(change_pct * 10) / 10,
      }
    })
    .filter((r) => r.change_pct > 0)
    .sort((a, b) => b.change_pct - a.change_pct)
    .slice(0, 3)

  const trendingDown: TrendingCategory[] = recentRows
    .filter((r) => {
      const prior = priorMap.get(r.category_id)
      return prior !== undefined && prior < 0 && r.recent_avg < 0
    })
    .map((r) => {
      const prior = priorMap.get(r.category_id)!
      const change_pct = (Math.abs(r.recent_avg) / Math.abs(prior) - 1) * 100
      return {
        category_id: r.category_id,
        category_name: r.category_name,
        recent_avg: Math.abs(r.recent_avg),
        prior_avg: Math.abs(prior),
        change_pct: Math.round(change_pct * 10) / 10,
      }
    })
    .filter((r) => r.change_pct < 0)
    .sort((a, b) => a.change_pct - b.change_pct)
    .slice(0, 3)

  res.json({
    total_spend: Math.abs(mutableTotals.spend ?? 0),
    total_income: mutableTotals.income ?? 0,
    by_category: byCategoryEnriched,
    top_merchants: topMerchants,
    by_spending_type: bySpendingType,
    trending_up: trendingUp,
    trending_down: trendingDown,
  })
})

// ── Category Drill-down ─────────────────────────────────────────────────────
app.get(
  '/api/insights/category-transactions',
  (req: Request, res: Response) => {
    const categoryId = req.query.category_id as string | undefined
    const where: string[] = []
    const params: string[] = []

    if (categoryId) {
      where.push('t.category_id = ?')
      params.push(categoryId)
    } else {
      where.push('t.category_id IS NULL')
    }

    if (req.query.date_from) {
      where.push('t.date >= ?')
      params.push(req.query.date_from as string)
    }

    if (req.query.date_to) {
      where.push('t.date <= ?')
      params.push(req.query.date_to as string)
    }

    const viewMode = buildFinancialFilter(
      (req.query.view_mode as string) || 'cashflow',
      parseExcludedKinds(req.query.excluded_kinds),
    )
    const whereSql = `WHERE ${where.join(' AND ')} ${viewMode.sql}`
    const allParams = [...params, ...viewMode.params]

    const rows = db
      .prepare(
        `SELECT t.id, t.date, t.merchant, t.amount, t.currency, t.spread_months, t.category_id, t.notes, c.name as category_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       ${whereSql}
       ORDER BY ABS(t.amount) DESC, t.date DESC
       LIMIT 500`,
      )
      .all(...allParams)

    const reviewIds = getReviewFlaggedIds(viewMode)
    const items = (rows as { id: string }[]).map((r) => ({
      ...r,
      needs_review: reviewIds.has(r.id),
    }))

    res.json({ items })
  },
)

// ── Monthly summary with category breakdown ─────────────────────────────────
app.get('/api/insights/monthly', (req: Request, res: Response) => {
  const viewMode = buildFinancialFilter(
    (req.query.view_mode as string) || 'cashflow',
    parseExcludedKinds(req.query.excluded_kinds),
  )
  const where: string[] = []
  const params: string[] = []

  if (!viewMode.includeInternal) {
    where.push('t.is_internal = 0')
  }

  if (req.query.year) {
    where.push('substr(t.date, 1, 4) = ?')
    params.push(req.query.year as string)
  }

  const monthlyWhere = where.length
    ? `WHERE ${where.join(' AND ')} ${viewMode.sql}`
    : `WHERE 1=1 ${viewMode.sql}`
  const allParams = [...params, ...viewMode.params]

  // Monthly totals
  const months = db
    .prepare(
      `SELECT
        substr(t.date, 1, 7) AS month,
        SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS spend,
        SUM(CASE WHEN t.amount >= 0 THEN t.amount ELSE 0 END) AS income,
        COUNT(*) AS count
      FROM transactions t
      ${monthlyWhere}
      GROUP BY substr(t.date, 1, 7)
      ORDER BY month DESC`,
    )
    .all(...allParams) as MonthlyRow[]

  // Per-month category breakdown
  const categoryByMonth = db
    .prepare(
      `SELECT
        substr(t.date, 1, 7) AS month,
        t.category_id,
        c.name AS category_name,
        SUM(t.amount) AS total,
        COUNT(*) AS count
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      ${monthlyWhere}
      GROUP BY substr(t.date, 1, 7), t.category_id
      ORDER BY month DESC, total ASC`,
    )
    .all(...allParams) as CategoryByMonthRow[]

  // ── Spread adjustments for monthly ────────────────────────────────────────
  const spreadTxns = querySpreadTransactions(viewMode)
  const spreadAdjs = computeSpreadAdjustments(spreadTxns)
  const yearFilter = req.query.year as string | undefined

  // Merge spread into monthly totals
  const monthMap = new Map(months.map((m) => [m.month, m]))
  for (const adj of spreadAdjs) {
    if (yearFilter && !adj.month.startsWith(yearFilter)) continue
    let row = monthMap.get(adj.month)
    if (!row) {
      row = { month: adj.month, spend: 0, income: 0, count: 0 }
      monthMap.set(adj.month, row)
      months.push(row)
    }
    if (adj.kind === 'expense') row.spend = (row.spend ?? 0) + adj.amount
    else row.income = (row.income ?? 0) + adj.amount
  }
  months.sort((a, b) => b.month.localeCompare(a.month))

  // Group categories by month
  const categoryMap: Record<string, CategoryByMonthRow[]> = {}
  for (const row of categoryByMonth) {
    if (!categoryMap[row.month]) categoryMap[row.month] = []
    categoryMap[row.month].push(row)
  }

  // Merge spread into per-month category breakdown
  for (const adj of spreadAdjs) {
    if (yearFilter && !adj.month.startsWith(yearFilter)) continue
    if (!categoryMap[adj.month]) categoryMap[adj.month] = []
    const existing = categoryMap[adj.month].find(
      (c) => c.category_id === adj.category_id,
    )
    if (existing) {
      existing.total += adj.amount
    } else {
      const catRow = adj.category_id
        ? (db
            .prepare('SELECT name FROM categories WHERE id = ?')
            .get(adj.category_id) as { name: string } | undefined)
        : undefined
      categoryMap[adj.month].push({
        month: adj.month,
        category_id: adj.category_id,
        category_name: catRow?.name ?? null,
        total: adj.amount,
        count: 0,
      })
    }
  }

  // Available years
  const years = (
    db
      .prepare(
        `SELECT DISTINCT substr(date, 1, 4) AS year FROM transactions ORDER BY year DESC`,
      )
      .all() as { year: string }[]
  ).map((r) => r.year)

  res.json({
    months: months.map((m) => ({
      ...m,
      categories: categoryMap[m.month] || [],
    })),
    years,
  })
})

// ── Category Trend ───────────────────────────────────────────────────────────
app.get('/api/insights/category-trend', (req: Request, res: Response) => {
  const categoryId = req.query.category_id as string | undefined
  const dateFrom = req.query.date_from as string | undefined
  const dateTo = req.query.date_to as string | undefined
  const granularity = req.query.granularity === 'day' ? 'day' : 'month'
  const viewMode = buildFinancialFilter(
    (req.query.view_mode as string) || 'cashflow',
    parseExcludedKinds(req.query.excluded_kinds),
  )

  const where: string[] = ['t.is_internal = 0']
  const params: string[] = []

  if (categoryId) {
    where.push('t.category_id = ?')
    params.push(categoryId)
  } else {
    where.push('t.category_id IS NULL')
  }

  if (dateFrom) {
    where.push('t.date >= ?')
    params.push(dateFrom)
  }
  if (dateTo) {
    where.push('t.date <= ?')
    params.push(dateTo)
  }

  const whereSql = `WHERE ${where.join(' AND ')} ${viewMode.sql}`
  const allParams = [...params, ...viewMode.params]

  const periodExpr = granularity === 'day' ? 't.date' : 'substr(t.date, 1, 7)'

  const rows = db
    .prepare(
      `SELECT ${periodExpr} AS period, SUM(ABS(t.amount)) AS total
       FROM transactions t
       ${whereSql} AND t.amount < 0
       GROUP BY ${periodExpr}
       ORDER BY period ASC`,
    )
    .all(...allParams) as TrendPoint[]

  // ── Spread adjustments for category-trend ───────────────────────────────
  if (granularity === 'month') {
    const spreadExtra: string[] = ['t.amount < 0']
    const spreadParams: (string | number | null)[] = []
    if (categoryId) {
      spreadExtra.push('t.category_id = ?')
      spreadParams.push(categoryId)
    } else {
      spreadExtra.push('t.category_id IS NULL')
    }
    const spreadTxns = querySpreadTransactions(
      viewMode,
      spreadExtra,
      spreadParams,
    )
    const spreadAdjs = computeSpreadAdjustments(spreadTxns)
    const spreadMap = buildSpreadMap(spreadAdjs)

    const rowMap = new Map(rows.map((r) => [r.period, r]))
    for (const [month, delta] of spreadMap) {
      if (dateFrom && month + '-31' < dateFrom) continue
      if (dateTo && month + '-01' > dateTo) continue
      const existing = rowMap.get(month)
      if (existing) {
        // Signed expense deltas reverse the payment before adding allocations.
        existing.total -= delta
      } else if (delta < 0) {
        // Only add months with expense spread
        const newRow = { period: month, total: Math.abs(delta) }
        rowMap.set(month, newRow)
        rows.push(newRow)
      }
    }
    rows.sort((a, b) => a.period.localeCompare(b.period))
  }

  const average =
    rows.length > 0
      ? rows.reduce((sum, r) => sum + r.total, 0) / rows.length
      : 0

  let peak: TrendPoint | null = null
  let lowest: TrendPoint | null = null
  for (const row of rows) {
    if (peak === null || row.total > peak.total) peak = row
    if (lowest === null || row.total < lowest.total) lowest = row
  }

  res.json({
    points: rows,
    average: Math.round(average * 100) / 100,
    peak: peak ?? null,
    lowest: lowest ?? null,
  })
})

// ── Analysis Document ───────────────────────────────────────────────────────
app.get('/api/analysis/report', (req: Request, res: Response) => {
  const report = generateAnalysisReport(
    undefined,
    (req.query.view_mode as string) || 'cashflow',
  )
  res.type('text/markdown').send(report)
})

app.post('/api/analysis/save', (req: Request, res: Response) => {
  const notes = (req.body as { notes?: string })?.notes
  if (!notes) {
    return res.status(400).json({
      error: { code: 'missing_notes', message: 'notes field is required' },
    })
  }

  const report = generateAnalysisReport(notes)
  const analysisPath = path.join(dataDir, 'analysis.md')
  fs.writeFileSync(analysisPath, report, 'utf8')

  res.json({ status: 'saved', path: analysisPath })
})

function generateAnalysisReport(
  additionalNotes?: string,
  viewModeParam: string = 'cashflow',
): string {
  const viewMode = buildViewModeFilter(viewModeParam)
  const internalFilter = viewMode.includeInternal ? '' : 'AND t.is_internal = 0'

  // Date range
  const dateRange = db
    .prepare(
      `SELECT MIN(t.date) as min_date, MAX(t.date) as max_date FROM transactions t WHERE 1=1 ${viewMode.sql}`,
    )
    .get(...viewMode.params) as DateRange

  // Totals
  const totals = db
    .prepare(
      `SELECT
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS spend,
        SUM(CASE WHEN amount >= 0 THEN amount ELSE 0 END) AS income,
        COUNT(*) AS count
      FROM transactions t WHERE 1=1 ${internalFilter} ${viewMode.sql}`,
    )
    .get(...viewMode.params) as (SummaryTotals & { count: number }) | undefined

  const totalSpend = Math.abs(totals?.spend ?? 0)
  const totalIncome = totals?.income ?? 0
  const net = totalIncome - totalSpend

  // Monthly breakdown
  const monthly = db
    .prepare(
      `SELECT
        substr(t.date, 1, 7) AS month,
        SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS spend,
        SUM(CASE WHEN t.amount >= 0 THEN t.amount ELSE 0 END) AS income
      FROM transactions t
      WHERE 1=1 ${internalFilter} ${viewMode.sql}
      GROUP BY substr(t.date, 1, 7)
      ORDER BY month DESC`,
    )
    .all(...viewMode.params) as {
    month: string
    spend: number | null
    income: number | null
  }[]

  // Category breakdown
  const numMonths = Math.max(monthly.length, 1)
  const byCategory = db
    .prepare(
      `SELECT
        c.name AS category_name,
        SUM(t.amount) AS total,
        COUNT(*) AS count
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.amount < 0 ${internalFilter} ${viewMode.sql}
      GROUP BY t.category_id
      ORDER BY total ASC`,
    )
    .all(...viewMode.params) as {
    category_name: string | null
    total: number
    count: number
  }[]

  // Top merchants
  const topMerchants = db
    .prepare(
      `SELECT
        t.merchant,
        SUM(t.amount) AS total,
        COUNT(*) AS count,
        c.name AS category_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.amount < 0 ${internalFilter} ${viewMode.sql}
      GROUP BY t.merchant
      ORDER BY total ASC
      LIMIT 30`,
    )
    .all(...viewMode.params) as TopMerchant[]

  // Recurring candidates (merchants appearing 2+ months)
  const recurring = db
    .prepare(
      `SELECT
        t.merchant,
        COUNT(DISTINCT substr(t.date, 1, 7)) AS months,
        ROUND(AVG(t.amount), 2) AS avg_amount,
        COUNT(*) AS count
      FROM transactions t
      WHERE t.amount < 0 ${internalFilter} ${viewMode.sql}
      GROUP BY t.merchant
      HAVING months >= 2 AND count >= 2
      ORDER BY avg_amount ASC`,
    )
    .all(...viewMode.params) as RecurringCandidate[]

  // Read existing notes from file
  const analysisPath = path.join(dataDir, 'analysis.md')
  let existingNotes = ''
  if (fs.existsSync(analysisPath)) {
    const existing = fs.readFileSync(analysisPath, 'utf8')
    const notesMatch = existing.match(/## Notes & Observations\n([\s\S]*?)$/)
    if (notesMatch) {
      existingNotes = notesMatch[1].trim()
    }
  }

  const allNotes = additionalNotes
    ? existingNotes
      ? `${existingNotes}\n\n${additionalNotes}`
      : additionalNotes
    : existingNotes

  const fmt = (n: number): string =>
    `₪${Math.abs(n).toLocaleString('en-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

  const formatMonth = (ym: string): string => {
    const [y, m] = ym.split('-')
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ]
    return `${monthNames[parseInt(m) - 1]} ${y}`
  }

  let md = `# Spending Analysis\n\n`
  md += `## Summary\n`
  md += `- Period covered: ${dateRange.min_date || 'N/A'} – ${dateRange.max_date || 'N/A'}\n`
  md += `- Total income: ${fmt(totalIncome)}\n`
  md += `- Total expenses: ${fmt(totalSpend)}\n`
  md += `- Net: ${net >= 0 ? '' : '-'}${fmt(Math.abs(net))}\n`
  md += `- Transactions: ${totals?.count ?? 0}\n\n`

  md += `## Monthly Breakdown\n`
  for (const m of monthly) {
    const mSpend = Math.abs(m.spend ?? 0)
    const mIncome = m.income ?? 0
    md += `### ${formatMonth(m.month)}\n`
    md += `- Income: ${fmt(mIncome)}\n`
    md += `- Expenses: ${fmt(mSpend)}\n`
    md += `- Net: ${mIncome - mSpend >= 0 ? '' : '-'}${fmt(Math.abs(mIncome - mSpend))}\n\n`
  }

  md += `## Category Breakdown (All Time)\n`
  md += `| Category | Total | % of Spend | Avg/Month |\n`
  md += `|----------|-------|------------|----------|\n`
  for (const cat of byCategory) {
    const catTotal = Math.abs(cat.total)
    const pct =
      totalSpend > 0 ? ((catTotal / totalSpend) * 100).toFixed(1) : '0.0'
    const avg = catTotal / numMonths
    md += `| ${cat.category_name || 'Uncategorized'} | ${fmt(catTotal)} | ${pct}% | ${fmt(avg)} |\n`
  }
  md += `\n`

  md += `## Top Merchants\n`
  md += `| Merchant | Total | Count | Category |\n`
  md += `|----------|-------|-------|----------|\n`
  for (const m of topMerchants) {
    md += `| ${m.merchant} | ${fmt(Math.abs(m.total))} | ${m.count} | ${m.category_name || 'Uncategorized'} |\n`
  }
  md += `\n`

  if (recurring.length > 0) {
    md += `## Recurring Transactions\n`
    for (const r of recurring) {
      md += `- ${r.merchant}: ~${fmt(Math.abs(r.avg_amount))}/month (${r.months} months)\n`
    }
    md += `\n`
  }

  md += `## Notes & Observations\n`
  md += allNotes || '(Add notes here after discussing with Claude)\n'

  return md
}

// ── Recurring Merchants ──────────────────────────────────────────────────────
app.get('/api/recurring', (req: Request, res: Response) => {
  const mode = (req.query.view_mode as string) || 'cashflow'
  const vmf = buildFinancialFilter(
    mode,
    parseExcludedKinds(req.query.excluded_kinds),
    't',
  )

  // Compute a cutoff date for "recent" average (last 3 months)
  const recentCutoff = new Date()
  recentCutoff.setMonth(recentCutoff.getMonth() - 3)
  const recentDate = recentCutoff.toISOString().slice(0, 7) // YYYY-MM

  const rows = db
    .prepare(`
    SELECT
      t.merchant,
      c.name AS category_name,
      t.category_id,
      ROUND(AVG(t.amount), 2) AS avg_amount,
      ROUND((
        SELECT AVG(t2.amount)
        FROM transactions t2
        WHERE t2.merchant = t.merchant
          AND t2.is_recurring_candidate = 1
          AND t2.is_internal = 0
          AND substr(t2.date, 1, 7) >= ?
      ), 2) AS recent_avg_amount,
      COUNT(DISTINCT substr(t.date, 1, 7)) AS months_active,
      MAX(t.date) AS last_seen,
      MIN(t.date) AS first_seen,
      COUNT(*) AS tx_count
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.is_recurring_candidate = 1 AND t.is_internal = 0
      ${vmf.sql}
    GROUP BY t.merchant
    ORDER BY avg_amount ASC
  `)
    .all(recentDate, ...vmf.params) as Omit<RecurringMerchant, 'is_active'>[]

  const twoMonthsAgo = new Date()
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)
  const cutoff = twoMonthsAgo.toISOString().slice(0, 10)

  const items: RecurringMerchant[] = rows.map((r) => ({
    ...r,
    is_active: r.last_seen >= cutoff,
  }))

  res.json({ items })
})

app.get('/api/recurring/trends', (_req: Request, res: Response) => {
  const rows = db
    .prepare(`
    SELECT merchant, substr(date, 1, 7) AS period, ROUND(SUM(amount), 2) AS total
    FROM transactions
    WHERE is_recurring_candidate = 1 AND is_internal = 0
    GROUP BY merchant, period
    ORDER BY merchant, period
  `)
    .all() as { merchant: string; period: string; total: number }[]

  const trends: Record<string, { period: string; total: number }[]> = {}
  for (const row of rows) {
    if (!trends[row.merchant]) trends[row.merchant] = []
    trends[row.merchant].push({ period: row.period, total: row.total })
  }
  res.json({ trends })
})

app.post('/api/recurring/dismiss', (req: Request, res: Response) => {
  const { merchant } = req.body as { merchant?: string }
  if (!merchant) {
    return res.status(400).json({
      error: { code: 'missing_merchant', message: 'merchant is required' },
    })
  }
  db.prepare(
    'UPDATE transactions SET is_recurring_candidate = 0 WHERE merchant = ?',
  ).run(merchant)
  res.json({ status: 'ok' })
})

app.post('/api/recurring/bulk-category', (req: Request, res: Response) => {
  const { merchant, category_id } = req.body as {
    merchant?: string
    category_id?: string
  }
  if (!merchant || !category_id) {
    return res.status(400).json({
      error: {
        code: 'missing_fields',
        message: 'merchant and category_id are required',
      },
    })
  }
  db.prepare(
    'UPDATE transactions SET category_id = ? WHERE merchant = ? AND is_recurring_candidate = 1',
  ).run(category_id, merchant)
  res.json({ status: 'ok' })
})

// ── Cash Allocations ─────────────────────────────────────────────────────────
app.get('/api/cash-allocations', (_req: Request, res: Response) => {
  const rows = db
    .prepare(`
    SELECT ca.*, c.name AS category_name
    FROM cash_allocations ca
    LEFT JOIN categories c ON c.id = ca.category_id
    ORDER BY ca.created_at DESC
  `)
    .all() as (CashAllocationRow & { category_name: string | null })[]
  res.json({ items: rows })
})

app.post('/api/cash-allocations', (req: Request, res: Response) => {
  const body = req.body as {
    description?: string
    amount?: number
    frequency?: string
    category_id?: string | null
    start_date?: string | null
    end_date?: string | null
  }

  if (!body.description || body.amount === undefined || !body.frequency) {
    return res.status(400).json({
      error: {
        code: 'missing_fields',
        message: 'description, amount, and frequency are required',
      },
    })
  }

  if (!['weekly', 'biweekly', 'monthly'].includes(body.frequency)) {
    return res.status(400).json({
      error: {
        code: 'invalid_frequency',
        message: 'frequency must be weekly, biweekly, or monthly',
      },
    })
  }

  const id = randomUUID()
  db.prepare(
    'INSERT INTO cash_allocations (id, description, amount, frequency, category_id, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    body.description,
    body.amount,
    body.frequency,
    body.category_id ?? null,
    body.start_date ?? null,
    body.end_date ?? null,
  )

  const row = db
    .prepare('SELECT * FROM cash_allocations WHERE id = ?')
    .get(id) as CashAllocationRow
  res.json({ allocation: row })
})

app.patch('/api/cash-allocations/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const body = req.body as Record<string, unknown>

  const updates: string[] = []
  const params: (string | number | null)[] = []

  if ('description' in body) {
    updates.push('description = ?')
    params.push(body.description as string)
  }
  if ('amount' in body) {
    updates.push('amount = ?')
    params.push(body.amount as number)
  }
  if ('frequency' in body) {
    updates.push('frequency = ?')
    params.push(body.frequency as string)
  }
  if ('category_id' in body) {
    updates.push('category_id = ?')
    params.push(body.category_id as string | null)
  }
  if ('start_date' in body) {
    updates.push('start_date = ?')
    params.push(body.start_date as string | null)
  }
  if ('end_date' in body) {
    updates.push('end_date = ?')
    params.push(body.end_date as string | null)
  }

  if (!updates.length) {
    return res
      .status(400)
      .json({ error: { code: 'no_fields', message: 'No fields to update' } })
  }

  const result = db
    .prepare(`UPDATE cash_allocations SET ${updates.join(', ')} WHERE id = ?`)
    .run(...params, id)
  if (result.changes === 0) {
    return res.status(404).json({
      error: { code: 'not_found', message: 'Cash allocation not found' },
    })
  }

  const row = db
    .prepare('SELECT * FROM cash_allocations WHERE id = ?')
    .get(id) as CashAllocationRow
  res.json({ allocation: row })
})

app.delete('/api/cash-allocations/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const result = db.prepare('DELETE FROM cash_allocations WHERE id = ?').run(id)
  if (result.changes === 0) {
    return res.status(404).json({
      error: { code: 'not_found', message: 'Cash allocation not found' },
    })
  }
  res.json({ success: true })
})

// ── tRPC Router ─────────────────────────────────────────────────────────────
// Mirrors all Express endpoints for gradual frontend migration to type-safe calls

const appRouter = router({
  health: publicProcedure.query(() => ({
    status: 'ok' as const,
    version: '0.1.0',
    data_dir: dataDir,
    db_path: dbPath,
    schema_path: schemaPath,
  })),

  // ── Categories ──
  categories: router({
    list: publicProcedure.query(() => {
      const rows = db.prepare('SELECT * FROM categories').all() as CategoryRow[]
      return { items: rows }
    }),

    create: publicProcedure
      .input(
        z.object({
          name: z.string().min(1),
          parent_id: z.string().nullable().optional(),
        }),
      )
      .mutation(({ input }) => {
        const id = randomUUID()
        db.prepare(
          'INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)',
        ).run(id, input.name.trim(), input.parent_id ?? null)
        const row = db
          .prepare('SELECT * FROM categories WHERE id = ?')
          .get(id) as CategoryRow
        return { category: row }
      }),

    update: publicProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          parent_id: z.string().nullable().optional(),
        }),
      )
      .mutation(({ input }) => {
        const updates: string[] = []
        const params: (string | null)[] = []
        if (input.name !== undefined) {
          updates.push('name = ?')
          params.push(input.name)
        }
        if (input.parent_id !== undefined) {
          updates.push('parent_id = ?')
          params.push(input.parent_id)
        }
        if (!updates.length) throw new Error('no valid fields to update')
        const result = db
          .prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`)
          .run(...params, input.id)
        if (result.changes === 0) throw new Error('category not found')
        return {
          category: db
            .prepare('SELECT * FROM categories WHERE id = ?')
            .get(input.id) as CategoryRow,
        }
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => {
        const result = db
          .prepare('DELETE FROM categories WHERE id = ?')
          .run(input.id)
        if (result.changes === 0) throw new Error('category not found')
        return { success: true }
      }),
  }),

  // ── Tags ──
  tags: router({
    list: publicProcedure.query(() => {
      const rows = db
        .prepare('SELECT * FROM tags ORDER BY name')
        .all() as TagRow[]
      return { items: rows }
    }),

    create: publicProcedure
      .input(
        z.object({
          name: z.string().min(1),
          color: z.string().nullable().optional(),
        }),
      )
      .mutation(({ input }) => {
        const id = randomUUID()
        db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(
          id,
          input.name.trim(),
          input.color ?? null,
        )
        return {
          tag: db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow,
        }
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => {
        const result = db.prepare('DELETE FROM tags WHERE id = ?').run(input.id)
        if (result.changes === 0) throw new Error('tag not found')
        return { success: true }
      }),
  }),

  // ── Transactions ──
  transactions: router({
    list: publicProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(200).default(50),
          offset: z.number().min(0).default(0),
          sort: z.enum(['date', 'amount', 'merchant']).default('date'),
          order: z.enum(['asc', 'desc']).default('desc'),
          account_id: z.string().optional(),
          category_id: z.string().optional(),
          q: z.string().optional(),
          date_from: z.string().optional(),
          date_to: z.string().optional(),
          exclude_internal: z.boolean().default(false),
          view_mode: viewModeSchema,
          excluded_kinds: excludedKindsSchema,
        }),
      )
      .query(({ input }) => {
        const limit = input.limit
        const offset = input.offset
        const sort = input.sort
        const order = input.order

        const where: string[] = []
        const params: (string | number)[] = []

        if (input.account_id) {
          where.push('account_id = ?')
          params.push(input.account_id)
        }
        if (input.category_id) {
          where.push('category_id = ?')
          params.push(input.category_id)
        }
        if (input.q) {
          where.push('merchant LIKE ?')
          params.push(`%${input.q}%`)
        }
        if (input.date_from) {
          where.push('date >= ?')
          params.push(input.date_from)
        }
        if (input.date_to) {
          where.push('date <= ?')
          params.push(input.date_to)
        }
        if (input.exclude_internal) {
          where.push('is_internal = 0')
        }

        const whereSql = where.length
          ? `WHERE ${where.join(' AND ')}`
          : 'WHERE 1=1'
        const viewMode = buildFinancialFilter(
          input.view_mode,
          input.excluded_kinds,
        )

        const total = (
          db
            .prepare(
              `SELECT COUNT(*) as count FROM transactions t ${whereSql} ${viewMode.sql}`,
            )
            .get(...params, ...viewMode.params) as CountRow
        ).count

        const rows = db
          .prepare(
            `SELECT t.*, c.name as category_name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ${whereSql} ${viewMode.sql} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`,
          )
          .all(...params, ...viewMode.params, limit, offset)
          .map((r) =>
            mapTransaction(r as TransactionWithCategory),
          ) as TransactionApiRow[]

        const tagMap = fetchTagsForTransactions(rows.map((r) => r.id))
        const items = rows.map((r) => ({ ...r, tags: tagMap[r.id] || [] }))
        return { items, total }
      }),

    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(({ input }) => {
        const row = db
          .prepare('SELECT * FROM transactions WHERE id = ?')
          .get(input.id) as TransactionRow | undefined
        if (!row) throw new Error('transaction not found')
        return { transaction: mapTransaction(row)! }
      }),

    update: publicProcedure
      .input(
        z.object({
          id: z.string(),
          category_id: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
          is_recurring_candidate: z.boolean().optional(),
          is_internal: z.boolean().optional(),
        }),
      )
      .mutation(({ input }) => {
        const updates: string[] = []
        const params: (string | number | null)[] = []
        if (input.category_id !== undefined) {
          updates.push('category_id = ?')
          params.push(input.category_id)
        }
        if (input.notes !== undefined) {
          updates.push('notes = ?')
          params.push(input.notes)
        }
        if (input.is_recurring_candidate !== undefined) {
          updates.push('is_recurring_candidate = ?')
          params.push(input.is_recurring_candidate ? 1 : 0)
        }
        if (input.is_internal !== undefined) {
          updates.push('is_internal = ?')
          params.push(input.is_internal ? 1 : 0)
        }
        if (!updates.length) throw new Error('no valid fields to update')

        const result = db
          .prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`)
          .run(...params, input.id)
        if (result.changes === 0) throw new Error('transaction not found')
        return {
          transaction: mapTransaction(
            db
              .prepare('SELECT * FROM transactions WHERE id = ?')
              .get(input.id) as TransactionRow,
          )!,
        }
      }),

    addTag: publicProcedure
      .input(z.object({ transaction_id: z.string(), tag_id: z.string() }))
      .mutation(({ input }) => {
        db.prepare(
          'INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)',
        ).run(input.transaction_id, input.tag_id)
        return { status: 'ok' as const }
      }),

    removeTag: publicProcedure
      .input(z.object({ transaction_id: z.string(), tag_id: z.string() }))
      .mutation(({ input }) => {
        db.prepare(
          'DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?',
        ).run(input.transaction_id, input.tag_id)
        return { success: true }
      }),
  }),

  // ── Rules ──
  rules: router({
    list: publicProcedure.query(() => {
      const rows = (db.prepare('SELECT * FROM rules').all() as RuleRow[]).map(
        mapRule,
      )
      return { items: rows }
    }),

    create: publicProcedure
      .input(
        z.object({
          match_type: z.string(),
          pattern: z.string(),
          category_id: z.string(),
          priority: z.number().default(0),
        }),
      )
      .mutation(({ input }) => {
        const id = randomUUID()
        db.prepare(
          'INSERT INTO rules (id, match_type, pattern, category_id, priority, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(
          id,
          input.match_type,
          input.pattern,
          input.category_id,
          input.priority,
          1,
          nowIso(),
        )
        return {
          rule: mapRule(
            db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow,
          )!,
        }
      }),

    update: publicProcedure
      .input(
        z.object({
          id: z.string(),
          pattern: z.string().optional(),
          category_id: z.string().optional(),
          priority: z.number().optional(),
          enabled: z.boolean().optional(),
        }),
      )
      .mutation(({ input }) => {
        const updates: string[] = []
        const params: (string | number)[] = []
        if (input.pattern !== undefined) {
          updates.push('pattern = ?')
          params.push(input.pattern)
        }
        if (input.category_id !== undefined) {
          updates.push('category_id = ?')
          params.push(input.category_id)
        }
        if (input.priority !== undefined) {
          updates.push('priority = ?')
          params.push(input.priority)
        }
        if (input.enabled !== undefined) {
          updates.push('enabled = ?')
          params.push(input.enabled ? 1 : 0)
        }
        if (!updates.length) throw new Error('no valid fields to update')

        const result = db
          .prepare(`UPDATE rules SET ${updates.join(', ')} WHERE id = ?`)
          .run(...params, input.id)
        if (result.changes === 0) throw new Error('rule not found')
        return {
          rule: mapRule(
            db
              .prepare('SELECT * FROM rules WHERE id = ?')
              .get(input.id) as RuleRow,
          )!,
        }
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => {
        const result = db
          .prepare('DELETE FROM rules WHERE id = ?')
          .run(input.id)
        if (result.changes === 0) throw new Error('rule not found')
        return { success: true }
      }),
  }),

  // ── Insights ──
  insights: router({
    summary: publicProcedure
      .input(
        z.object({
          view_mode: viewModeSchema,
          excluded_kinds: excludedKindsSchema,
          date_from: z.string().optional(),
          date_to: z.string().optional(),
        }),
      )
      .query(({ input }) => {
        const viewMode = buildFinancialFilter(
          input.view_mode,
          input.excluded_kinds,
        )
        const where: string[] = []
        const params: string[] = []

        if (!viewMode.includeInternal) where.push('t.is_internal = 0')
        if (input.date_from) {
          where.push('t.date >= ?')
          params.push(input.date_from)
        }
        if (input.date_to) {
          where.push('t.date <= ?')
          params.push(input.date_to)
        }

        const insightWhere = where.length
          ? `WHERE ${where.join(' AND ')} ${viewMode.sql}`
          : `WHERE 1=1 ${viewMode.sql}`
        const allParams = [...params, ...viewMode.params]

        const totals = db
          .prepare(
            `SELECT SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS spend, SUM(CASE WHEN amount >= 0 THEN amount ELSE 0 END) AS income FROM transactions t ${insightWhere}`,
          )
          .get(...allParams) as SummaryTotals | undefined

        const byCategory = db
          .prepare(
            `SELECT t.category_id, c.name AS category_name, SUM(t.amount) AS total, COUNT(*) AS count FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ${insightWhere} GROUP BY t.category_id ORDER BY total ASC`,
          )
          .all(...allParams) as CategoryBreakdown[]

        const topMerchants = db
          .prepare(
            `SELECT t.merchant, SUM(t.amount) AS total, COUNT(*) AS count, c.name AS category_name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ${insightWhere} GROUP BY t.merchant ORDER BY total ASC LIMIT 20`,
          )
          .all(...allParams) as TopMerchant[]

        return {
          total_spend: Math.abs(totals?.spend ?? 0),
          total_income: totals?.income ?? 0,
          by_category: byCategory,
          top_merchants: topMerchants,
        }
      }),

    categoryTransactions: publicProcedure
      .input(
        z.object({
          category_id: z.string().optional(),
          date_from: z.string().optional(),
          date_to: z.string().optional(),
          view_mode: viewModeSchema,
          excluded_kinds: excludedKindsSchema,
        }),
      )
      .query(({ input }) => {
        const where: string[] = []
        const params: string[] = []

        if (input.category_id) {
          where.push('t.category_id = ?')
          params.push(input.category_id)
        } else {
          where.push('t.category_id IS NULL')
        }
        if (input.date_from) {
          where.push('t.date >= ?')
          params.push(input.date_from)
        }
        if (input.date_to) {
          where.push('t.date <= ?')
          params.push(input.date_to)
        }

        const viewMode = buildFinancialFilter(
          input.view_mode,
          input.excluded_kinds,
        )
        const whereSql = `WHERE ${where.join(' AND ')} ${viewMode.sql}`
        const allParams = [...params, ...viewMode.params]

        const rows = db
          .prepare(
            `SELECT t.id, t.date, t.merchant, t.amount, t.currency, c.name as category_name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ${whereSql} ORDER BY t.date DESC LIMIT 500`,
          )
          .all(...allParams)

        return { items: rows }
      }),

    monthly: publicProcedure
      .input(
        z.object({
          view_mode: viewModeSchema,
          excluded_kinds: excludedKindsSchema,
          year: z.string().optional(),
        }),
      )
      .query(({ input }) => {
        const viewMode = buildFinancialFilter(
          input.view_mode,
          input.excluded_kinds,
        )
        const where: string[] = []
        const params: string[] = []

        if (!viewMode.includeInternal) where.push('t.is_internal = 0')
        if (input.year) {
          where.push('substr(t.date, 1, 4) = ?')
          params.push(input.year)
        }

        const monthlyWhere = where.length
          ? `WHERE ${where.join(' AND ')} ${viewMode.sql}`
          : `WHERE 1=1 ${viewMode.sql}`
        const allParams = [...params, ...viewMode.params]

        const months = db
          .prepare(
            `SELECT substr(t.date, 1, 7) AS month, SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS spend, SUM(CASE WHEN t.amount >= 0 THEN t.amount ELSE 0 END) AS income, COUNT(*) AS count FROM transactions t ${monthlyWhere} GROUP BY substr(t.date, 1, 7) ORDER BY month DESC`,
          )
          .all(...allParams) as MonthlyRow[]

        const categoryByMonth = db
          .prepare(
            `SELECT substr(t.date, 1, 7) AS month, t.category_id, c.name AS category_name, SUM(t.amount) AS total, COUNT(*) AS count FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ${monthlyWhere} GROUP BY substr(t.date, 1, 7), t.category_id ORDER BY month DESC, total ASC`,
          )
          .all(...allParams) as CategoryByMonthRow[]

        const catMap: Record<string, CategoryByMonthRow[]> = {}
        for (const row of categoryByMonth) {
          if (!catMap[row.month]) catMap[row.month] = []
          catMap[row.month].push(row)
        }

        const years = (
          db
            .prepare(
              `SELECT DISTINCT substr(date, 1, 4) AS year FROM transactions ORDER BY year DESC`,
            )
            .all() as { year: string }[]
        ).map((r) => r.year)

        return {
          months: months.map((m) => ({
            ...m,
            categories: catMap[m.month] || [],
          })),
          years,
        }
      }),

    categoryTrend: publicProcedure
      .input(
        z.object({
          category_id: z.string().optional(),
          date_from: z.string().optional(),
          date_to: z.string().optional(),
          granularity: z.enum(['day', 'month']).default('month'),
          view_mode: viewModeSchema,
          excluded_kinds: excludedKindsSchema,
        }),
      )
      .query(({ input }) => {
        const viewMode = buildFinancialFilter(
          input.view_mode,
          input.excluded_kinds,
        )
        const where: string[] = ['t.is_internal = 0']
        const params: string[] = []

        if (input.category_id) {
          where.push('t.category_id = ?')
          params.push(input.category_id)
        } else {
          where.push('t.category_id IS NULL')
        }
        if (input.date_from) {
          where.push('t.date >= ?')
          params.push(input.date_from)
        }
        if (input.date_to) {
          where.push('t.date <= ?')
          params.push(input.date_to)
        }

        const whereSql = `WHERE ${where.join(' AND ')} ${viewMode.sql}`
        const allParams = [...params, ...viewMode.params]
        const periodExpr =
          input.granularity === 'day' ? 't.date' : 'substr(t.date, 1, 7)'

        const rows = db
          .prepare(
            `SELECT ${periodExpr} AS period, SUM(ABS(t.amount)) AS total FROM transactions t ${whereSql} AND t.amount < 0 GROUP BY ${periodExpr} ORDER BY period ASC`,
          )
          .all(...allParams) as TrendPoint[]

        return { points: rows }
      }),
  }),

  // ── Analysis ──
  analysis: router({
    report: publicProcedure
      .input(
        z.object({
          view_mode: viewModeSchema,
        }),
      )
      .query(({ input }) => {
        return { markdown: generateAnalysisReport(undefined, input.view_mode) }
      }),

    save: publicProcedure
      .input(z.object({ notes: z.string().min(1) }))
      .mutation(({ input }) => {
        const report = generateAnalysisReport(input.notes)
        const analysisPath = path.join(dataDir, 'analysis.md')
        fs.writeFileSync(analysisPath, report, 'utf8')
        return { status: 'saved' as const, path: analysisPath }
      }),
  }),
})

export type AppRouter = typeof appRouter

// Mount tRPC alongside Express
app.use(
  '/trpc',
  trpcExpress.createExpressMiddleware({
    router: appRouter,
  }),
)

// ── Review: Suspicious Transactions ─────────────────────────────────────────
app.get('/api/review/suspicious', (req: Request, res: Response) => {
  const viewMode = buildFinancialFilter(
    (req.query.view_mode as string) || 'cashflow',
    parseExcludedKinds(req.query.excluded_kinds),
  )
  const filterFlag = (req.query.filter as string) || 'all'
  const categoryFilter = req.query.category_id as string | undefined
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const internalFilter = viewMode.includeInternal ? '' : 'AND t.is_internal = 0'

  // Base WHERE shared across all sub-queries
  const baseWhere = `WHERE 1=1 ${internalFilter} ${viewMode.sql}`
  const baseParams = [...viewMode.params]

  // 1) Amount outliers: ABS(amount) > 2 * category average
  const outlierRows = db
    .prepare(
      `SELECT t.id, t.category_id, ABS(t.amount) as abs_amt, cavg.avg_amt
       FROM transactions t
       JOIN (
         SELECT category_id, AVG(ABS(amount)) as avg_amt
         FROM transactions t ${baseWhere} AND category_id IS NOT NULL
         GROUP BY category_id
       ) cavg ON cavg.category_id = t.category_id
       ${baseWhere} AND t.category_id IS NOT NULL
       AND ABS(t.amount) > 2 * cavg.avg_amt`,
    )
    .all(...baseParams, ...baseParams) as {
    id: string
    category_id: string
    abs_amt: number
    avg_amt: number
  }[]

  const outlierMap = new Map<string, { ratio: number; category_avg: number }>()
  for (const r of outlierRows) {
    outlierMap.set(r.id, {
      ratio: Math.round((r.abs_amt / r.avg_amt) * 10) / 10,
      category_avg: Math.round(r.avg_amt),
    })
  }

  // 2) Merchant mismatch: same merchant in 2+ categories
  const mismatchRows = db
    .prepare(
      `SELECT merchant, GROUP_CONCAT(DISTINCT category_id) as cat_ids,
              COUNT(DISTINCT category_id) as cat_count
       FROM transactions t ${baseWhere}
       AND category_id IS NOT NULL
       GROUP BY merchant
       HAVING COUNT(DISTINCT category_id) > 1`,
    )
    .all(...baseParams) as {
    merchant: string
    cat_ids: string
    cat_count: number
  }[]

  const mismatchMerchants = new Map<string, string[]>()
  for (const r of mismatchRows) {
    mismatchMerchants.set(r.merchant, r.cat_ids.split(','))
  }

  // 3) Singleton category: merchant has 1 txn in this category but 3+ in another
  const singletonRows = db
    .prepare(
      `SELECT t.id, t.merchant, t.category_id, mc.main_cat_id, mc.main_count
       FROM transactions t
       JOIN (
         SELECT merchant, category_id as main_cat_id, COUNT(*) as main_count
         FROM transactions t ${baseWhere} AND category_id IS NOT NULL
         GROUP BY merchant, category_id
         HAVING COUNT(*) >= 3
       ) mc ON mc.merchant = t.merchant AND mc.main_cat_id != t.category_id
       ${baseWhere} AND t.category_id IS NOT NULL
       AND t.id IN (
         SELECT t2.id FROM transactions t2
         WHERE t2.merchant = t.merchant AND t2.category_id = t.category_id
         GROUP BY t2.merchant, t2.category_id
         HAVING COUNT(*) = 1
       )`,
    )
    .all(...baseParams, ...baseParams) as {
    id: string
    merchant: string
    category_id: string
    main_cat_id: string
    main_count: number
  }[]

  const singletonMap = new Map<
    string,
    { main_category_id: string; main_count: number }
  >()
  for (const r of singletonRows) {
    singletonMap.set(r.id, {
      main_category_id: r.main_cat_id,
      main_count: r.main_count,
    })
  }

  // Collect all flagged IDs
  const flaggedIds = new Set<string>()
  for (const id of outlierMap.keys()) flaggedIds.add(id)
  for (const r of mismatchRows) {
    // Get all transaction IDs for mismatched merchants
    const txns = db
      .prepare(`SELECT id FROM transactions t ${baseWhere} AND merchant = ?`)
      .all(...baseParams, r.merchant) as { id: string }[]
    for (const t of txns) flaggedIds.add(t.id)
  }
  for (const id of singletonMap.keys()) flaggedIds.add(id)

  if (flaggedIds.size === 0) {
    return res.json({
      items: [],
      total: 0,
      flag_counts: {
        amount_outlier: 0,
        merchant_mismatch: 0,
        singleton_category: 0,
      },
    })
  }

  // Count flags before filtering
  const outlierIds = new Set(outlierMap.keys())
  const singletonIds = new Set(singletonMap.keys())
  const mismatchIds = new Set<string>()
  for (const r of mismatchRows) {
    const txns = db
      .prepare(`SELECT id FROM transactions t ${baseWhere} AND merchant = ?`)
      .all(...baseParams, r.merchant) as { id: string }[]
    for (const t of txns) mismatchIds.add(t.id)
  }

  const flag_counts: Record<string, number> = {
    amount_outlier: outlierIds.size,
    merchant_mismatch: mismatchIds.size,
    singleton_category: singletonIds.size,
  }

  // Determine which IDs to query based on filter + category
  let targetIds = [...flaggedIds]
  if (filterFlag === 'amount_outlier') targetIds = [...outlierIds]
  else if (filterFlag === 'merchant_mismatch') targetIds = [...mismatchIds]
  else if (filterFlag === 'singleton_category') targetIds = [...singletonIds]

  if (!targetIds.length) {
    return res.json({ items: [], total: 0, flag_counts })
  }

  // Category filter
  let catWhere = ''
  const catParams: string[] = []
  if (categoryFilter) {
    catWhere = 'AND t.category_id = ?'
    catParams.push(categoryFilter)
  }

  const placeholders = targetIds.map(() => '?').join(',')
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM transactions t
         WHERE t.id IN (${placeholders}) ${catWhere}`,
      )
      .get(...targetIds, ...catParams) as CountRow
  ).count

  const rows = db
    .prepare(
      `SELECT t.*, c.name as category_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.id IN (${placeholders}) ${catWhere}
       ORDER BY t.date DESC LIMIT ? OFFSET ?`,
    )
    .all(...targetIds, ...catParams, limit, offset)
    .map((r) =>
      mapTransaction(r as TransactionWithCategory),
    ) as TransactionApiRow[]

  // Fetch tags and category name lookup
  const tagMap = fetchTagsForTransactions(rows.map((r) => r.id))
  const catNameMap = new Map<string, string>()
  const allCats = db.prepare('SELECT id, name FROM categories').all() as {
    id: string
    name: string
  }[]
  for (const c of allCats) catNameMap.set(c.id, c.name)

  const items = rows.map((r) => {
    const flags: string[] = []
    const flag_details: Record<string, unknown> = {}

    if (outlierMap.has(r.id)) {
      flags.push('amount_outlier')
      flag_details.amount_outlier = outlierMap.get(r.id)
    }
    if (mismatchMerchants.has(r.merchant)) {
      flags.push('merchant_mismatch')
      const otherCats = mismatchMerchants
        .get(r.merchant)!
        .filter((id) => id !== r.category_id)
        .map((id) => catNameMap.get(id) || id)
      flag_details.merchant_mismatch = { other_categories: otherCats }
    }
    if (singletonMap.has(r.id)) {
      flags.push('singleton_category')
      const s = singletonMap.get(r.id)!
      flag_details.singleton_category = {
        main_category: catNameMap.get(s.main_category_id) || s.main_category_id,
        main_count: s.main_count,
      }
    }

    return { ...r, tags: tagMap[r.id] || [], flags, flag_details }
  })

  res.json({ items, total, flag_counts })
})

// ── Global Search ──────────────────────────────────────────────────────────
app.get('/api/search', (req: Request, res: Response) => {
  const q = ((req.query.q as string) || '').trim()
  if (!q) {
    return res.json({ merchants: [], categories: [] })
  }

  const pattern = `%${q}%`

  // Search merchants (distinct, with category info, limited to 10)
  const merchants = db
    .prepare(
      `SELECT DISTINCT t.merchant, c.name as category_name, c.id as category_id,
              COUNT(*) as tx_count
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.merchant LIKE ? AND t.is_internal = 0
       GROUP BY t.merchant
       ORDER BY tx_count DESC
       LIMIT 10`,
    )
    .all(pattern) as {
    merchant: string
    category_name: string | null
    category_id: string | null
    tx_count: number
  }[]

  // Search categories
  const categories = db
    .prepare(
      `SELECT id, name FROM categories WHERE name LIKE ? ORDER BY name LIMIT 10`,
    )
    .all(pattern) as { id: string; name: string }[]

  res.json({ merchants, categories })
})

// ── Error handler ───────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'unexpected server error',
    },
  })
})

app.listen(port, () => {
  console.log(`API server running on http://localhost:${port}`)
})
