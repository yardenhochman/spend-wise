import { err, okAsync, ResultAsync } from 'neverthrow'
import type {
  BriefResponse,
  CommitmentsResponse,
  HomeData,
  ProjectsResponse,
  RunwayResponse,
  ActionCardDefinition,
  Transaction,
  Category,
  Tag,
  TagSummary,
  ImportResult,
  InvestmentsSummary,
  InsightsSummary,
  PaginatedResponse,
  ViewExclusion,
  ViewMode,
  CategoryTrendResponse,
  ReviewResponse,
  RecurringMerchant,
  RecurringTrendsResponse,
  CashAllocation,
  SearchResult,
} from './types'

import { createHomeFixtures } from './home-fixtures'

const BASE = '/api'

function setSearchParams(
  searchParams: URLSearchParams,
  params: Record<string, unknown>,
) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue
    if (Array.isArray(v)) {
      if (v.length > 0) searchParams.set(k, v.join(','))
    } else {
      searchParams.set(k, String(v))
    }
  }
}

// ── Error types ─────────────────────────────────────────────────────────────
export type ApiError =
  | { type: 'network'; message: string }
  | { type: 'http'; status: number; message: string }
  | { type: 'parse'; message: string }

function toApiError(e: unknown): ApiError {
  if (e instanceof TypeError) return { type: 'network', message: e.message }
  if (e instanceof Error) return { type: 'network', message: e.message }
  return { type: 'network', message: String(e) }
}

// ── Safe fetch returning Result ─────────────────────────────────────────────
export function safeFetchJson<T>(
  url: string,
  init?: RequestInit,
): ResultAsync<T, ApiError> {
  return ResultAsync.fromPromise(
    fetch(`${BASE}${url}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    }),
    toApiError,
  ).andThen((res) => {
    if (!res.ok) {
      return ResultAsync.fromPromise(
        res.json().catch(() => ({})),
        toApiError,
      ).andThen((body) =>
        err({
          type: 'http' as const,
          status: res.status,
          message: (body as Record<string, unknown>)?.error
            ? String(
                (
                  (body as Record<string, unknown>).error as Record<
                    string,
                    unknown
                  >
                )?.message ?? `HTTP ${res.status}`,
              )
            : `HTTP ${res.status}`,
        }),
      )
    }
    if (res.status === 204) return okAsync(undefined as T)
    return ResultAsync.fromPromise(res.json() as Promise<T>, () => ({
      type: 'parse' as const,
      message: 'Failed to parse JSON response',
    }))
  })
}

// ── Legacy throwing fetch (used by existing code) ───────────────────────────
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function importFile(
  file: File,
  parserId = 'auto',
): Promise<ImportResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('parser_id', parserId)

  const res = await fetch(`${BASE}/import`, { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function getInvestmentsSummary(
  viewMode?: ViewMode,
): Promise<InvestmentsSummary> {
  const searchParams = new URLSearchParams()
  if (viewMode) searchParams.set('view_mode', viewMode)
  return fetchJson(`/investments/summary?${searchParams}`)
}

export async function getTransactions(params: {
  tag_id?: string
  limit?: number
  offset?: number
  sort?: string
  order?: string
  category_id?: string
  q?: string
  date_from?: string
  date_to?: string
  exclude_internal?: string
  view_mode?: ViewMode
  excluded_kinds?: ViewExclusion[]
}): Promise<PaginatedResponse<Transaction>> {
  const searchParams = new URLSearchParams()
  setSearchParams(searchParams, params)
  return fetchJson(`/transactions?${searchParams}`)
}

export async function updateTransaction(
  id: string,
  data: {
    category_id?: string | null
    notes?: string
    is_recurring_candidate?: boolean
    is_internal?: boolean
    spread_months?: number | null
  },
): Promise<{ transaction: Transaction }> {
  return fetchJson(`/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function getCategories(): Promise<{ items: Category[] }> {
  return fetchJson('/categories')
}

export async function getInsightsSummary(params?: {
  date_from?: string
  date_to?: string
  view_mode?: ViewMode
  excluded_kinds?: ViewExclusion[]
}): Promise<InsightsSummary> {
  const searchParams = new URLSearchParams()
  if (params) setSearchParams(searchParams, params)
  return fetchJson(`/insights/summary?${searchParams}`)
}

export async function getCategoryTransactions(params: {
  category_id?: string
  date_from?: string
  date_to?: string
  view_mode?: ViewMode
  excluded_kinds?: ViewExclusion[]
}): Promise<{ items: Transaction[] }> {
  const searchParams = new URLSearchParams()
  setSearchParams(searchParams, params)
  return fetchJson(`/insights/category-transactions?${searchParams}`)
}

export async function getMonthlyInsights(params?: {
  year?: string
  view_mode?: ViewMode
  excluded_kinds?: ViewExclusion[]
}): Promise<import('./types').MonthlyInsights> {
  const searchParams = new URLSearchParams()
  if (params) setSearchParams(searchParams, params)
  return fetchJson(`/insights/monthly?${searchParams}`)
}

export async function getActionCards(): Promise<{
  items: ActionCardDefinition[]
}> {
  return fetchJson('/actions/cards')
}

export async function getAnalysisReport(params?: {
  view_mode?: ViewMode
}): Promise<string> {
  const searchParams = new URLSearchParams()
  if (params?.view_mode) searchParams.set('view_mode', params.view_mode)
  const res = await fetch(`${BASE}/analysis/report?${searchParams}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export async function saveAnalysisNotes(
  notes: string,
): Promise<{ status: string }> {
  return fetchJson('/analysis/save', {
    method: 'POST',
    body: JSON.stringify({ notes }),
  })
}

// ── Tags ──────────────────────────────────────────────────────────────────────
export async function getTags(): Promise<{ items: Tag[] }> {
  return fetchJson('/tags')
}

export async function createTag(
  name: string,
  color?: string,
): Promise<{ tag: Tag }> {
  return fetchJson('/tags', {
    method: 'POST',
    body: JSON.stringify({ name, color }),
  })
}

export async function deleteTag(id: string): Promise<void> {
  await fetch(`${BASE}/tags/${id}`, { method: 'DELETE' })
}

export async function addTagToTransaction(
  txId: string,
  tagId: string,
): Promise<void> {
  await fetchJson(`/transactions/${txId}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tag_id: tagId }),
  })
}

