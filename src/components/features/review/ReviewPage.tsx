import { useState, useEffect } from 'react'
import { useSearch, useNavigate } from '@tanstack/react-router'
import { CheckCircle } from 'lucide-react'
import {
  getReviewTransactions,
  getCategories,
  updateTransaction,
  getTags,
  createTag,
  addTagToTransaction,
} from '@/lib/api'
import type { SuspiciousTransaction, Category, Tag } from '@/lib/types'
import { useViewMode } from '@/lib/view-mode'
import { CATEGORY_COLORS } from '@/lib/constants'
import { splitAmount } from '@/utils/currency'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const FLAG_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'amount_outlier', label: 'Outliers' },
  { key: 'merchant_mismatch', label: 'Mismatches' },
  { key: 'singleton_category', label: 'Singletons' },
] as const

export default function ReviewPage() {
  const { mode, excludedKinds } = useViewMode()
  const navigate = useNavigate()
  const { filter: urlFilter, category_id: urlCategoryId } = useSearch({
    from: '/review',
  })

  const activeFilter = urlFilter || 'all'
  const filterCategory = urlCategoryId || ''

  const [items, setItems] = useState<SuspiciousTransaction[]>([])
  const [total, setTotal] = useState(0)
  const [flagCounts, setFlagCounts] = useState<Record<string, number>>({})
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [notesValue, setNotesValue] = useState('')
  const limit = 50

  useEffect(() => {
    getCategories().then((res) => setCategories(res.items))
    getTags().then((res) => setTags(res.items))
  }, [])

  useEffect(() => {
    setLoading(true)
    getReviewTransactions({
      view_mode: mode,
      excluded_kinds: excludedKinds,
      filter: activeFilter,
      category_id: filterCategory || undefined,
      limit,
      offset: page * limit,
    })
      .then((res) => {
        setItems(res.items)
        setTotal(res.total)
        setFlagCounts(res.flag_counts)
      })
      .finally(() => setLoading(false))
  }, [mode, excludedKinds, activeFilter, filterCategory, page])

  const setFilter = (f: string) => {
    setPage(0)
    navigate({
      to: '/review',
      search: {
        filter: f === 'all' ? undefined : f,
        category_id: filterCategory || undefined,
      },
    })
  }

  const setCategoryFilter = (catId: string) => {
    setPage(0)
    navigate({
      to: '/review',
      search: {
        filter: activeFilter === 'all' ? undefined : activeFilter,
        category_id: catId || undefined,
      },
    })
  }

  const handleCategoryChange = async (txId: string, categoryId: string) => {
    await updateTransaction(txId, { category_id: categoryId || null })
    setItems((prev) =>
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
    setEditingCategory(null)
  }

  const handleNotesSave = async (txId: string, notes: string) => {
    await updateTransaction(txId, { notes: notes || '' })
    setItems((prev) =>
      prev.map((tx) => (tx.id === txId ? { ...tx, notes: notes || null } : tx)),
    )
    setEditingNotes(null)
  }

  const handleMarkReviewed = async (txId: string) => {
    let reviewedTag = tags.find((t) => t.name === 'Reviewed')
    if (!reviewedTag) {
      const res = await createTag('Reviewed', '#22c55e')
      reviewedTag = res.tag
      setTags((prev) => [...prev, reviewedTag!])
    }
    const tx = items.find((t) => t.id === txId)
    if (tx?.tags?.some((t) => t.id === reviewedTag!.id)) return
    await addTagToTransaction(txId, reviewedTag.id)
    setItems((prev) =>
      prev.map((t) =>
        t.id === txId ? { ...t, tags: [...(t.tags || []), reviewedTag!] } : t,
      ),
    )
  }

  const totalAll =
    (flagCounts.amount_outlier || 0) +
    (flagCounts.merchant_mismatch || 0) +
    (flagCounts.singleton_category || 0)
  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 items-center">
        {FLAG_FILTERS.map(({ key, label }) => {
          const count = key === 'all' ? totalAll : flagCounts[key] || 0
          const isActive = activeFilter === key
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand text-white'
                  : 'bg-surface-alt text-gray-60 hover:text-gray-100 hover:bg-gray-10'
              }`}
            >
              {label}{' '}
              <span className={isActive ? 'text-white/70' : 'text-gray-40'}>
                ({count})
              </span>
            </button>
          )
        })}

        <select
          value={filterCategory}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="ml-auto px-3 py-2 bg-surface border border-gray-10 rounded-[14px] text-gray-100 text-sm focus:outline-none focus:border-brand"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-[18px] border border-gray-10 bg-surface shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-alt border-gray-10">
              <TableHead className="text-gray-60 text-xs uppercase tracking-wider">
                Date
              </TableHead>
              <TableHead className="text-gray-60 text-xs uppercase tracking-wider">
                Merchant
              </TableHead>
              <TableHead className="text-right text-gray-60 text-xs uppercase tracking-wider">
                Amount
              </TableHead>
              <TableHead className="text-gray-60 text-xs uppercase tracking-wider">
                Category
              </TableHead>
              <TableHead className="text-gray-60 text-xs uppercase tracking-wider">
                Flags
              </TableHead>
              <TableHead className="text-gray-60 text-xs uppercase tracking-wider">
                Notes
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-gray-40 py-8"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-gray-40 py-8"
                >
                  No suspicious transactions found. Nice!
                </TableCell>
              </TableRow>
            ) : (
              items.map((tx) => {
                const { prefix, intStr, decStr } = splitAmount(tx.amount)
                const dotColor =
                  CATEGORY_COLORS[tx.category_name || ''] || 'bg-gray-20'
                const isReviewed = tx.tags?.some((t) => t.name === 'Reviewed')

                return (
                  <TableRow
                    key={tx.id}
                    className={`border-gray-10 hover:bg-surface-alt/50 transition-colors ${isReviewed ? 'opacity-50' : ''}`}
                  >
                    <TableCell className="text-gray-60 whitespace-nowrap text-xs">
                      {tx.date}
                    </TableCell>
                    <TableCell className="text-gray-100 font-medium" dir="auto">
                      {tx.merchant}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono whitespace-nowrap tabular-nums ${
                        tx.amount < 0 ? 'text-negative' : 'text-positive'
                      }`}
                    >
                      {prefix}₪{intStr}
                      <span className="text-[0.75em] opacity-60">
                        .{decStr}
                      </span>
                    </TableCell>
                    <TableCell>
                      {editingCategory === tx.id ? (
                        <select
                          autoFocus
                          value={tx.category_id ?? ''}
                          onChange={(e) =>
                            handleCategoryChange(tx.id, e.target.value)
                          }
                          onBlur={() => setEditingCategory(null)}
                          className="px-2 py-1 bg-surface border border-gray-10 rounded-[10px] text-gray-100 text-sm focus:outline-none focus:border-brand"
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => setEditingCategory(tx.id)}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-[10px] text-xs font-medium transition-colors bg-surface-alt text-gray-80 hover:bg-gray-10"
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${dotColor}`}
                          />
                          {tx.category_name ?? 'Uncategorized'}
                        </button>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        {tx.flags.includes('amount_outlier') && (
                          <Badge className="bg-amber-500/15 text-amber-400 border-0 text-[10px]">
                            {
                              (
                                tx.flag_details.amount_outlier as {
                                  ratio: number
                                }
                              )?.ratio
                            }
                            x avg
                          </Badge>
                        )}
                        {tx.flags.includes('merchant_mismatch') && (
                          <Badge className="bg-red-500/15 text-red-400 border-0 text-[10px]">
                            Multi-cat
                          </Badge>
                        )}
                        {tx.flags.includes('singleton_category') && (
                          <Badge className="bg-orange-500/15 text-orange-400 border-0 text-[10px]">
                            Unusual cat
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[120px]">
                      {editingNotes === tx.id ? (
                        <Input
                          autoFocus
                          type="text"
                          value={notesValue}
                          onChange={(e) => setNotesValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter')
                              handleNotesSave(tx.id, notesValue)
                            if (e.key === 'Escape') setEditingNotes(null)
                          }}
                          onBlur={() => handleNotesSave(tx.id, notesValue)}
                          className="h-7 text-xs bg-surface border-gray-10 text-gray-100"
                        />
                      ) : (
                        <button
                          onClick={() => {
                            setEditingNotes(tx.id)
                            setNotesValue(tx.notes || '')
                          }}
                          className="text-xs text-gray-40 hover:text-gray-80 transition-colors truncate max-w-[150px] block"
                          title={tx.notes || 'Click to add note'}
                        >
                          {tx.notes || '—'}
                        </button>
                      )}
                    </TableCell>
                    <TableCell>
                      {isReviewed ? (
                        <CheckCircle size={16} className="text-positive" />
                      ) : (
                        <button
                          onClick={() => handleMarkReviewed(tx.id)}
                          className="p-1 rounded hover:bg-surface-alt text-gray-40 hover:text-positive transition-colors"
                          title="Mark reviewed"
                        >
                          <CheckCircle size={16} />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-60">
          <span>
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of{' '}
            {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="bg-surface border-gray-10 hover:bg-surface-alt"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="bg-surface border-gray-10 hover:bg-surface-alt"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
