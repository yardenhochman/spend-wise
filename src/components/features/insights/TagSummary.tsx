import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { getTagSummaries } from '@/lib/api'
import type { TagSummary as Summary } from '@/lib/types'
import { useViewMode } from '@/lib/view-mode'
import { formatILS } from '@/utils/currency'

export default function TagSummary({ selectedTag }: { selectedTag?: string }) {
  const { mode, excludedKinds } = useViewMode()
  const [items, setItems] = useState<Summary[]>([])
  const [selected, setSelected] = useState(selectedTag ?? '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    getTagSummaries({ view_mode: mode, excluded_kinds: excludedKinds }).then(
      (result) => {
        if (!active) return
        if (result.isErr()) setError(result.error.message)
        else setItems(result.value.items)
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [mode, excludedKinds])
  const summary =
    items.find((t) => t.id === selected || t.name === selected) ?? items[0]
  if (loading)
    return (
      <p role="status" className="text-gray-60">
        Loading tags…
      </p>
    )
  if (error)
    return (
      <p role="alert" className="text-negative">
        {error}
      </p>
    )
  if (!summary)
    return (
      <p className="text-gray-60">
        Add tags to transactions to track a trip or project.
      </p>
    )
  return (
    <section className="space-y-5">
      <label className="block text-sm text-gray-60">
        Trip or tag
        <select
          aria-label="Trip or tag"
          value={summary.id}
          onChange={(e) => setSelected(e.target.value)}
          className="block mt-2 w-full bg-surface border border-gray-20 rounded-xl p-3 text-gray-100"
        >
          {items.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-gray-100" dir="auto">
            {summary.name}
          </h3>
          {summary.start_date && summary.end_date && (
            <p className="text-gray-60 text-sm">
              {summary.start_date} – {summary.end_date} · {summary.days} days
            </p>
          )}
        </div>
        <Link
          to="/transactions"
          search={{ tag_id: summary.id }}
          className="text-brand underline"
        >
          View {summary.count} transactions →
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          ['Net cost', summary.net],
          ['Charges', summary.gross],
          ['Refunds', summary.refunds],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="bg-surface rounded-2xl border border-gray-10 p-5"
          >
            <p className="text-sm text-gray-60">{label}</p>
            <p className="text-2xl font-bold text-gray-100 mt-2">
              {Number(value) < 0 ? '−' : ''}
              {formatILS(Number(value))}
            </p>
          </div>
        ))}
      </div>
      <p className="text-gray-60 text-sm">
        {summary.per_day !== null && (
          <>
            Average per day: {summary.per_day < 0 ? '−' : ''}
            {formatILS(summary.per_day)} ·{' '}
          </>
        )}
        All purchase dates included. Refunds reduce cost. Internal transfers
        excluded.
      </p>
      {summary.estimated_count > 0 && (
        <p className="text-gray-80 bg-surface p-3 rounded-xl">
          Includes {summary.estimated_count} estimated ILS amounts; final
          conversion costs are still unverified.
        </p>
      )}
      {summary.review_note && (
        <p
          className="text-gray-80 bg-surface p-3 rounded-xl whitespace-pre-line"
          dir="auto"
        >
          {summary.review_note}
        </p>
      )}
      {summary.subtags.length > 0 && (
        <div className="bg-surface rounded-2xl border border-gray-10 p-5 space-y-3">
          <h4 className="font-semibold text-gray-100">Detail tags</h4>
          {summary.subtags.map((t) => (
            <div
              key={t.id}
              className="flex justify-between gap-3 text-sm text-gray-100"
            >
              <span dir="auto">{t.name}</span>
              <span>
                {t.amount < 0 ? '−' : ''}
                {formatILS(t.amount)}
              </span>
            </div>
          ))}
          <p className="text-xs text-gray-60">
            A transaction can have more than one tag.
          </p>
        </div>
      )}
      <div className="bg-surface rounded-2xl border border-gray-10 p-5 space-y-4">
        <h4 className="font-semibold text-gray-100">Net cost by category</h4>
        {summary.categories.map((c) => (
          <div key={c.name}>
            <div className="flex justify-between gap-3 text-sm text-gray-100">
              <span>{c.name}</span>
              <span>
                {c.amount < 0 ? '−' : ''}
                {formatILS(c.amount)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-10 mt-2">
              <div
                className="h-full rounded-full bg-brand"
                style={{
                  width: `${Math.min(100, (Math.max(0, c.amount) / Math.max(1, summary.gross)) * 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