export async function removeTagFromTransaction(
  txId: string,
  tagId: string,
): Promise<void> {
  await fetch(`${BASE}/transactions/${txId}/tags/${tagId}`, {
    method: 'DELETE',
  })
}

// ── Review / Suspicious Transactions ─────────────────────────────────────────
export async function getReviewTransactions(params: {
  view_mode?: ViewMode
  excluded_kinds?: ViewExclusion[]
  filter?: string
  category_id?: string
  limit?: number
  offset?: number
}): Promise<ReviewResponse> {
  const searchParams = new URLSearchParams()
  setSearchParams(searchParams, params)
  return fetchJson(`/review/suspicious?${searchParams}`)
}

// ── Category Trend ────────────────────────────────────────────────────────────
export async function getCategoryTrend(params: {
  category_id?: string
  date_from?: string
  date_to?: string
  granularity?: 'month' | 'day'
  view_mode?: ViewMode
  excluded_kinds?: ViewExclusion[]
}): Promise<CategoryTrendResponse> {
  const searchParams = new URLSearchParams()
  setSearchParams(searchParams, params)
  return fetchJson(`/insights/category-trend?${searchParams}`)
}

// ── Recurring Merchants ──────────────────────────────────────────────────────
export async function getRecurringMerchants(params?: {
  view_mode?: ViewMode
  excluded_kinds?: ViewExclusion[]
}): Promise<{
  items: RecurringMerchant[]
}> {
  const searchParams = new URLSearchParams()
  if (params) setSearchParams(searchParams, params)
  const qs = searchParams.toString()
  return fetchJson(`/recurring${qs ? `?${qs}` : ''}`)
}

// ── Cash Allocations ─────────────────────────────────────────────────────────
export async function getCashAllocations(): Promise<{
  items: CashAllocation[]
}> {
  return fetchJson('/cash-allocations')
}

