import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useDebouncedCallback } from '@tanstack/react-pacer'
import { match } from 'ts-pattern'
import {
  Search,
  BarChart3,
  Repeat,
  Zap,
  ClipboardCheck,
  Upload,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import { globalSearch, type ApiError } from '@/lib/api'
import type { SearchResult as SearchApiResult } from '@/lib/types'
import { CATEGORY_COLORS } from '@/lib/constants'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

interface PaletteItem {
  id: string
  type: 'page' | 'category' | 'merchant'
  label: string
  sublabel?: string
  icon?: React.ReactNode
  action: () => void
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: SearchApiResult }
  | { status: 'error'; error: ApiError }

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchState, setSearchState] = useState<SearchState>({
    status: 'idle',
  })
  const inputRef = useRef<HTMLInputElement>(null)

  const doSearch = useDebouncedCallback(
    (q: string) => {
      if (!q || q.length < 2) {
        setSearchState({ status: 'idle' })
        return
      }

      setSearchState({ status: 'loading' })

      globalSearch(q).match(
        (data) => setSearchState({ status: 'success', data }),
        (error) => setSearchState({ status: 'error', error }),
      )
    },
    { wait: 150 },
  )

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setSelectedIndex(0)
    doSearch(value)
  }

  const pages: PaletteItem[] = [
    {
      id: 'page-insights',
      type: 'page',
      label: 'Insights',
      icon: <BarChart3 size={14} />,
      action: () => navigate({ to: '/insights' }),
    },
    {
      id: 'page-recurring',
      type: 'page',
      label: 'Recurring',
      icon: <Repeat size={14} />,
      action: () => navigate({ to: '/subscriptions' }),
    },
    {
      id: 'page-actions',
      type: 'page',
      label: 'Actions',
      icon: <Zap size={14} />,
      action: () => navigate({ to: '/actions' }),
    },
    {
      id: 'page-review',
      type: 'page',
      label: 'Review',
      icon: <ClipboardCheck size={14} />,
      action: () => navigate({ to: '/review' }),
    },
    {
      id: 'page-search',
      type: 'page',
      label: 'Search',
      icon: <Search size={14} />,
      action: () => navigate({ to: '/transactions' }),
    },
    {
      id: 'page-upload',
      type: 'page',
      label: 'Import Statement',
      icon: <Upload size={14} />,
      action: () => navigate({ to: '/upload' }),
    },
  ]

  // Build result list
  const results: PaletteItem[] = []

  // Filter pages by query
  const q = query.toLowerCase()
  const matchedPages = q
    ? pages.filter((p) => p.label.toLowerCase().includes(q))
    : pages
  results.push(...matchedPages)

  // Add API results when available
  const apiData = match(searchState)
    .with({ status: 'success' }, (s) => s.data)
    .otherwise(() => null)

  if (apiData) {
    for (const cat of apiData.categories) {
      results.push({
        id: `cat-${cat.id}`,
        type: 'category',
        label: cat.name,
        sublabel: 'Category',
        action: () =>
          navigate({ to: '/transactions', search: { category_id: cat.id } }),
      })
    }
    for (const m of apiData.merchants) {
      results.push({
        id: `merchant-${m.merchant}`,
        type: 'merchant',
        label: m.displayName ?? m.merchant,
        sublabel:
          m.displayName && m.displayName !== m.merchant
            ? m.merchant
            : m.category_name
              ? `${m.category_name} · ${m.tx_count} txns`
              : `${m.tx_count} txns`,
        action: () =>
          navigate({ to: '/transactions', search: { q: m.merchant } }),
      })
    }
  }

  const isLoading = searchState.status === 'loading'

  const errorMessage = match(searchState)
    .with({ status: 'error' }, (s) =>
      match(s.error)
        .with({ type: 'network' }, (e) => `Network error: ${e.message}`)
        .with({ type: 'http' }, (e) => `Server error: ${e.message}`)
        .with({ type: 'parse' }, () => 'Failed to parse response')
        .exhaustive(),
    )
    .otherwise(() => null)

  const handleSelect = useCallback(
    (index: number) => {
      if (results[index]) {
        onClose()
        results[index].action()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, onClose],
  )

  // Focus + reset when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setSearchState({ status: 'idle' })
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  if (!open) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleSelect(selectedIndex)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  const renderGroup = (type: PaletteItem['type'], heading: string) => {
    const items = results.filter((r) => r.type === type)
    if (items.length === 0) return null

    return (
      <div>
        <div className="px-4 py-1 mt-1 first:mt-0 text-[10px] font-medium uppercase tracking-wider text-gray-40">
          {heading}
        </div>
        {items.map((r) => {
          const idx = results.indexOf(r)
          return (
            <button
              key={r.id}
              onClick={() => handleSelect(idx)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                idx === selectedIndex
                  ? 'bg-brand/10 text-brand'
                  : 'text-gray-80 hover:bg-surface-alt'
              }`}
              dir={type === 'merchant' ? 'auto' : undefined}
            >
              {type === 'page' && (
                <span className="text-gray-40">{r.icon}</span>
              )}
              {type === 'category' && (
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${CATEGORY_COLORS[r.label] || 'bg-gray-40'}`}
                />
              )}
              <span className={type === 'merchant' ? 'truncate' : ''}>
                <bdi dir="auto">{r.label}</bdi>
              </span>
              {r.sublabel && (
                <span className="ml-auto text-xs text-gray-40 whitespace-nowrap shrink-0">
                  <bdi dir="auto">{r.sublabel}</bdi>
                </span>
              )}
              {idx === selectedIndex && (
                <ArrowRight
                  size={12}
                  className={`${!r.sublabel ? 'ml-auto' : ''} text-brand shrink-0`}
                />
              )}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-lg bg-surface border border-gray-10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-10">
          {isLoading ? (
            <Loader2 size={18} className="text-brand shrink-0 animate-spin" />
          ) : (
            <Search size={18} className="text-gray-40 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, categories, merchants..."
            className="flex-1 bg-transparent text-gray-100 text-sm outline-none placeholder:text-gray-40"
          />
          <kbd className="text-[10px] text-gray-40 bg-surface-alt border border-gray-10 rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {errorMessage && (
            <p className="text-negative text-xs text-center py-3 px-4">
              {errorMessage}
            </p>
          )}
          {results.length === 0 && !isLoading ? (
            <p className="text-gray-40 text-sm text-center py-6">
              No results found
            </p>
          ) : (
            <>
              {renderGroup('page', 'Pages')}
              {renderGroup('category', 'Categories')}
              {renderGroup('merchant', 'Merchants')}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-10 text-[10px] text-gray-40">
          <span>
            <kbd className="bg-surface-alt border border-gray-10 rounded px-1 py-0.5 mr-1">
              ↑↓
            </kbd>
            Navigate
          </span>
          <span>
            <kbd className="bg-surface-alt border border-gray-10 rounded px-1 py-0.5 mr-1">
              ↵
            </kbd>
            Open
          </span>
          <span>
            <kbd className="bg-surface-alt border border-gray-10 rounded px-1 py-0.5 mr-1">
              esc
            </kbd>
            Close
          </span>
        </div>
      </div>
    </div>
  )
}
