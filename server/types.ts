// ── Shared TypeScript types for the SpendWise server ─────────────────────────

/** Database row types (as returned by better-sqlite3) */

export interface TransactionRow {
  id: string
  date: string
  merchant: string
  amount: number
  currency: string
  account_id: string
  category_id: string | null
  confidence: number
  is_recurring_candidate: number // SQLite boolean (0/1)
  is_internal: number // SQLite boolean (0/1)
  notes: string | null
  source_file_id: string
  raw_hash: string
  spread_months: number | null
}

export interface TransactionWithCategory extends TransactionRow {
  category_name: string | null
}

/** Transaction as returned by the API (booleans instead of 0/1) */
export interface TransactionApiRow extends Omit<
  TransactionRow,
  'is_recurring_candidate' | 'is_internal'
> {
  is_recurring_candidate: boolean
  is_internal: boolean
  category_name?: string | null
  tags?: TagRow[]
}

export interface CategoryRow {
  id: string
  name: string
  parent_id: string | null
  spending_type: string | null
  category_group: string | null
}

export interface TagRow {
  id: string
  name: string
  color: string | null
  icon: string | null
}

export interface TransactionTagRow {
  transaction_id: string
  tag_id: string
}

export interface AccountRow {
  id: string
  bank_name: string
  account_label: string
  currency: string
}

export interface StatementFileRow {
  id: string
  filename: string
  type: string
  imported_at: string
  parser_id: string
  status: string
}

export interface InvestmentReportRow {
  id: string
  statement_file_id: string
  account_number: string
  account_name: string | null
  base_currency: string
  from_date: string | null
  to_date: string | null
  report_date: string
  period: string | null
  portfolio_value_base: number
  unrealized_pnl_base: number
  imported_at: string
}

export interface InvestmentPositionRow {
  id: string
  report_id: string
  symbol: string
  description: string
  asset_category: string | null
  sub_category: string | null
  listing_exchange: string | null
  currency: string
  fx_rate_to_base: number
  quantity: number
  market_price: number
  market_value: number
  market_value_base: number
  cost_basis: number
  cost_basis_base: number
  avg_open_price: number
  unrealized_pnl: number
  unrealized_pnl_base: number
  portfolio_weight: number
  side: string | null
  isin: string | null
}

export interface RuleRow {
  id: string
  match_type: string
  pattern: string
  category_id: string
  priority: number
  enabled: number // SQLite boolean (0/1)
  created_at: string
}

export interface RuleApiRow extends Omit<RuleRow, 'enabled'> {
  enabled: boolean
}

/** View mode filter result */
export interface ViewModeFilter {
  sql: string
  params: (string | null)[]
  includeInternal: boolean
}

/** Parser result from PDF/HTML/HAR parsing */
export interface ParseResult {
  transactions: ParsedTransaction[]
  unparsed: string[]
}

export interface ParsedTransaction {
  date: string
  merchant: string
  amount: number
  currency: string
  raw_hash: string
  ref?: string
}

/** PDF parse result with parser ID */
export interface PdfParseResult {
  parserId: string
  transactions: ParsedTransaction[]
  unparsed: string[]
  rawText: string
}

export interface ParsedInvestmentPosition {
  symbol: string
  description: string
  asset_category: string | null
  sub_category: string | null
  listing_exchange: string | null
  currency: string
  fx_rate_to_base: number
  quantity: number
  market_price: number
  market_value: number
  market_value_base: number
  cost_basis: number
  cost_basis_base: number
  avg_open_price: number
  unrealized_pnl: number
  unrealized_pnl_base: number
  portfolio_weight: number
  side: string | null
  isin: string | null
}

export interface InvestmentFlexParseResult {
  parserId: 'ibkr-flex'
  account_number: string
  account_name: string | null
  base_currency: string
  from_date: string
  to_date: string
  report_date: string
  period: string | null
  portfolio_value_base: number
  unrealized_pnl_base: number
  positions: ParsedInvestmentPosition[]
  unparsed: string[]
}

/** Leumi bank intermediate parse result (before sign determination) */
export interface LeumiBlockResult {
  date: string
  merchant: string
  rawAmount: number
  balance: number
  ref: string
  amount: number
}

/** Fuzzy index type: date string -> array of transactions */
export type FuzzyIndex = Map<string, FuzzyIndexEntry[]>

export interface FuzzyIndexEntry {
  date: string
  amount: number
  merchant: string
  raw_hash: string
  _fuzzyDate?: boolean
}

/** Insights types */
export interface SummaryTotals {
  spend: number | null
  income: number | null
}

export interface CategoryBreakdown {
  category_id: string | null
  category_name: string | null
  total: number
  count: number
  spending_type?: string | null
  category_group?: string | null
}

export interface CategoryAvgMonthly {
  category_id: string | null
  avg_monthly: number
}

export interface SpendingTypeTotal {
  spending_type: string | null
  total: number
}

export interface TrendingCategory {
  category_id: string
  category_name: string
  recent_avg: number
  prior_avg: number
  change_pct: number
}

export interface TopMerchant {
  merchant: string
  total: number
  count: number
  category_name: string | null
}

export interface MonthlyRow {
  month: string
  spend: number | null
  income: number | null
  count: number
}

export interface CategoryByMonthRow {
  month: string
  category_id: string | null
  category_name: string | null
  total: number
  count: number
}

export interface TrendPoint {
  period: string
  total: number
}

export interface RecurringCandidate {
  merchant: string
  months: number
  avg_amount: number
  count: number
}

export interface DateRange {
  min_date: string | null
  max_date: string | null
}

export interface CountRow {
  count: number
}

export interface InvestmentHistoryPointRow {
  report_date: string
  portfolio_value_base: number
  unrealized_pnl_base: number
  accounts_count: number
}

export interface InvestmentPerformancePointRow {
  date: string
  asset_value: number
  cost_basis: number
  net_gain: number
  saved_rent: number
  total_benefit: number
}

export interface InvestmentBreakdownRow {
  label: string
  amount: number
  detail?: string
}

export interface HomeInvestmentSnapshotRow {
  latest_date: string
  occupancy_date: string | null
  estimated_home_value: number
  purchase_basis: number
  net_cash_invested: number
  saved_rent: number
  net_gain: number
  monthly_rent_estimate: number
  annual_rent_yield: number
  hard_costs: number
  financing_cash_paid: number
}

export interface MerchantAliasRow {
  id: string
  raw_pattern: string
  canonical_name: string
  match_type: string
}

export interface RecurringMerchant {
  merchant: string
  category_name: string | null
  category_id: string | null
  avg_amount: number
  recent_avg_amount: number
  months_active: number
  last_seen: string
  first_seen: string
  is_active: boolean
  tx_count: number
}

export interface CashAllocationRow {
  id: string
  description: string
  amount: number
  frequency: string
  category_id: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
}