export async function createCashAllocation(
  data: Omit<CashAllocation, 'id' | 'created_at'>,
): Promise<{ allocation: CashAllocation }> {
  return fetchJson('/cash-allocations', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateCashAllocation(
  id: string,
  data: Partial<Omit<CashAllocation, 'id' | 'created_at'>>,
): Promise<{ allocation: CashAllocation }> {
  return fetchJson(`/cash-allocations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteCashAllocation(id: string): Promise<void> {
  await fetch(`${BASE}/cash-allocations/${id}`, { method: 'DELETE' })
}

// ── Recurring Trends & Actions ─────────────────────────────────────────────
export async function getRecurringTrends(): Promise<RecurringTrendsResponse> {
  return fetchJson('/recurring/trends')
}

export async function dismissRecurring(
  merchant: string,
): Promise<{ status: string }> {
  return fetchJson('/recurring/dismiss', {
    method: 'POST',
    body: JSON.stringify({ merchant }),
  })
}

export async function bulkUpdateRecurringCategory(
  merchant: string,
  category_id: string,
): Promise<{ status: string }> {
  return fetchJson('/recurring/bulk-category', {
    method: 'POST',
    body: JSON.stringify({ merchant, category_id }),
  })
}

// ── Global Search ──────────────────────────────────────────────────────────
export function globalSearch(q: string): ResultAsync<SearchResult, ApiError> {
  return safeFetchJson<SearchResult>(`/search?q=${encodeURIComponent(q)}`)
}

export function getTagSummaries(params: {
  view_mode: ViewMode
  excluded_kinds: ViewExclusion[]
}) {
  const query = new URLSearchParams()
  setSearchParams(query, params)
  return safeFetchJson<{ items: TagSummary[] }>(`/tag-summaries?${query}`)
}

// Fixtures are opt-in, or a per-endpoint 404 fallback, exclusively in dev.
// Network, parse, and non-404 errors always remain errors.
function getHome<T>(
  url: string,
  fixture: () => T,
): ResultAsync<HomeData<T>, ApiError> {
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('fixtures') === '1'
  ) {
    return okAsync({ data: fixture(), source: 'fixtures' })
  }
  return safeFetchJson<T>(url)
    .map((data): HomeData<T> => ({ data, source: 'api' }))
    .orElse((error) =>
      import.meta.env.DEV && error.type === 'http' && error.status === 404
        ? okAsync<HomeData<T>, ApiError>({
            data: fixture(),
            source: 'fixtures',
          })
        : err(error),
    )
}

export function getHomeRunway() {
  return getHome<RunwayResponse>(
    '/home/runway?days=56',
    () => createHomeFixtures().runway,
  )
}

export function getHomeCommitments() {
  return getHome<CommitmentsResponse>(
    '/home/commitments?months=6',
    () => createHomeFixtures().commitments,
  )
}

export function getHomeBrief() {
  return getHome<BriefResponse>('/home/brief', () => createHomeFixtures().brief)
}

export function getHomeProjects() {
  return getHome<ProjectsResponse>(
    '/home/projects',
    () => createHomeFixtures().projects,
  )
}

export function confirmHomeObligation(id: string, preview: boolean) {
  // Synthetic confirmations stay in the preview; never write fake IDs to the API.
  if (import.meta.env.DEV && preview)
    return okAsync<unknown, ApiError>({ confirmed: true })
  return safeFetchJson<unknown>(`/obligations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ confirmed: true }),
  })
}

export function dismissHomeObligation(id: string, preview: boolean) {
  if (import.meta.env.DEV && preview)
    return okAsync<unknown, ApiError>(undefined)
  return safeFetchJson<unknown>(`/obligations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function saveMerchantLabel(
  rawMerchant: string,
  label: string,
  preview = false,
) {
  if (import.meta.env.DEV && preview) return okAsync<unknown, ApiError>({})
  return safeFetchJson<unknown>('/merchant-labels', {
    method: 'PUT',
    body: JSON.stringify({ rawMerchant, label }),
  })
}
export function clearMerchantLabel(rawMerchant: string, preview = false) {
  if (import.meta.env.DEV && preview) return okAsync<unknown, ApiError>({})
  return safeFetchJson<unknown>('/merchant-labels', {
    method: 'DELETE',
    body: JSON.stringify({ rawMerchant }),
  })
}
export function renameObligation(id: string, name: string, preview = false) {
  if (import.meta.env.DEV && preview) return okAsync<unknown, ApiError>({})
  return safeFetchJson<unknown>(`/obligations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ name, confirmed: true }),
  })
}

export function markObligationMonth(
  id: string,
  month: string,
  status: 'paid' | 'clear',
  note?: string,
  preview = false,
) {
  if (preview)
    return ResultAsync.fromSafePromise(Promise.resolve({ month, status, note }))
  return safeFetchJson<unknown>(
    `/obligations/${encodeURIComponent(id)}/months/${encodeURIComponent(month)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, note }),
    },
  )
}
