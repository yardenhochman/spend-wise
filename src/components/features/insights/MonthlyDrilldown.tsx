import { useState, useEffect } from 'react'
import {
  ChevronDown,
  ChevronRight,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { getMonthlyInsights, getCategoryTransactions } from '@/lib/api'
import type { MonthlyInsights, Transaction } from '@/lib/types'
import { useViewMode } from '@/lib/view-mode'
import { CATEGORY_COLORS } from '@/lib/constants'
import { formatILS } from '@/utils/currency'
import { formatMonthLabel } from '@/utils/dates'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function MonthlyDrilldown() {
  const { mode } = useViewMode()
  const [data, setData] = useState<MonthlyInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [year, setYear] = useState<string>('')
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [categoryTxns, setCategoryTxns] = useState<Transaction[]>([])
  const [loadingTxns, setLoadingTxns] = useState(false)

  useEffect(() => {
    setLoading(true)
    getMonthlyInsights({ year: year || undefined, view_mode: mode })
      .then(setData)
      .finally(() => setLoading(false))
  }, [year, mode])

  const toggleMonth = (month: string) => {
    setExpandedMonth(expandedMonth === month ? null : month)
    setExpandedCategory(null)
    setCategoryTxns([])
  }

  const toggleCategory = async (month: string, categoryId: string | null) => {
    const key = `${month}|${categoryId}`
    if (expandedCategory === key) {
      setExpandedCategory(null)
      setCategoryTxns([])
      return
    }

    setExpandedCategory(key)
    setLoadingTxns(true)

    const [y, m] = month.split('-')
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate()

    try {
      const res = await getCategoryTransactions({
        category_id: categoryId ?? undefined,
        date_from: `${month}-01`,
        date_to: `${month}-${lastDay}`,
        view_mode: mode,
      })
      setCategoryTxns(res.items)
    } finally {
      setLoadingTxns(false)
    }
  }

  if (loading || !data) {
    return (
      <p className="text-gray-40 text-center py-8">Loading monthly data...</p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Year selector */}
      <div className="flex items-center gap-3">
        <Button
          variant={!year ? 'default' : 'outline'}
          onClick={() => setYear('')}
          className={
            !year
              ? 'bg-brand text-white hover:bg-brand-dark'
              : 'bg-surface text-gray-60 hover:text-gray-100 border-gray-20'
          }
        >
          All Years
        </Button>
        {data.years.map((y) => (
          <Button
            key={y}
            variant={year === y ? 'default' : 'outline'}
            onClick={() => setYear(y)}
            className={
              year === y
                ? 'bg-brand text-white hover:bg-brand-dark'
                : 'bg-surface text-gray-60 hover:text-gray-100 border-gray-20'
            }
          >
            {y}
          </Button>
        ))}
      </div>

      {/* Monthly cards */}
      <div className="space-y-3">
        {data.months.map((m) => {
          const spend = Math.abs(m.spend ?? 0)
          const income = m.income ?? 0
          const net = income - spend
          const isExpanded = expandedMonth === m.month
          const expenseCategories = m.categories.filter((c) => c.total < 0)
          const maxCatSpend = Math.max(
            ...expenseCategories.map((c) => Math.abs(c.total)),
            1,
          )

          return (
            <Card key={m.month} className="border-gray-20 overflow-hidden">
              {/* Month header */}
              <button
                onClick={() => toggleMonth(m.month)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-alt/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown size={18} className="text-gray-40" />
                  ) : (
                    <ChevronRight size={18} className="text-gray-40" />
                  )}
                  <span className="text-gray-100 font-bold text-base">
                    {formatMonthLabel(m.month)}
                  </span>
                  <span className="text-gray-40 text-sm">
                    ({m.count} transactions)
                  </span>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-negative flex items-center gap-1">
                    <TrendingDown size={14} />
                    {formatILS(spend)}
                  </span>
                  <span className="text-positive flex items-center gap-1">
                    <TrendingUp size={14} />
                    {formatILS(income)}
                  </span>
                  <span
                    className={`font-bold ${net >= 0 ? 'text-positive' : 'text-negative'}`}
                  >
                    {net >= 0 ? '+' : '-'}
                    {formatILS(Math.abs(net))}
                  </span>
                </div>
              </button>

              {/* Expanded: category breakdown */}
              {isExpanded && (
                <div className="border-t border-gray-20 px-5 py-4 space-y-2">
                  {expenseCategories.length === 0 ? (
                    <p className="text-gray-40 text-sm">
                      No expenses this month.
                    </p>
                  ) : (
                    expenseCategories
                      .sort((a, b) => a.total - b.total)
                      .map((cat) => {
                        const absTotal = Math.abs(cat.total)
                        const pct =
                          spend > 0
                            ? ((absTotal / spend) * 100).toFixed(1)
                            : '0'
                        const barWidth = (absTotal / maxCatSpend) * 100
                        const colorClass =
                          CATEGORY_COLORS[cat.category_name || ''] ||
                          'bg-gray-40'
                        const catKey = `${m.month}|${cat.category_id}`
                        const isCatExpanded = expandedCategory === catKey

                        return (
                          <div key={cat.category_id ?? 'uncategorized'}>
                            <button
                              onClick={() =>
                                toggleCategory(m.month, cat.category_id)
                              }
                              className="w-full text-left hover:bg-surface-alt/30 rounded-lg px-2 py-1.5 transition-colors"
                            >
                              <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-80 font-medium flex items-center gap-2">
                                  <span
                                    className={`w-2.5 h-2.5 rounded-full ${colorClass}`}
                                  />
                                  {cat.category_name || 'Uncategorized'}
                                  <span className="text-gray-40 text-xs">
                                    ({cat.count})
                                  </span>
                                  {isCatExpanded ? (
                                    <ChevronDown
                                      size={12}
                                      className="text-gray-40"
                                    />
                                  ) : (
                                    <ChevronRight
                                      size={12}
                                      className="text-gray-40"
                                    />
                                  )}
                                </span>
                                <span className="text-gray-60 tabular-nums">
                                  {formatILS(absTotal)}{' '}
                                  <span className="text-gray-40">({pct}%)</span>
                                </span>
                              </div>
                              <div className="h-[10px] bg-surface-alt rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                            </button>

                            {isCatExpanded && (
                              <div className="ml-6 mt-2 mb-3 border-l-2 border-gray-20 pl-4">
                                {loadingTxns ? (
                                  <p className="text-gray-40 text-xs py-2">
                                    Loading...
                                  </p>
                                ) : categoryTxns.length === 0 ? (
                                  <p className="text-gray-40 text-xs py-2">
                                    No transactions.
                                  </p>
                                ) : (
                                  <div className="space-y-1">
                                    {categoryTxns.map((tx) => (
                                      <div
                                        key={tx.id}
                                        className={`flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-surface-alt/30 ${
                                          tx.needs_review
                                            ? 'border-l-2 border-l-amber-400/70'
                                            : ''
                                        }`}
                                      >
                                        <div className="flex items-center gap-3">
                                          <span className="text-gray-40 w-20 shrink-0">
                                            {tx.date}
                                          </span>
                                          <span
                                            className="text-gray-80"
                                            dir="auto"
                                          >
                                            {tx.merchant}
                                          </span>
                                        </div>
                                        <span className="text-negative font-mono tabular-nums whitespace-nowrap">
                                          {formatILS(Math.abs(tx.amount))}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
