import { MerchantDisplay } from '@/components/app/MerchantName'
import { useState, useEffect } from 'react'
import {
  TrendingDown,
  TrendingUp,
  Wallet,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  StickyNote,
  CalendarRange,
  Search,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import {
  getInsightsSummary,
  getCategoryTrend,
  getCategoryTransactions,
  getCategories,
  updateTransaction,
} from '@/lib/api'
import type {
  InsightsSummary,
  CategoryTrendPoint,
  Transaction,
  Category,
} from '@/lib/types'
import { useViewMode } from '@/lib/view-mode'
import { CATEGORY_COLORS, CATEGORY_HEX_COLORS } from '@/lib/constants'
import { formatILS } from '@/utils/currency'
import { formatMonthLabel } from '@/utils/dates'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import CategoryChart from '@/components/app/CategoryChart'
import { DonutChart } from '@/components/app/DonutChart'

/** Fill gaps in monthly trend data with zero-value entries for a continuous chart */
function fillMissingMonths(points: CategoryTrendPoint[]): CategoryTrendPoint[] {
  if (points.length < 2) return points
  const byPeriod = new Map(points.map((p) => [p.period, p.total]))
  const sorted = [...points].sort((a, b) => a.period.localeCompare(b.period))
  const start = sorted[0].period
  const end = sorted[sorted.length - 1].period
  const filled: CategoryTrendPoint[] = []
  let [y, m] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    filled.push({ period: key, total: byPeriod.get(key) ?? 0 })
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return filled
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function SpendingBreakdown() {
  const navigate = useNavigate()
  const { mode, excludedKinds } = useViewMode()
  const [data, setData] = useState<InsightsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [trendData, setTrendData] = useState<CategoryTrendPoint[]>([])
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendAverage, setTrendAverage] = useState<number | undefined>()
  const [trendPeak, setTrendPeak] = useState<CategoryTrendPoint | null>(null)
  const [trendLowest, setTrendLowest] = useState<CategoryTrendPoint | null>(
    null,
  )
  const [categoryTxns, setCategoryTxns] = useState<Transaction[]>([])
  const [txnsLoading, setTxnsLoading] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteValue, setNoteValue] = useState('')
  const [spreadPickerOpen, setSpreadPickerOpen] = useState<string | null>(null)
  const [drilldownSearch, setDrilldownSearch] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  )

  const handleSpreadChange = async (txId: string, months: number | null) => {
    setSpreadPickerOpen(null)
    await updateTransaction(txId, { spread_months: months })
    setCategoryTxns((prev) =>
      prev.map((tx) =>
        tx.id === txId ? { ...tx, spread_months: months } : tx,
      ),
    )
  }

  useEffect(() => {
    getCategories().then((res) => setCategories(res.items))
  }, [])

  const handleCategoryChange = async (txId: string, categoryId: string) => {
    setEditingCategoryId(null)
    await updateTransaction(txId, { category_id: categoryId || null })
    setCategoryTxns((prev) =>
      prev.map((tx) =>
        tx.id === txId
          ? {
              ...tx,
              category_id: categoryId || null,
              category_name:
                categories.find((c) => c.id === categoryId)?.name ?? null,
            }
          : tx,
      ),
    )
  }

  const handleNoteSave = async (txId: string, notes: string) => {
    setEditingNoteId(null)
    await updateTransaction(txId, { notes: notes || '' })
    setCategoryTxns((prev) =>
      prev.map((tx) => (tx.id === txId ? { ...tx, notes: notes || null } : tx)),
    )
  }
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [year, setYear] = useState(() => String(new Date().getFullYear()))
  const [period, setPeriod] = useState<'all' | 'yearly' | 'monthly'>('all')

  useEffect(() => {
    setLoading(true)
    const params: Parameters<typeof getInsightsSummary>[0] = {
      view_mode: mode,
      excluded_kinds: excludedKinds,
    }
    if (period === 'monthly') {
      params.date_from = `${month}-01`
      params.date_to = `${month}-31`
    } else if (period === 'yearly') {
      params.date_from = `${year}-01-01`
      params.date_to = `${year}-12-31`
    }
    getInsightsSummary(params)
      .then(setData)
      .finally(() => setLoading(false))
  }, [month, year, period, mode, excludedKinds])

  if (loading || !data) {
    return <p className="text-gray-40 text-center py-8">Loading insights...</p>
  }

  const net = data.total_income - data.total_spend
  const maxCategorySpend = Math.max(
    ...data.by_category
      .filter((c) => c.total < 0)
      .map((c) => Math.abs(c.total)),
    1,
  )

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-3">
        {(['all', 'yearly', 'monthly'] as const).map((p) => (
          <Button
            key={p}
            variant={period === p ? 'default' : 'outline'}
            onClick={() => setPeriod(p)}
            className={
              period === p
                ? 'bg-brand text-white hover:bg-brand-dark'
                : 'bg-surface text-gray-60 hover:text-gray-100 border-gray-10'
            }
          >
            {p === 'all' ? 'All Time' : p === 'yearly' ? 'Yearly' : 'Monthly'}
          </Button>
        ))}
        {period === 'yearly' && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setYear(String(Number(year) - 1))}
              className="h-9 w-9 bg-surface border-gray-10 text-gray-60 hover:text-gray-100"
            >
              <ChevronLeft size={18} />
            </Button>
            <span className="min-w-[60px] text-center text-sm font-medium text-gray-100">
              {year}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setYear(String(Number(year) + 1))}
              className="h-9 w-9 bg-surface border-gray-10 text-gray-60 hover:text-gray-100"
            >
              <ChevronRight size={18} />
            </Button>
          </div>
        )}
        {period === 'monthly' && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonth(shiftMonth(month, -1))}
              className="h-9 w-9 bg-surface border-gray-10 text-gray-60 hover:text-gray-100"
            >
              <ChevronLeft size={18} />
            </Button>
            <span className="min-w-[140px] text-center text-sm font-medium text-gray-100">
              {formatMonthLabel(month)}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonth(shiftMonth(month, 1))}
              className="h-9 w-9 bg-surface border-gray-10 text-gray-60 hover:text-gray-100"
            >
              <ChevronRight size={18} />
            </Button>
          </div>
        )}
      </div>

      {/* Trending categories nudge */}
      {data.trending_up && data.trending_up.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <TrendingUp size={14} className="text-amber-400 shrink-0" />
          <span className="text-sm text-gray-60">
            Trending up:{' '}
            {data.trending_up.map((t, i) => (
              <span key={t.category_id}>
                {i > 0 && ', '}
                <span className="text-gray-100 font-medium">
                  {t.category_name}
                </span>
                <span className="text-amber-400 ml-1">
                  ↑{Math.round(t.change_pct)}%
                </span>
              </span>
            ))}
          </span>
        </div>
      )}
      {data.trending_down && data.trending_down.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <TrendingDown size={14} className="text-emerald-400 shrink-0" />
          <span className="text-sm text-gray-60">
            Trending down:{' '}
            {data.trending_down.map((t, i) => (
              <span key={t.category_id}>
                {i > 0 && ', '}
                <span className="text-gray-100 font-medium">
                  {t.category_name}
                </span>
                <span className="text-emerald-400 ml-1">
                  ↓{Math.round(Math.abs(t.change_pct))}%
                </span>
              </span>
            ))}
          </span>
        </div>
      )}

      {/* Hero summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-gray-10 shadow-sm">
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-2 text-negative mb-3">
              <TrendingDown size={20} />
              <span className="text-sm font-medium">Expenses</span>
            </div>
            <p className="text-2xl font-bold text-gray-100 sm:text-3xl">
              {formatILS(data.total_spend)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-10 shadow-sm">
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-2 text-positive mb-3">
              <TrendingUp size={20} />
              <span className="text-sm font-medium">Income</span>
            </div>
            <p className="text-2xl font-bold text-gray-100 sm:text-3xl">
              {formatILS(data.total_income)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-10 shadow-sm">
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-2 text-brand mb-3">
              <Wallet size={20} />
              <span className="text-sm font-medium">Net</span>
            </div>
            <p
              className={`text-2xl font-bold sm:text-3xl ${net >= 0 ? 'text-positive' : 'text-negative'}`}
            >
              {net >= 0 ? '' : '-'}
              {formatILS(Math.abs(net))}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Needs / Wants / Savings split */}
      {data.by_spending_type && (
        <Card className="border-gray-10 shadow-sm">
          <CardContent className="p-5 sm:p-6">
            <h3 className="text-sm font-medium text-gray-60 mb-3">
              Where Your Money Goes
            </h3>
            <div className="flex gap-2 h-4 rounded-full overflow-hidden mb-4">
              {/* Stacked bar */}
              <div
                className="bg-blue-500 rounded-l-full"
                style={{ width: `${data.by_spending_type.needs?.pct ?? 0}%` }}
              />
              <div
                className="bg-amber-400"
                style={{ width: `${data.by_spending_type.wants?.pct ?? 0}%` }}
              />
              <div
                className="bg-emerald-500 rounded-r-full"
                style={{ width: `${data.by_spending_type.savings?.pct ?? 0}%` }}
              />
            </div>
            <div className="flex flex-col gap-3 text-sm sm:flex-row sm:justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-gray-60">Needs</span>
                <span className="text-gray-100 font-medium">
                  {formatILS(Math.abs(data.by_spending_type.needs?.total ?? 0))}
                </span>
                <span className="text-gray-40">
                  ({data.by_spending_type.needs?.pct ?? 0}%)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span className="text-gray-60">Wants</span>
                <span className="text-gray-100 font-medium">
                  {formatILS(Math.abs(data.by_spending_type.wants?.total ?? 0))}
                </span>
                <span className="text-gray-40">
                  ({data.by_spending_type.wants?.pct ?? 0}%)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-gray-60">Savings</span>
                <span className="text-gray-100 font-medium">
                  {formatILS(
                    Math.abs(data.by_spending_type.savings?.total ?? 0),
                  )}
                </span>
                <span className="text-gray-40">
                  ({data.by_spending_type.savings?.pct ?? 0}%)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category donut chart */}
      {data.by_category.filter((c) => c.total < 0).length > 0 && (
        <Card className="border-gray-10 shadow-sm">
          <CardContent className="p-5 sm:p-6">
            <h3 className="text-sm font-medium text-gray-60 mb-3">
              Spending by Category
            </h3>
            <DonutChart
              slices={data.by_category
                .filter((c) => c.total < 0)
                .sort((a, b) => a.total - b.total)
                .map((c) => ({
                  name: c.category_name || 'Uncategorized',
                  value: Math.abs(c.total),
                }))}
              total={data.total_spend}
              selected={
                expandedCategory
                  ? (data.by_category.find(
                      (c) =>
                        (c.category_id ?? 'uncategorized') === expandedCategory,
                    )?.category_name ?? null)
                  : null
              }
              onSelect={(name) => {
                if (!name) {
                  setExpandedCategory(null)
                  return
                }
                const cat = data.by_category.find(
                  (c) => (c.category_name || 'Uncategorized') === name,
                )
                if (cat) {
                  const catKey = cat.category_id ?? 'uncategorized'
                  if (expandedCategory === catKey) {
                    setExpandedCategory(null)
                  } else {
                    setExpandedCategory(catKey)
                    setTrendLoading(true)
                    setTxnsLoading(true)
                    setCategoryTxns([])
                    setDrilldownSearch('')
                    const trendParams: Parameters<typeof getCategoryTrend>[0] =
                      {
                        category_id: cat.category_id ?? '',
                        granularity: 'month',
                        view_mode: mode,
                        excluded_kinds: excludedKinds,
                      }
                    getCategoryTrend(trendParams).then((r) => {
                      setTrendData(fillMissingMonths(r.points))
                      setTrendAverage(r.average)
                      setTrendPeak(r.peak ?? null)
                      setTrendLowest(r.lowest ?? null)
                      setTrendLoading(false)
                    })
                    getCategoryTransactions({
                      category_id: cat.category_id ?? '',
                      view_mode: mode,
                      excluded_kinds: excludedKinds,
                    }).then((r) => {
                      setCategoryTxns(r.items)
                      setTxnsLoading(false)
                    })
                  }
                }
              }}
              label="total"
            />
          </CardContent>
        </Card>
      )}

      {/* Category breakdown with progress bars */}
      <Card className="border-gray-10 shadow-sm">
        <CardContent className="p-5 sm:p-6">
          <h3 className="text-lg font-bold text-gray-100 mb-5">
            Spending by Category
          </h3>
          {data.by_category.filter((c) => c.total < 0).length === 0 ? (
            <p className="text-gray-40 text-sm">No expense data yet.</p>
          ) : (
            <div className="space-y-4">
              {data.by_category
                .filter((c) => c.total < 0)
                .sort((a, b) => a.total - b.total)
                .map((cat) => {
                  const absTotal = Math.abs(cat.total)
                  const pct =
                    data.total_spend > 0
                      ? ((absTotal / data.total_spend) * 100).toFixed(1)
                      : '0'
                  const barWidth = (absTotal / maxCategorySpend) * 100
                  const colorClass =
                    CATEGORY_COLORS[cat.category_name || ''] || 'bg-gray-40'
                  const catKey = cat.category_id ?? 'uncategorized'
                  const isExpanded = expandedCategory === catKey

                  return (
                    <div key={catKey}>
                      <div className="flex items-center gap-1 rounded-lg px-2 py-1.5 -mx-2 hover:bg-surface-alt/50 transition-colors">
                        <button
                          className="flex-1 text-left cursor-pointer"
                          onClick={async () => {
                            if (isExpanded) {
                              setExpandedCategory(null)
                              return
                            }
                            setExpandedCategory(catKey)
                            setTrendLoading(true)
                            setTxnsLoading(true)
                            setCategoryTxns([])
                            setDrilldownSearch('')

                            // Always fetch monthly trend across full time range
                            const trendParams: Parameters<
                              typeof getCategoryTrend
                            >[0] = {
                              category_id: cat.category_id ?? '',
                              granularity: 'month',
                              view_mode: mode,
                              excluded_kinds: excludedKinds,
                            }
                            // For yearly view, scope the trend to that year

                            // Fetch transactions for the selected period
                            const txParams: Parameters<
                              typeof getCategoryTransactions
                            >[0] = {
                              category_id: cat.category_id ?? '',
                              view_mode: mode,
                              excluded_kinds: excludedKinds,
                            }
                            if (period === 'monthly') {
                              txParams.date_from = `${month}-01`
                              txParams.date_to = `${month}-31`
                            } else if (period === 'yearly') {
                              txParams.date_from = `${year}-01-01`
                              txParams.date_to = `${year}-12-31`
                            }

                            try {
                              const [trendRes, txRes] = await Promise.all([
                                getCategoryTrend(trendParams),
                                getCategoryTransactions(txParams),
                              ])
                              // Fill in zero-months for continuous chart
                              const filled = fillMissingMonths(trendRes.points)
                              setTrendData(filled)
                              setTrendAverage(trendRes.average)
                              setTrendPeak(trendRes.peak ?? null)
                              setTrendLowest(trendRes.lowest ?? null)
                              setCategoryTxns(txRes.items)
                            } finally {
                              setTrendLoading(false)
                              setTxnsLoading(false)
                            }
                          }}
                        >
                          <div className="mb-1.5 flex flex-col gap-1 text-sm sm:flex-row sm:justify-between">
                            <span className="font-medium text-gray-80">
                              {cat.category_name || 'Uncategorized'}
                            </span>
                            <span className="tabular-nums text-gray-60">
                              {formatILS(absTotal)}{' '}
                              <span className="text-gray-40">({pct}%)</span>
                              {cat.vs_avg_pct != null &&
                                Math.abs(cat.vs_avg_pct) >= 5 && (
                                  <span
                                    className={`ml-1.5 text-xs font-medium ${cat.vs_avg_pct > 0 ? 'text-amber-400' : 'text-emerald-400'}`}
                                  >
                                    {cat.vs_avg_pct > 0 ? '↑' : '↓'}
                                    {Math.abs(Math.round(cat.vs_avg_pct))}%
                                  </span>
                                )}
                            </span>
                          </div>
                          <div className="h-[15px] bg-surface-alt rounded-[19px] overflow-hidden">
                            <div
                              className={`h-full rounded-[19px] transition-all duration-500 ${colorClass}`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </button>
                        <button
                          onClick={() =>
                            navigate({
                              to: '/transactions',
                              search: { category_id: cat.category_id ?? '' },
                            })
                          }
                          className="p-1.5 rounded-lg text-gray-40 hover:text-gray-80 hover:bg-surface-alt transition-colors shrink-0"
                          title="View transactions"
                        >
                          <ExternalLink size={14} />
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="ml-2 mt-1 mb-2 border-l-2 border-gray-20 pl-3">
                          {trendLoading ? (
                            <p className="text-gray-40 text-xs py-2">
                              Loading...
                            </p>
                          ) : (
                            <>
                              <CategoryChart
                                points={trendData}
                                color={
                                  CATEGORY_HEX_COLORS[
                                    cat.category_name || ''
                                  ] || '#94a3b8'
                                }
                                granularity="month"
                                average={trendAverage}
                                peak={trendPeak}
                                lowest={trendLowest}
                              />
                              {/* Transaction list */}
                              {txnsLoading ? (
                                <p className="text-gray-40 text-xs py-2">
                                  Loading transactions...
                                </p>
                              ) : categoryTxns.length > 0 ? (
                                <div className="mt-3">
                                  {/* Drilldown search filter */}
                                  {categoryTxns.length > 5 && (
                                    <div className="relative mb-2">
                                      <Search
                                        size={12}
                                        className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-30"
                                      />
                                      <input
                                        type="text"
                                        placeholder="Filter transactions..."
                                        value={drilldownSearch}
                                        onChange={(e) =>
                                          setDrilldownSearch(e.target.value)
                                        }
                                        className="w-full pl-7 pr-2 py-1.5 text-xs bg-surface-alt/50 border border-gray-10 rounded-lg text-gray-80 outline-none focus:border-brand placeholder:text-gray-30"
                                      />
                                    </div>
                                  )}
                                  <div className="max-h-64 overflow-y-auto">
                                    <table className="w-full text-xs">
                                      <tbody>
                                        {categoryTxns
                                          .sort((a, b) =>
                                            b.date.localeCompare(a.date),
                                          )
                                          .filter(
                                            (tx) =>
                                              !drilldownSearch ||
                                              tx.merchant
                                                .toLowerCase()
                                                .includes(
                                                  drilldownSearch.toLowerCase(),
                                                ) ||
                                              (tx.notes &&
                                                tx.notes
                                                  .toLowerCase()
                                                  .includes(
                                                    drilldownSearch.toLowerCase(),
                                                  )),
                                          )
                                          .slice(0, 50)
                                          .map((tx) => {
                                            const catDotColor =
                                              CATEGORY_COLORS[
                                                tx.category_name || ''
                                              ] || 'bg-gray-20'
                                            return (
                                              <tr
                                                key={tx.id}
                                                className={`border-b border-gray-10/50 hover:bg-surface-alt/30 ${
                                                  tx.needs_review
                                                    ? 'border-l-2 border-l-amber-400/70'
                                                    : ''
                                                }`}
                                              >
                                                <td className="py-1.5 pr-3 text-gray-40 tabular-nums whitespace-nowrap">
                                                  {tx.date}
                                                </td>
                                                <td
                                                  className="py-1.5 max-w-[200px]"
                                                  dir="auto"
                                                >
                                                  <div className="text-gray-80 truncate">
                                                    <MerchantDisplay
                                                      name={
                                                        tx.displayName ??
                                                        tx.merchant
                                                      }
                                                      rawMerchant={tx.merchant}
                                                    />
                                                  </div>
                                                  {/* Inline note display */}
                                                  {tx.notes && (
                                                    <div className="text-[10px] text-gray-40 truncate mt-0.5 italic">
                                                      {tx.notes}
                                                    </div>
                                                  )}
                                                </td>
                                                {/* Category dot — click to reassign */}
                                                <td className="py-1.5 px-1 relative">
                                                  {editingCategoryId ===
                                                  tx.id ? (
                                                    <select
                                                      autoFocus
                                                      value={
                                                        tx.category_id ?? ''
                                                      }
                                                      onChange={(e) =>
                                                        handleCategoryChange(
                                                          tx.id,
                                                          e.target.value,
                                                        )
                                                      }
                                                      onBlur={() =>
                                                        setEditingCategoryId(
                                                          null,
                                                        )
                                                      }
                                                      className="px-1 py-0.5 bg-surface border border-gray-10 rounded text-[10px] text-gray-100 focus:outline-none focus:border-brand"
                                                    >
                                                      <option value="">
                                                        Uncategorized
                                                      </option>
                                                      {categories.map((c) => (
                                                        <option
                                                          key={c.id}
                                                          value={c.id}
                                                        >
                                                          {c.name}
                                                        </option>
                                                      ))}
                                                    </select>
                                                  ) : (
                                                    <button
                                                      onClick={() =>
                                                        setEditingCategoryId(
                                                          tx.id,
                                                        )
                                                      }
                                                      className={`w-2.5 h-2.5 rounded-full ${catDotColor} hover:ring-2 hover:ring-brand/30 transition-all cursor-pointer`}
                                                      title={`${tx.category_name || 'Uncategorized'} — click to reassign`}
                                                    />
                                                  )}
                                                </td>
                                                {/* Note edit icon */}
                                                <td className="py-1.5 px-1 relative">
                                                  <button
                                                    className={`p-1 rounded hover:bg-surface-alt transition-colors ${tx.notes ? 'text-brand' : 'text-gray-30 hover:text-gray-50'}`}
                                                    title={
                                                      tx.notes || 'Add note'
                                                    }
                                                    onClick={() => {
                                                      if (
                                                        editingNoteId === tx.id
                                                      ) {
                                                        setEditingNoteId(null)
                                                      } else {
                                                        setEditingNoteId(tx.id)
                                                        setNoteValue(
                                                          tx.notes || '',
                                                        )
                                                      }
                                                    }}
                                                  >
                                                    <StickyNote size={13} />
                                                  </button>
                                                  {editingNoteId === tx.id && (
                                                    <div className="absolute left-0 top-full z-20 mt-1 w-56 bg-surface border border-gray-10 rounded-lg shadow-lg p-2">
                                                      <textarea
                                                        autoFocus
                                                        rows={2}
                                                        className="w-full bg-surface-alt border border-gray-10 rounded px-2 py-1.5 text-xs text-gray-80 outline-none focus:border-brand resize-none"
                                                        placeholder="Add a note..."
                                                        value={noteValue}
                                                        onChange={(e) =>
                                                          setNoteValue(
                                                            e.target.value,
                                                          )
                                                        }
                                                        onKeyDown={(e) => {
                                                          if (
                                                            e.key === 'Enter' &&
                                                            !e.shiftKey
                                                          ) {
                                                            e.preventDefault()
                                                            handleNoteSave(
                                                              tx.id,
                                                              noteValue,
                                                            )
                                                          }
                                                          if (
                                                            e.key === 'Escape'
                                                          )
                                                            setEditingNoteId(
                                                              null,
                                                            )
                                                        }}
                                                      />
                                                      <div className="flex justify-end gap-1.5 mt-1.5">
                                                        <button
                                                          className="text-xs text-gray-40 hover:text-gray-60 px-2 py-0.5"
                                                          onClick={() =>
                                                            setEditingNoteId(
                                                              null,
                                                            )
                                                          }
                                                        >
                                                          Cancel
                                                        </button>
                                                        <button
                                                          className="text-xs text-white bg-brand hover:bg-brand-dark rounded px-2.5 py-0.5"
                                                          onClick={() =>
                                                            handleNoteSave(
                                                              tx.id,
                                                              noteValue,
                                                            )
                                                          }
                                                        >
                                                          Save
                                                        </button>
                                                      </div>
                                                    </div>
                                                  )}
                                                </td>
                                                {/* Spread — show badge inline when active, icon to edit */}
                                                <td className="py-1.5 px-1 relative">
                                                  <div className="flex items-center gap-1">
                                                    {tx.spread_months && (
                                                      <span className="px-1 py-0.5 rounded bg-brand/10 text-brand text-[10px] font-medium">
                                                        {tx.spread_months}mo
                                                      </span>
                                                    )}
                                                    <button
                                                      className={`p-1 rounded hover:bg-surface-alt transition-colors ${tx.spread_months ? 'text-brand' : 'text-gray-30 hover:text-gray-50'}`}
                                                      title={
                                                        tx.spread_months
                                                          ? `Spread over ${tx.spread_months} months`
                                                          : 'Spread billing'
                                                      }
                                                      onClick={() =>
                                                        setSpreadPickerOpen(
                                                          spreadPickerOpen ===
                                                            tx.id
                                                            ? null
                                                            : tx.id,
                                                        )
                                                      }
                                                    >
                                                      <CalendarRange
                                                        size={13}
                                                      />
                                                    </button>
                                                  </div>
                                                  {spreadPickerOpen ===
                                                    tx.id && (
                                                    <div className="absolute left-0 top-full z-20 mt-1 bg-surface border border-gray-10 rounded-lg shadow-lg p-2">
                                                      <div className="flex gap-1">
                                                        {[2, 3, 6, 12].map(
                                                          (n) => (
                                                            <button
                                                              key={n}
                                                              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                                                tx.spread_months ===
                                                                n
                                                                  ? 'bg-brand text-white'
                                                                  : 'bg-surface-alt text-gray-60 hover:text-gray-100'
                                                              }`}
                                                              onClick={() =>
                                                                handleSpreadChange(
                                                                  tx.id,
                                                                  n,
                                                                )
                                                              }
                                                            >
                                                              {n}mo
                                                            </button>
                                                          ),
                                                        )}
                                                        {tx.spread_months && (
                                                          <button
                                                            className="px-2 py-1 rounded text-xs font-medium bg-surface-alt text-gray-40 hover:text-negative transition-colors"
                                                            onClick={() =>
                                                              handleSpreadChange(
                                                                tx.id,
                                                                null,
                                                              )
                                                            }
                                                          >
                                                            Clear
                                                          </button>
                                                        )}
                                                      </div>
                                                    </div>
                                                  )}
                                                </td>
                                                <td className="py-1.5 pl-3 text-right text-negative font-mono tabular-nums whitespace-nowrap">
                                                  {formatILS(
                                                    Math.abs(tx.amount),
                                                  )}
                                                </td>
                                              </tr>
                                            )
                                          })}
                                      </tbody>
                                    </table>
                                    {categoryTxns.length > 50 && (
                                      <p className="text-gray-40 text-xs py-1 text-center">
                                        Showing 50 of {categoryTxns.length}{' '}
                                        transactions
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top merchants */}
      <Card className="border-gray-10 shadow-sm">
        <CardContent className="p-6">
          <h3 className="text-lg font-bold text-gray-100 mb-4">
            Top Merchants
          </h3>
          {data.top_merchants.filter((m) => m.total < 0).length === 0 ? (
            <p className="text-gray-40 text-sm">No expense data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-10">
                    <TableHead className="text-gray-40 text-xs uppercase tracking-wider">
                      Merchant
                    </TableHead>
                    <TableHead className="text-gray-40 text-xs uppercase tracking-wider text-right">
                      Total
                    </TableHead>
                    <TableHead className="text-gray-40 text-xs uppercase tracking-wider text-right">
                      Count
                    </TableHead>
                    <TableHead className="text-gray-40 text-xs uppercase tracking-wider pl-4">
                      Category
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.top_merchants
                    .filter((m) => m.total < 0)
                    .slice(0, 15)
                    .map((m, i) => (
                      <TableRow
                        key={i}
                        className="border-gray-10 hover:bg-surface-alt transition-colors"
                      >
                        <TableCell
                          className="text-gray-100 font-medium"
                          dir="auto"
                        >
                          <MerchantDisplay
                            name={m.displayName ?? m.merchant}
                            rawMerchant={m.merchant}
                          />
                        </TableCell>
                        <TableCell className="text-right text-negative font-mono tabular-nums">
                          {formatILS(Math.abs(m.total))}
                        </TableCell>
                        <TableCell className="text-right text-gray-60">
                          {m.count}
                        </TableCell>
                        <TableCell className="pl-4">
                          {m.category_name ? (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-surface-alt text-gray-80">
                              {m.category_name}
                            </span>
                          ) : (
                            <span className="text-gray-40 text-xs">
                              Uncategorized
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
