import { useState, useEffect, useCallback } from 'react'
import {
  ChevronUp,
  ChevronDown,
  Search,
  Copy,
  Check,
  Plus,
  X,
  CalendarRange,
} from 'lucide-react'
import { useSearch, useNavigate } from '@tanstack/react-router'
import {
  getTransactions,
  getCategories,
  updateTransaction,
  getTags,
  createTag,
  addTagToTransaction,
  removeTagFromTransaction,
} from '@/lib/api'
import type { Transaction, Category, Tag } from '@/lib/types'
import { useViewMode } from '@/lib/view-mode'
import { CATEGORY_COLORS } from '@/lib/constants'
import { splitAmount } from '@/utils/currency'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { TagIcon } from '@/components/ui/tag-icon'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function TransactionTable() {
  const { mode } = useViewMode()
  const navigate = useNavigate()
  const { category_id: urlCategoryId, q: urlQuery } = useSearch({
    from: '/transactions',
  })
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState('date')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState(urlQuery ?? '')
  const filterCategory = urlCategoryId ?? ''
  const setFilterCategory = (val: string) => {
    navigate({ to: '/transactions', search: { category_id: val || undefined } })
  }
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [notesValue, setNotesValue] = useState('')
  const [hideInternal, setHideInternal] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagPickerOpen, setTagPickerOpen] = useState<string | null>(null)
  const [newTagName, setNewTagName] = useState('')
  const [spreadPickerOpen, setSpreadPickerOpen] = useState<string | null>(null)
  const limit = 50

  const copyToClipboard = useCallback((id: string) => {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }, [])

  useEffect(() => {
    getCategories().then((res) => setCategories(res.items))
    getTags().then((res) => setTags(res.items))
  }, [])

  useEffect(() => {
    setLoading(true)
    getTransactions({
      limit,
      offset: page * limit,
      sort,
      order,
      q: search || undefined,
      category_id: filterCategory || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      exclude_internal: hideInternal ? '1' : undefined,
      view_mode: mode,
    })
      .then((res) => {
        setTransactions(res.items)
        setTotal(res.total)
      })
      .finally(() => setLoading(false))
  }, [
    page,
    sort,
    order,
    search,
    filterCategory,
    dateFrom,
    dateTo,
    hideInternal,
    mode,
  ])

  const toggleSort = (field: string) => {
    if (sort === field) {
      setOrder(order === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(field)
      setOrder('desc')
    }
    setPage(0)
  }

  const handleCategoryChange = async (txId: string, categoryId: string) => {
    await updateTransaction(txId, { category_id: categoryId || null })
    setTransactions((prev) =>
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
    setTransactions((prev) =>
      prev.map((tx) => (tx.id === txId ? { ...tx, notes: notes || null } : tx)),
    )
    setEditingNotes(null)
  }

  const handleAddTag = async (txId: string, tagId: string) => {
    await addTagToTransaction(txId, tagId)
    const tag = tags.find((t) => t.id === tagId)
    if (tag) {
      setTransactions((prev) =>
        prev.map((tx) =>
          tx.id === txId ? { ...tx, tags: [...(tx.tags || []), tag] } : tx,
        ),
      )
    }
    setTagPickerOpen(null)
  }

  const handleRemoveTag = async (txId: string, tagId: string) => {
    await removeTagFromTransaction(txId, tagId)
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.id === txId
          ? { ...tx, tags: (tx.tags || []).filter((t) => t.id !== tagId) }
          : tx,
      ),
    )
  }

  const handleCreateAndAddTag = async (txId: string, name: string) => {
    if (!name.trim()) return
    const res = await createTag(name.trim())
    const tag = res.tag
    setTags((prev) => [...prev, tag])
    await addTagToTransaction(txId, tag.id)
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.id === txId ? { ...tx, tags: [...(tx.tags || []), tag] } : tx,
      ),
    )
    setNewTagName('')
    setTagPickerOpen(null)
  }

  const handleSpreadChange = async (txId: string, months: number | null) => {
    setSpreadPickerOpen(null)
    await updateTransaction(txId, { spread_months: months })
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.id === txId ? { ...tx, spread_months: months } : tx,
      ),
    )
  }

  const SortIcon = ({ field }: { field: string }) =>
    sort === field ? (
      order === 'asc' ? (
        <ChevronUp size={14} className="inline" />
      ) : (
        <ChevronDown size={14} className="inline" />
      )
    ) : null

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-40"
          />
          <Input
            type="text"
            placeholder="Search merchants..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="pl-9 bg-surface border-gray-10 text-gray-100"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => {
            setFilterCategory(e.target.value)
            setPage(0)
          }}
          className="px-3 py-2 bg-surface border border-gray-10 rounded-[14px] text-gray-100 text-sm focus:outline-none focus:border-brand"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value)
            setPage(0)
          }}
          className="w-auto bg-surface border-gray-10 text-gray-100"
        />
        <span className="text-gray-40">–</span>
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value)
            setPage(0)
          }}
          className="w-auto bg-surface border-gray-10 text-gray-100"
        />
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="hide-internal"
            checked={hideInternal}
            onCheckedChange={(checked) => {
              setHideInternal(checked === true)
              setPage(0)
            }}
          />
          <Label
            htmlFor="hide-internal"
            className="text-sm text-gray-60 cursor-pointer select-none whitespace-nowrap"
          >
            Hide internal
          </Label>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-[18px] border border-gray-10 bg-surface shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-alt border-gray-10">
              <TableHead className="w-8 px-2" />
              <TableHead
                className="cursor-pointer hover:text-gray-100 transition-colors text-gray-60 text-xs uppercase tracking-wider"
                onClick={() => toggleSort('date')}
              >
                Date <SortIcon field="date" />
              </TableHead>
              <TableHead
                className="cursor-pointer hover:text-gray-100 transition-colors text-gray-60 text-xs uppercase tracking-wider"
                onClick={() => toggleSort('merchant')}
              >
                Merchant <SortIcon field="merchant" />
              </TableHead>
              <TableHead
                className="cursor-pointer hover:text-gray-100 transition-colors text-right text-gray-60 text-xs uppercase tracking-wider"
                onClick={() => toggleSort('amount')}
              >
                Amount <SortIcon field="amount" />
              </TableHead>
              <TableHead className="text-gray-60 text-xs uppercase tracking-wider">
                Category
              </TableHead>
              <TableHead className="text-gray-60 text-xs uppercase tracking-wider">
                Tags
              </TableHead>
              <TableHead className="text-gray-60 text-xs uppercase tracking-wider">
                Notes
              </TableHead>
              <TableHead className="text-gray-60 text-xs uppercase tracking-wider">
                Spread
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-gray-40 py-8"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : transactions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-gray-40 py-8"
                >
                  No transactions found. Upload a PDF to get started.
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((tx) => {
                const { prefix, intStr, decStr } = splitAmount(tx.amount)
                const dotColor =
                  CATEGORY_COLORS[tx.category_name || ''] || 'bg-gray-20'

                return (
                  <TableRow
                    key={tx.id}
                    className={`border-gray-10 hover:bg-surface-alt/50 transition-colors ${tx.is_internal ? 'opacity-60' : ''} ${tx.needs_review ? 'border-l-2 border-l-amber-400/70' : ''}`}
                  >
                    <TableCell className="w-8 px-2">
                      <button
                        onClick={() => copyToClipboard(tx.id)}
                        className="p-1 rounded hover:bg-gray-10 text-gray-40 hover:text-gray-80 transition-colors"
                        title="Copy transaction ID"
                      >
                        {copiedId === tx.id ? (
                          <Check size={12} className="text-positive" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </TableCell>
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
                      <div className="flex items-center gap-1.5">
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
                        {tx.is_internal && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] bg-gray-10 text-gray-40"
                          >
                            Internal
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        {(tx.tags || []).map((tag) => (
                          <Badge
                            key={tag.id}
                            variant="secondary"
                            className="gap-1 text-[10px]"
                            style={{
                              backgroundColor: tag.color
                                ? `${tag.color}20`
                                : 'var(--color-gray-10)',
                              color: tag.color || 'var(--color-gray-60)',
                            }}
                          >
                            <TagIcon icon={tag.icon} size={10} />
                            {tag.name}
                            <button
                              onClick={() => handleRemoveTag(tx.id, tag.id)}
                              className="hover:opacity-70"
                            >
                              <X size={10} />
                            </button>
                          </Badge>
                        ))}
                        <div className="relative">
                          <button
                            onClick={() =>
                              setTagPickerOpen(
                                tagPickerOpen === tx.id ? null : tx.id,
                              )
                            }
                            className="p-0.5 rounded hover:bg-gray-10 text-gray-40 hover:text-gray-60 transition-colors"
                            title="Add tag"
                          >
                            <Plus size={12} />
                          </button>
                          {tagPickerOpen === tx.id && (
                            <div className="absolute z-20 top-full left-0 mt-1 w-44 bg-surface border border-gray-10 rounded-[10px] shadow-lg py-1">
                              {tags
                                .filter(
                                  (t) =>
                                    !(tx.tags || []).some(
                                      (tt) => tt.id === t.id,
                                    ),
                                )
                                .map((tag) => (
                                  <button
                                    key={tag.id}
                                    onClick={() => handleAddTag(tx.id, tag.id)}
                                    className="w-full text-left px-3 py-1.5 text-xs text-gray-80 hover:bg-surface-alt transition-colors flex items-center gap-2"
                                  >
                                    {tag.icon ? (
                                      <TagIcon
                                        icon={tag.icon}
                                        size={12}
                                        className="shrink-0"
                                        style={{
                                          color:
                                            tag.color || 'var(--color-gray-40)',
                                        }}
                                      />
                                    ) : (
                                      <span
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{
                                          backgroundColor:
                                            tag.color || 'var(--color-gray-40)',
                                        }}
                                      />
                                    )}
                                    {tag.name}
                                  </button>
                                ))}
                              <div className="border-t border-gray-10 mt-1 pt-1 px-2">
                                <Input
                                  type="text"
                                  placeholder="New tag..."
                                  value={newTagName}
                                  onChange={(e) =>
                                    setNewTagName(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter')
                                      handleCreateAndAddTag(tx.id, newTagName)
                                    if (e.key === 'Escape')
                                      setTagPickerOpen(null)
                                  }}
                                  className="h-7 text-xs bg-surface-alt border-gray-10 text-gray-100"
                                />
                              </div>
                            </div>
                          )}
                        </div>
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
                    <TableCell className="relative">
                      <button
                        className={`p-1 rounded hover:bg-surface-alt transition-colors ${tx.spread_months ? 'text-brand' : 'text-gray-30 hover:text-gray-50'}`}
                        title={
                          tx.spread_months
                            ? `Spread over ${tx.spread_months} months`
                            : 'Spread billing'
                        }
                        onClick={() =>
                          setSpreadPickerOpen(
                            spreadPickerOpen === tx.id ? null : tx.id,
                          )
                        }
                      >
                        <CalendarRange size={14} />
                      </button>
                      {spreadPickerOpen === tx.id && (
                        <div className="absolute left-0 top-full z-20 mt-1 bg-surface border border-gray-10 rounded-lg shadow-lg p-2">
                          <div className="flex gap-1">
                            {[2, 3, 6, 12].map((n) => (
                              <button
                                key={n}
                                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                  tx.spread_months === n
                                    ? 'bg-brand text-white'
                                    : 'bg-surface-alt text-gray-60 hover:text-gray-100'
                                }`}
                                onClick={() => handleSpreadChange(tx.id, n)}
                              >
                                {n}mo
                              </button>
                            ))}
                            {tx.spread_months && (
                              <button
                                className="px-2 py-1 rounded text-xs font-medium bg-surface-alt text-gray-40 hover:text-negative transition-colors"
                                onClick={() => handleSpreadChange(tx.id, null)}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
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
