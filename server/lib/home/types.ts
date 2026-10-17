import type { LeumiMortgageSnapshot } from '../leumi-mortgage-import.js'
export type Kind =
  | 'mortgage'
  | 'tuition'
  | 'tax'
  | 'hoa'
  | 'loan'
  | 'utility'
  | 'other'
export type Cadence = 'monthly' | 'bimonthly' | 'yearly' | 'irregular'
export type TrailStatus = 'paid' | 'due' | 'late' | 'unconfirmed' | 'none'
export interface HomeTransaction {
  id: string
  date: string
  merchant: string
  display_name?: string
  amount: number
  notes: string | null
  account_id: string
  account_label: string
  bank_name: string
  category_name: string | null
  is_internal: number
  is_recurring_candidate: number
}
export interface Obligation {
  userNamed?: boolean
  rawMerchant?: string
  id: string
  name: string
  kind: Kind
  expectedAmount: number | null
  cadence: Cadence
  dueDay: number
  matchPattern: string
  confirmed: boolean
  anchorMonth: string
  tolerance: number
  paymentIds?: string[]
}
export interface Event {
  rawMerchant?: string
  date: string
  label: string
  amount: number
  kind: 'salary' | 'mortgage' | 'card' | 'obligation' | 'other'
  estimated: boolean
}
export interface Balance {
  account_key: string
  label: string
  balance: number
  currency: string
  as_of: string
  source: string
}
export interface RunwayResponse {
  asOf: string
  openingBalance: number | null
  balanceAsOf: string | null
  accounts: { label: string; balance: number; asOf: string }[]
  days: { date: string; balance: number }[]
  events: Event[]
  low: { date: string; balance: number } | null
  nextSalary: { date: string; amount: number } | null
  warnings: string[]
}
export interface Commitment extends Pick<
  Obligation,
  'id' | 'name' | 'kind' | 'expectedAmount' | 'cadence' | 'confirmed'
> {
  rawMerchant?: string
  trail: { month: string; status: TrailStatus; amount: number | null }[]
  note: string | null
}
export interface RecurringItem {
  rawMerchant?: string
  merchant: string
  amount: number
  cadence: 'monthly' | 'yearly' | 'other'
  annualized: number
  lastSeen: string
  flag: 'new' | 'price-up' | 'price-down' | 'renewal-soon' | null
  flagDetail: string | null
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
export type MortgageSnapshot = LeumiMortgageSnapshot
