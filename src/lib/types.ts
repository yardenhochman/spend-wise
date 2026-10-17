export type ViewMode = 'cashflow' | 'routine' | 'home' | 'wedding'
export type ViewExclusion = 'wedding' | 'loans' | 'mortgage' | 'home'

export interface Tag {
  id: string
  name: string
  color: string | null
  icon: string | null
}

export interface TagSummary extends Tag {
  start_date: string | null
  end_date: string | null
  review_note: string | null
  gross: number
  refunds: number
  net: number
  count: number
  estimated_count: number
  subtags: { id: string; name: string; amount: number }[]
  days: number | null
  per_day: number | null
  categories: { name: string; amount: number }[]
}

export interface Transaction {
  original_amount?: number
  original_currency?: string
  valuation_status?: 'actual' | 'estimated' | 'allocated'
  valuation_note?: string

  id: string
  date: string
  merchant: string
  amount: number
  currency: string
  account_id: string
  category_id: string | null
  category_name?: string | null
  confidence: number
  is_recurring_candidate: boolean
  is_internal: boolean
  notes: string | null
  source_file_id: string
  raw_hash: string
  spread_months: number | null
  needs_review?: boolean
  tags?: Tag[]
}

export interface Category {
  id: string
  name: string
  parent_id: string | null
}

export interface ImportResult {
  import_id: string
  status: string
  parser_used: string
  parsed_count: number
  inserted_count: number
  deduped_count: number
  replaced_count?: number
  unparsed_count: number
  errors: string[]
}

export interface InvestmentSnapshot {
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
  accounts_count: number
  positions_count: number
}

export interface InvestmentHolding {
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

export interface InvestmentHistoryPoint {
  report_date: string
  portfolio_value_base: number
  unrealized_pnl_base: number
  accounts_count: number
}

export interface InvestmentPerformancePoint {
  date: string
  asset_value: number
  cost_basis: number
  net_gain: number
  saved_rent: number
  total_benefit: number
}

export interface InvestmentBreakdownItem {
  label: string
  amount: number
  detail?: string
}

export interface BrokerageInvestmentsSummary {
  kind: 'brokerage'
  latest: InvestmentSnapshot | null
  holdings: InvestmentHolding[]
  history: InvestmentHistoryPoint[]
  performance: InvestmentPerformancePoint[]
  breakdown: InvestmentBreakdownItem[]
}

export interface HomeInvestmentSnapshot {
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

export interface HomeInvestmentsSummary {
  kind: 'home'
  latest: HomeInvestmentSnapshot
  holdings: []
  history: InvestmentPerformancePoint[]
  breakdown: InvestmentBreakdownItem[]
}

export type InvestmentsSummary =
  | BrokerageInvestmentsSummary
  | HomeInvestmentsSummary

export interface TrendingCategory {
  category_name: string
  category_id: string
  recent_avg: number
  prior_avg: number
  change_pct: number
}

export interface InsightsSummary {
  total_spend: number
  total_income: number
  by_category: CategoryBreakdown[]
  top_merchants: MerchantBreakdown[]
  by_spending_type?: Record<string, { total: number; pct: number }>
  trending_up?: TrendingCategory[]
  trending_down?: TrendingCategory[]
}

export interface CategoryBreakdown {
  category_id: string | null
  category_name: string | null
  total: number
  count: number
  avg_monthly?: number
  vs_avg_pct?: number | null
  spending_type?: string | null
  category_group?: string | null
}

export interface MerchantBreakdown {
  merchant: string
  total: number
  count: number
  category_name: string | null
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
}

export interface MonthlyData {
  month: string
  spend: number
  income: number
  count: number
  categories: CategoryBreakdown[]
}

export interface MonthlyInsights {
  months: MonthlyData[]
  years: string[]
}

export type ActionCardBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'note'; text: string }

export interface ActionCardDefinition {
  id: string
  title: string
  icon: string
  icon_color: string
  blocks: ActionCardBlock[]
}

export interface CategoryTrendPoint {
  period: string
  total: number
}

export interface CategoryTrendResponse {
  points: CategoryTrendPoint[]
  average?: number
  peak?: CategoryTrendPoint | null
  lowest?: CategoryTrendPoint | null
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

export interface CashAllocation {
  id: string
  description: string
  amount: number
  frequency: string
  category_id: string | null
  category_name?: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
}

// ── Recurring Trends ─────────────────────────────────────────────────────────
export interface RecurringTrendsResponse {
  trends: Record<string, { period: string; total: number }[]>
}

// ── Global Search ───────────────────────────────────────────────────────────
export interface SearchMerchantHit {
  merchant: string
  category_name: string | null
  category_id: string | null
  tx_count: number
}

export interface SearchCategoryHit {
  id: string
  name: string
}

export interface SearchResult {
  merchants: SearchMerchantHit[]
  categories: SearchCategoryHit[]
}

// ── Review / Suspicious Transactions ─────────────────────────────────────────
export interface SuspiciousTransaction extends Transaction {
  flags: string[]
  flag_details: Record<string, unknown>
}

export interface ReviewResponse {
  items: SuspiciousTransaction[]
  total: number
  flag_counts: Record<string, number>
}

// Household home API contract v1. Amounts are ILS; dates are ISO dates.
export type HomeMode = 'runway' | 'commitments' | 'brief'

export interface RunwayResponse {
  asOf: string
  openingBalance: number | null
  balanceAsOf: string | null
  accounts: { label: string; balance: number; asOf: string }[]
  days: { date: string; balance: number }[]
  events: {
    date: string
    label: string
    amount: number
    kind: 'salary' | 'mortgage' | 'card' | 'obligation' | 'other'
    estimated: boolean
  }[]
  low: { date: string; balance: number } | null
  nextSalary: { date: string; amount: number } | null
  warnings: string[]
}

export type TrailStatus = 'paid' | 'due' | 'late' | 'unconfirmed' | 'none'

export interface CommitmentsResponse {
  months: string[]
  obligations: {
    id: string
    name: string
    kind: 'mortgage' | 'tuition' | 'tax' | 'hoa' | 'loan' | 'utility' | 'other'
    expectedAmount: number | null
    cadence: 'monthly' | 'bimonthly' | 'yearly' | 'irregular'
    trail: { month: string; status: TrailStatus; amount: number | null }[]
    note: string | null
    confirmed: boolean
  }[]
  repayments: {
    id: string
    name: string
    remaining: number
    original: number | null
    monthly: number | null
    endDate: string | null
    source: 'mortgage' | 'manual'
  }[]
  recurring: {
    annualTotal: number
    items: {
      merchant: string
      amount: number
      cadence: 'monthly' | 'yearly' | 'other'
      annualized: number
      lastSeen: string
      flag: 'new' | 'price-up' | 'price-down' | 'renewal-soon' | null
      flagDetail: string | null
    }[]
  }
}

export interface BriefResponse {
  weekOf: string
  headline: string
  notices: {
    id: string
    severity: 'action' | 'watch' | 'info'
    title: string
    body: string
    chart: { points: number[] } | null
    evidenceTransactionIds: number[]
    agentPrompt: string
  }[]
  coverage: { uncategorizedShare: number; lastImportAt: string | null }
}

export interface ProjectsResponse {
  projects: {
    tag: string
    label: string
    net: number
    status: 'open' | 'ended'
    lastActivity: string | null
  }[]
}

// Local transport metadata; not part of the server response.
export interface HomeData<T> {
  data: T
  source: 'api' | 'fixtures'
}
