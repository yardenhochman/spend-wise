import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { match } from 'ts-pattern'
import { ArrowUpRight, Check, CircleAlert, Eye, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getHomeBrief } from '@/lib/api'
import type { BriefResponse } from '@/lib/types'
import { cn } from '@/lib/utils'
import { HomeResource } from './HomeState'

type Notice = BriefResponse['notices'][number]

function NoticeCard({ notice }: { notice: Notice }) {
  const [copied, setCopied] = useState(false)
  const [clipboardFailed, setClipboardFailed] = useState(false)
  const presentation = match(notice.severity)
    .with('action', () => ({
      label: 'Action',
      Icon: CircleAlert,
      color: 'text-destructive',
      border: 'border-destructive/35',
    }))
    .with('watch', () => ({
      label: 'Watch',
      Icon: Eye,
      color: 'text-(--color-cat-insurance)',
      border: 'border-(--color-cat-insurance)/25',
    }))
    .with('info', () => ({
      label: 'Info',
      Icon: Info,
      color: 'text-muted-foreground',
      border: 'border-border',
    }))
    .exhaustive()
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(notice.agentPrompt)
      setCopied(true)
      setClipboardFailed(false)
    } catch {
      setClipboardFailed(true)
      setCopied(false)
    }
  }
  const points = notice.chart?.points ?? []
  const min = Math.min(...points)
  const max = Math.max(...points)
  const { Icon } = presentation
  return (
    <article
      className={cn(
        'rounded-xl border bg-card/40 px-4 pt-3.5 pb-1',
        presentation.border,
      )}
    >
      <div
        className={cn(
          'mb-1.5 flex items-center gap-1.5 text-xs font-medium',
          presentation.color,
        )}
      >
        <Icon size={14} aria-hidden="true" />
        {presentation.label}
      </div>
      <h3 className="text-[15px] font-semibold leading-snug" dir="auto">
        {notice.title}
      </h3>
      <p
        className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground"
        dir="auto"
      >
        {notice.body}
      </p>
      {points.length > 1 && (
        <svg
          viewBox="0 0 320 48"
          className="mt-3 h-12 w-full"
          role="img"
          aria-label={`Trend, oldest to newest: ${points.join(', ')}`}
        >
          <polyline
            points={points
              .map(
                (p, i) =>
                  `${4 + (i / (points.length - 1)) * 312},${42 - ((p - min) / (max - min || 1)) * 35}`,
              )
              .join(' ')}
            stroke="var(--color-cat-insurance)"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <div className="mt-1 flex justify-end">
        <Button
          variant="ghost"
          className="min-h-11 px-0 text-xs text-primary hover:bg-transparent hover:underline"
          onClick={() => void copyPrompt()}
          aria-label={`Ask an agent: ${notice.title}`}
        >
          {copied ? <Check size={14} /> : <ArrowUpRight size={14} />}
          {copied ? 'Prompt copied' : 'Ask an agent'}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {copied ? 'Agent prompt copied to clipboard.' : ''}
      </p>
      {clipboardFailed && (
        <div className="mb-3 space-y-2">
          <label className="block text-xs text-muted-foreground">
            Clipboard unavailable. Select and copy this prompt:
            <textarea
              readOnly
              value={notice.agentPrompt}
              onFocus={(e) => e.target.select()}
              className="mt-2 min-h-28 w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          </label>
        </div>
      )}
    </article>
  )
}

function Brief({ data }: { data: BriefResponse }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Week of {format(parseISO(data.weekOf), 'd MMM')}
      </p>
      <h2 className="mt-2 mb-6 max-w-80 text-2xl font-semibold leading-tight tracking-tight">
        {data.headline}
      </h2>
      <div className="space-y-3">
        {data.notices.map((notice) => (
          <NoticeCard key={notice.id} notice={notice} />
        ))}
      </div>
      {data.notices.length === 0 && (
        <p className="py-8 text-sm text-muted-foreground">
          Nothing new to flag this week.
        </p>
      )}
      <footer className="mt-7 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          {Math.round(data.coverage.uncategorizedShare * 1000) / 10}% of
          activity uncategorized
        </p>
        <p className="mt-1">
          {data.coverage.lastImportAt
            ? `Last import ${format(parseISO(data.coverage.lastImportAt), 'd MMM yyyy, HH:mm')}`
            : 'No imports recorded yet'}
        </p>
      </footer>
    </>
  )
}

export default function BriefMode() {
  return (
    <HomeResource load={getHomeBrief}>
      {(data) => <Brief data={data} />}
    </HomeResource>
  )
}
