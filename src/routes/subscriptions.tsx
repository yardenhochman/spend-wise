import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Repeat,
  Clock,
  Ban,
  DollarSign,
  ChevronDown,
  ChevronRight,
  Banknote,
  TrendingUp,
  MoreHorizontal,
  ExternalLink,
  Tag,
  Trash2,
  Target,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  getRecurringMerchants,
  getCashAllocations,
  getRecurringTrends,
  getCategories,
  dismissRecurring,
  bulkUpdateRecurringCategory,
} from '@/lib/api'
import { formatILS } from '@/utils/currency'
import { CATEGORY_HEX_COLORS } from '@/lib/constants'
import { useViewMode } from '@/lib/view-mode'
import { DonutChart } from '@/components/app/DonutChart'
import { Sparkline } from '@/components/app/Sparkline'
import type {
  RecurringMerchant,
  CashAllocation,
  RecurringTrendsResponse,
  Category,
} from '@/lib/types'

export const Route = createFileRoute('/subscriptions')({
  component: SubscriptionsPage,
})

function monthlyAmount(allocation: CashAllocation): number {
  const abs = Math.abs(allocation.amount)
  switch (allocation.frequency) {
    case 'weekly':
      return abs * (52 / 12)
    case 'biweekly':
      return abs * (26 / 12)
    case 'monthly':
    default:
      return abs
  }
}

function formatDate(d: string): string {
  const date = new Date(d)
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

const EXPECTED_AMOUNTS_KEY = 'spendwise-expected-amounts'

function loadExpectedAmounts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(EXPECTED_AMOUNTS_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveExpectedAmounts(amounts: Record<string, number>) {
  localStorage.setItem(EXPECTED_AMOUNTS_KEY, JSON.stringify(amounts))
}

interface CategoryGroup {
  category_name: string
  category_id: string | null
  items: RecurringMerchant[]
  subtotal: number
}

// ── Action Menu ──────────────────────────────────────────────────────────────

function ActionMenu({
  item,
  categories,
  expectedAmounts,
  onDismiss,
  onCategoryChange,
  onSetExpected,
}: {
  item: RecurringMerchant
  categories: Category[]
  expectedAmounts: Record<string, number>
  onDismiss: (merchant: string) => void
  onCategoryChange: (merchant: string, categoryId: string) => void
  onSetExpected: (merchant: string, amount: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [showCategorySelect, setShowCategorySelect] = useState(false)
  const [showExpectedInput, setShowExpectedInput] = useState(false)
  const [expectedValue, setExpectedValue] = useState(
    expectedAmounts[item.merchant]?.toString() ?? '',
  )
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setShowCategorySelect(false)
        setShowExpectedInput(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
          setShowCategorySelect(false)
          setShowExpectedInput(false)
        }}
        className="p-1 rounded hover:bg-surface-alt text-gray-60 hover:text-gray-100 transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 w-56 bg-surface border border-gray-10 rounded-xl shadow-lg py-1 text-sm">
          {showCategorySelect ? (
            <div className="px-2 py-1 max-h-48 overflow-y-auto">
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onCategoryChange(item.merchant, c.id)
                    setOpen(false)
                    setShowCategorySelect(false)
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded hover:bg-surface-alt text-gray-100 truncate ${
                    c.id === item.category_id ? 'bg-surface-alt' : ''
                  }`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-2"
                    style={{
                      backgroundColor: CATEGORY_HEX_COLORS[c.name] ?? '#9ca3af',
                    }}
                  />
                  {c.name}
                </button>
              ))}
            </div>
          ) : showExpectedInput ? (
            <div className="px-3 py-2">
              <label className="text-xs text-gray-60 mb-1 block">
                Expected monthly amount
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={expectedValue}
                  onChange={(e) => setExpectedValue(e.target.value)}
                  placeholder="e.g. 50"
                  className="flex-1 bg-surface-alt border border-gray-10 rounded px-2 py-1 text-sm text-gray-100 w-24"
                  autoFocus
                />
                <button
                  onClick={() => {
                    const val = parseFloat(expectedValue)
                    onSetExpected(item.merchant, isNaN(val) ? null : val)
                    setOpen(false)
                    setShowExpectedInput(false)
                  }}
                  className="px-2 py-1 bg-brand text-white rounded text-xs hover:bg-brand-dark"
                >
                  Save
                </button>
              </div>
              {expectedAmounts[item.merchant] != null && (
                <button
                  onClick={() => {
                    onSetExpected(item.merchant, null)
                    setOpen(false)
                    setShowExpectedInput(false)
                  }}
                  className="text-xs text-red-400 mt-1 hover:underline"
                >
                  Clear expected
                </button>
              )}
            </div>
          ) : (
            <>
              <Link
                to="/transactions"
                search={{ q: item.merchant }}
                className="flex items-center gap-2 px-3 py-2 hover:bg-surface-alt text-gray-100 w-full"
                onClick={() => setOpen(false)}
              >
                <ExternalLink size={14} />
                View transactions
              </Link>
              <button
                onClick={() => setShowCategorySelect(true)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-surface-alt text-gray-100 w-full text-left"
              >
                <Tag size={14} />
                Edit category
              </button>
              <button
                onClick={() => setShowExpectedInput(true)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-surface-alt text-gray-100 w-full text-left"
              >
                <Target size={14} />
                Set expected amount
              </button>
              <button
                onClick={() => {
                  onDismiss(item.merchant)
                  setOpen(false)
                }}
                className="flex items-center gap-2 px-3 py-2 hover:bg-surface-alt text-red-400 w-full text-left"
              >
                <Trash2 size={14} />
                Not recurring (dismiss)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

function SubscriptionsPage() {
  const { mode: viewMode, excludedKinds } = useViewMode()
  const [recurring, setRecurring] = useState<RecurringMerchant[]>([])
  const [cashAllocations, setCashAllocations] = useState<CashAllocation[]>([])
  const [trends, setTrends] = useState<RecurringTrendsResponse['trends']>({})
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'past'>('active')
  const [annualized, setAnnualized] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  )
  const [expectedAmounts, setExpectedAmounts] =
    useState<Record<string, number>>(loadExpectedAmounts)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getRecurringMerchants({
        view_mode: viewMode,
        excluded_kinds: excludedKinds,
      }),
      getCashAllocations(),
      getRecurringTrends(),
      getCategories(),
    ])
      .then(([r, c, t, cats]) => {
        setRecurring(r.items)
        setCashAllocations(c.items)
        setTrends(t.trends)
        setCategories(cats.items)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load subscriptions:', err)
        setLoading(false)
      })
  }, [viewMode, excludedKinds])

  const mult = annualized ? 12 : 1
  const suffix = annualized ? '/yr' : '/mo'

  const activeItems = useMemo(
    () => recurring.filter((r) => r.is_active),
    [recurring],
  )
  const pastItems = useMemo(
    () => recurring.filter((r) => !r.is_active),
    [recurring],
  )

  const currentItems = tab === 'active' ? activeItems : pastItems

  const primaryAmount = (r: RecurringMerchant) =>
    r.recent_avg_amount ?? r.avg_amount

  const expenseItems = useMemo(
    () => currentItems.filter((r) => primaryAmount(r) < 0),
    [currentItems],
  )
  const incomeItems = useMemo(
    () => currentItems.filter((r) => primaryAmount(r) >= 0),
    [currentItems],
  )

  const buildGroups = (items: RecurringMerchant[]) => {
    const map = new Map<string, CategoryGroup>()
    for (const item of items) {
      const key = item.category_name ?? 'Uncategorized'
      if (!map.has(key)) {
        map.set(key, {
          category_name: key,
          category_id: item.category_id,
          items: [],
          subtotal: 0,
        })
      }
      const group = map.get(key)!
      group.items.push(item)
      group.subtotal += Math.abs(item.recent_avg_amount ?? item.avg_amount)
    }
    return Array.from(map.values()).sort((a, b) => b.subtotal - a.subtotal)
  }

  const expenseGroups = useMemo(() => buildGroups(expenseItems), [expenseItems])
  const incomeGroups = useMemo(() => buildGroups(incomeItems), [incomeItems])

  const filteredExpenseGroups = useMemo(
    () =>
      selectedCategory
        ? expenseGroups.filter((g) => g.category_name === selectedCategory)
        : expenseGroups,
    [expenseGroups, selectedCategory],
  )

  const totalMonthlyBurn = useMemo(() => {
    const recurringTotal = activeItems
      .filter((r) => primaryAmount(r) < 0)
      .reduce((sum, r) => sum + Math.abs(primaryAmount(r)), 0)
    const cashTotal = cashAllocations
      .filter((c) => !c.end_date)
      .reduce((sum, c) => sum + monthlyAmount(c), 0)
    return recurringTotal + cashTotal
  }, [activeItems, cashAllocations])

  const totalMonthlyIncome = useMemo(
    () =>
      activeItems
        .filter((r) => primaryAmount(r) >= 0)
        .reduce((sum, r) => sum + primaryAmount(r), 0),
    [activeItems],
  )

  const toggleCategory = (name: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const isNew = (item: RecurringMerchant) => {
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    return new Date(item.first_seen) >= threeMonthsAgo
  }

  const handleDismiss = useCallback(async (merchant: string) => {
    await dismissRecurring(merchant)
    setRecurring((prev) => prev.filter((r) => r.merchant !== merchant))
  }, [])

  const handleCategoryChange = useCallback(
    async (merchant: string, categoryId: string) => {
      await bulkUpdateRecurringCategory(merchant, categoryId)
      const cat = categories.find((c) => c.id === categoryId)
      setRecurring((prev) =>
        prev.map((r) =>
          r.merchant === merchant
            ? {
                ...r,
                category_id: categoryId,
                category_name: cat?.name ?? r.category_name,
              }
            : r,
        ),
      )
    },
    [categories],
  )

  const handleSetExpected = useCallback(
    (merchant: string, amount: number | null) => {
      setExpectedAmounts((prev) => {
        const next = { ...prev }
        if (amount == null) delete next[merchant]
        else next[merchant] = amount
        saveExpectedAmounts(next)
        return next
      })
    },
    [],
  )

  const getExpectedWarning = (item: RecurringMerchant) => {
    const expected = expectedAmounts[item.merchant]
    if (expected == null) return false
    const actual = Math.abs(primaryAmount(item))
    return Math.abs(actual - expected) / expected > 0.15
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-page p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-surface-alt rounded w-48" />
            <div className="h-24 bg-surface-alt rounded" />
            <div className="h-64 bg-surface-alt rounded" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-page p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-100 mb-6">
          Subscriptions & Recurring
        </h2>

        {/* Summary bar */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <div className="bg-surface border border-gray-10 rounded-2xl p-4">
            <div className="text-xs text-gray-60 mb-1">
              {annualized ? 'Annual burn' : 'Monthly burn'}
            </div>
            <div className="text-xl font-bold text-gray-100">
              {formatILS(totalMonthlyBurn * mult)}
            </div>
          </div>
          <div className="bg-surface border border-emerald-500/20 rounded-2xl p-4">
            <div className="text-xs text-gray-60 mb-1">
              {annualized ? 'Annual income' : 'Monthly income'}
            </div>
            <div className="text-xl font-bold text-emerald-400">
              +{formatILS(totalMonthlyIncome * mult)}
            </div>
          </div>
          <div className="bg-surface border border-gray-10 rounded-2xl p-4">
            <div className="text-xs text-gray-60 mb-1">Active</div>
            <div className="text-xl font-bold text-emerald-400">
              {activeItems.length}
            </div>
          </div>
          <div className="bg-surface border border-gray-10 rounded-2xl p-4">
            <div className="text-xs text-gray-60 mb-1">Past</div>
            <div className="text-xl font-bold text-gray-60">
              {pastItems.length}
            </div>
          </div>
        </div>

        {/* Toggle row: Active/Past + Monthly/Annual */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Button
            variant={tab === 'active' ? 'default' : 'outline'}
            onClick={() => setTab('active')}
            className={
              tab === 'active'
                ? 'bg-brand text-white hover:bg-brand-dark'
                : 'bg-surface text-gray-60 hover:text-gray-100 border-gray-20'
            }
          >
            <Repeat size={16} />
            Active ({activeItems.length})
          </Button>
          <Button
            variant={tab === 'past' ? 'default' : 'outline'}
            onClick={() => setTab('past')}
            className={
              tab === 'past'
                ? 'bg-brand text-white hover:bg-brand-dark'
                : 'bg-surface text-gray-60 hover:text-gray-100 border-gray-20'
            }
          >
            <Clock size={16} />
            Past ({pastItems.length})
          </Button>

          <div className="flex items-center overflow-hidden rounded-lg border border-gray-10 bg-surface text-xs sm:ml-auto">
            <button
              onClick={() => setAnnualized(false)}
              className={`px-3 py-1.5 transition-colors ${
                !annualized
                  ? 'bg-brand text-white'
                  : 'text-gray-60 hover:text-gray-100'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnualized(true)}
              className={`px-3 py-1.5 transition-colors ${
                annualized
                  ? 'bg-brand text-white'
                  : 'text-gray-60 hover:text-gray-100'
              }`}
            >
              Annual
            </button>
          </div>
        </div>

        {/* Donut chart for expenses */}
        {expenseGroups.length > 0 && tab === 'active' && (
          <div className="mb-6">
            <DonutChart
              slices={expenseGroups.map((g) => ({
                name: g.category_name,
                value: g.subtotal * mult,
              }))}
              total={totalMonthlyBurn * mult}
              selected={selectedCategory}
              onSelect={setSelectedCategory}
              label={suffix}
            />
          </div>
        )}

        {/* Expenses grouped by category */}
        {filteredExpenseGroups.length === 0 && incomeGroups.length === 0 ? (
          <div className="bg-surface border border-gray-10 rounded-2xl p-8 text-center text-gray-60">
            <Ban size={32} className="mx-auto mb-3 opacity-40" />
            <p>No {tab} recurring transactions detected.</p>
          </div>
        ) : (
          <>
            {filteredExpenseGroups.length > 0 && (
              <div className="space-y-2">
                {filteredExpenseGroups.map((group) => {
                  const isExpanded = expandedCategories.has(group.category_name)
                  const dotColor =
                    CATEGORY_HEX_COLORS[group.category_name] ?? '#9ca3af'

                  return (
                    <div
                      key={group.category_name}
                      className="bg-surface border border-gray-10 rounded-2xl overflow-hidden"
                    >
                      <button
                        onClick={() => toggleCategory(group.category_name)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-alt transition-colors"
                      >
                        <span className="text-gray-60">
                          {isExpanded ? (
                            <ChevronDown size={16} />
                          ) : (
                            <ChevronRight size={16} />
                          )}
                        </span>
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: dotColor }}
                        />
                        <span className="font-semibold text-gray-100 text-sm">
                          {group.category_name}
                        </span>
                        <Badge
                          variant="secondary"
                          className="ml-1 text-xs bg-surface-alt text-gray-60"
                        >
                          {group.items.length}
                        </Badge>
                        <span className="ml-auto text-sm font-medium text-gray-100">
                          {formatILS(group.subtotal * mult)}
                          <span className="text-gray-60 font-normal">
                            {suffix}
                          </span>
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-10">
                          {group.items.map((item) => {
                            const merchantTrend = trends[item.merchant]
                            const sparkColor = dotColor
                            const hasWarning = getExpectedWarning(item)

                            return (
                              <div
                                key={item.merchant}
                                className="flex flex-wrap items-center gap-3 border-b border-gray-10 px-4 py-3 last:border-b-0 hover:bg-surface-alt/50 sm:flex-nowrap sm:gap-4 sm:py-2.5"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <Link
                                      to="/transactions"
                                      search={{ q: item.merchant }}
                                      className="text-sm text-gray-100 truncate hover:underline"
                                      dir="auto"
                                    >
                                      {item.merchant}
                                    </Link>
                                    {isNew(item) && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400">
                                        New
                                      </span>
                                    )}
                                    {hasWarning && (
                                      <span
                                        title={`Expected ${formatILS(expectedAmounts[item.merchant])}, actual ${formatILS(Math.abs(primaryAmount(item)))}`}
                                      >
                                        <AlertTriangle
                                          size={14}
                                          className="text-amber-400 shrink-0"
                                        />
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-60">
                                    {item.months_active} months
                                    {' · '}
                                    {formatDate(item.first_seen)} –{' '}
                                    {formatDate(item.last_seen)}
                                  </div>
                                </div>
                                {merchantTrend && merchantTrend.length >= 2 && (
                                  <span className="hidden sm:block">
                                    <Sparkline
                                      points={merchantTrend.slice(-12)}
                                      color={sparkColor}
                                    />
                                  </span>
                                )}
                                <div className="text-right shrink-0">
                                  <div className="text-sm font-medium text-gray-100">
                                    {formatILS(
                                      Math.abs(primaryAmount(item)) * mult,
                                    )}
                                    <span className="text-gray-60 font-normal text-xs">
                                      {suffix}
                                    </span>
                                    {item.recent_avg_amount != null &&
                                      Math.abs(
                                        (item.recent_avg_amount -
                                          item.avg_amount) /
                                          item.avg_amount,
                                      ) > 0.1 && (
                                        <span
                                          className={`ml-1 text-xs ${
                                            Math.abs(item.recent_avg_amount) >
                                            Math.abs(item.avg_amount)
                                              ? 'text-red-400'
                                              : 'text-emerald-400'
                                          }`}
                                        >
                                          {Math.abs(item.recent_avg_amount) >
                                          Math.abs(item.avg_amount)
                                            ? '↑'
                                            : '↓'}
                                        </span>
                                      )}
                                  </div>
                                  <div className="text-xs text-gray-60">
                                    {item.tx_count} txns
                                  </div>
                                </div>
                                <ActionMenu
                                  item={item}
                                  categories={categories}
                                  expectedAmounts={expectedAmounts}
                                  onDismiss={handleDismiss}
                                  onCategoryChange={handleCategoryChange}
                                  onSetExpected={handleSetExpected}
                                />
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Recurring Income */}
            {incomeGroups.length > 0 && (
              <div className="mt-8">
                <h3 className="text-lg font-semibold text-gray-100 mb-3 flex items-center gap-2">
                  <TrendingUp size={20} className="text-emerald-400" />
                  Recurring Income
                </h3>
                <div className="space-y-2">
                  {incomeGroups.map((group) => {
                    const key = `income-${group.category_name}`
                    const isExpanded = expandedCategories.has(key)
                    const dotColor =
                      CATEGORY_HEX_COLORS[group.category_name] ?? '#9ca3af'

                    return (
                      <div
                        key={key}
                        className="bg-emerald-500/[0.04] border border-emerald-500/20 rounded-2xl overflow-hidden"
                      >
                        <button
                          onClick={() => toggleCategory(key)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-emerald-500/[0.08] transition-colors"
                        >
                          <span className="text-emerald-400">
                            {isExpanded ? (
                              <ChevronDown size={16} />
                            ) : (
                              <ChevronRight size={16} />
                            )}
                          </span>
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: dotColor }}
                          />
                          <span className="font-semibold text-gray-100 text-sm">
                            {group.category_name}
                          </span>
                          <Badge
                            variant="secondary"
                            className="ml-1 text-xs bg-emerald-500/10 text-emerald-400"
                          >
                            {group.items.length}
                          </Badge>
                          <span className="ml-auto text-sm font-medium text-emerald-400">
                            +{formatILS(group.subtotal * mult)}
                            <span className="text-emerald-400/60 font-normal">
                              {suffix}
                            </span>
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="border-t border-emerald-500/20">
                            {group.items.map((item) => {
                              const merchantTrend = trends[item.merchant]

                              return (
                                <div
                                  key={item.merchant}
                                  className="flex flex-wrap items-center gap-3 border-b border-emerald-500/10 px-4 py-3 last:border-b-0 hover:bg-emerald-500/[0.06] sm:flex-nowrap sm:gap-4 sm:py-2.5"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <Link
                                        to="/transactions"
                                        search={{ q: item.merchant }}
                                        className="text-sm text-gray-100 truncate hover:underline"
                                        dir="auto"
                                      >
                                        {item.merchant}
                                      </Link>
                                      {isNew(item) && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400">
                                          New
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs text-gray-60">
                                      {item.months_active} months
                                      {' · '}
                                      {formatDate(item.first_seen)} –{' '}
                                      {formatDate(item.last_seen)}
                                    </div>
                                  </div>
                                  {merchantTrend &&
                                    merchantTrend.length >= 2 && (
                                      <span className="hidden sm:block">
                                        <Sparkline
                                          points={merchantTrend.slice(-12)}
                                          color="#10b981"
                                        />
                                      </span>
                                    )}
                                  <div className="text-right shrink-0">
                                    <div className="text-sm font-medium text-emerald-400">
                                      +{formatILS(primaryAmount(item) * mult)}
                                      <span className="text-emerald-400/60 font-normal text-xs">
                                        {suffix}
                                      </span>
                                      {item.recent_avg_amount != null &&
                                        Math.abs(
                                          (item.recent_avg_amount -
                                            item.avg_amount) /
                                            item.avg_amount,
                                        ) > 0.1 && (
                                          <span
                                            className={`ml-1 text-xs ${
                                              item.recent_avg_amount >
                                              item.avg_amount
                                                ? 'text-emerald-400'
                                                : 'text-red-400'
                                            }`}
                                          >
                                            {item.recent_avg_amount >
                                            item.avg_amount
                                              ? '↑'
                                              : '↓'}
                                          </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-60">
                                      {item.tx_count} txns
                                    </div>
                                  </div>
                                  <ActionMenu
                                    item={item}
                                    categories={categories}
                                    expectedAmounts={expectedAmounts}
                                    onDismiss={handleDismiss}
                                    onCategoryChange={handleCategoryChange}
                                    onSetExpected={handleSetExpected}
                                  />
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Cash Allocations section */}
        {cashAllocations.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-gray-100 mb-3 flex items-center gap-2">
              <Banknote size={20} />
              Cash Allocations
            </h3>
            <div className="bg-surface border border-gray-10 rounded-2xl overflow-hidden">
              {cashAllocations.map((alloc) => {
                const monthly = monthlyAmount(alloc)
                const isOngoing = !alloc.end_date

                return (
                  <div
                    key={alloc.id}
                    className="flex flex-wrap items-center gap-3 border-b border-gray-10 px-4 py-3 last:border-b-0 sm:flex-nowrap sm:gap-4"
                  >
                    <DollarSign
                      size={16}
                      className={
                        isOngoing ? 'text-emerald-400' : 'text-gray-60'
                      }
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-100">
                        {alloc.description}
                      </div>
                      <div className="text-xs text-gray-60">
                        {alloc.frequency}
                        {' · '}
                        {alloc.category_name ?? 'No category'}
                        {!isOngoing && (
                          <span className="text-amber-400 ml-1">
                            (ended {alloc.end_date})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium text-gray-100">
                        {formatILS(Math.abs(alloc.amount) * mult)}
                        <span className="text-gray-60 font-normal text-xs">
                          /
                          {annualized
                            ? 'yr'
                            : alloc.frequency === 'monthly'
                              ? 'mo'
                              : alloc.frequency === 'biweekly'
                                ? '2wk'
                                : 'wk'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-60">
                        ~{formatILS(monthly * mult)}
                        {suffix}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
