import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Link, useSearch } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Eye,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getHomeBrief } from '@/lib/api'
import type { BriefResponse } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatILS } from '@/utils/currency'
import DataThrough from './DataThrough'
import { HomeResource } from './HomeState'

type Notice = BriefResponse['notices'][number]

const severityStyle = {
  action: {
    Icon: CircleAlert,
    color: 'text-destructive',
    border: 'border-destructive/35',
  },
  watch: {
    Icon: Eye,
    color: 'text-(--color-cat-insurance)',
    border: 'border-(--color-cat-insurance)/25',
  },
  info: { Icon: Info, color: 'text-muted-foreground', border: 'border-border' },
}

function AskAgent({ notice }: { notice: Notice }) {
  const [copied, setCopied] = useState(false)
  const [clipboardFailed, setClipboardFailed] = useState(false)
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
  return (
    <>
      <Button
        variant="ghost"
        className="min-h-11 px-0 text-xs text-primary hover:bg-transparent hover:underline dark:hover:bg-transparent"
        onClick={() => void copyPrompt()}
        aria-label={`Ask an agent: ${notice.title}`}
      >
        {copied ? <Check size={14} /> : <ArrowUpRight size={14} />}
        {copied ? 'Prompt copied' : 'Ask an agent'}
      </Button>
      <p role="status" className="sr-only">
        {copied ? 'Agent prompt copied to clipboard.' : ''}
      </p>
      {clipboardFailed && (
        <label className="mb-3 block text-xs text-muted-foreground">
          Clipboard unavailable. Select and copy this prompt:
          <textarea
            readOnly
            value={notice.agentPrompt}
            onFocus={(e) => e.target.select()}
            className="mt-2 min-h-28 w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          />
        </label>
      )}
    </>
  )
}

function Evidence({ notice }: { notice: Notice }) {
  return (
    <div className="mt-1">
      <ul className="divide-y divide-border border-t border-border">
        {notice.evidence.map((row) => (
          <li key={row.id} className="flex items-start gap-3 py-2 text-[13px]">
            <time
              dateTime={row.date}
              className="w-12 shrink-0 text-xs leading-5 tabular-nums text-muted-foreground"
            >
              {format(parseISO(row.date), 'd MMM')}
            </time>
            <div className="min-w-0 flex-1 leading-5">
              <bdi dir="auto" className="break-words">
                {row.label}
              </bdi>
              {row.rawMerchant && (
                <span className="block text-xs text-muted-foreground">
                  <bdi dir="auto" className="break-words">
                    {row.rawMerchant}
                  </bdi>
                </span>
              )}
            </div>
            <span className="shrink-0 leading-5 tabular-nums">
              {formatILS(row.amount)}
            </span>
          </li>
        ))}
      </ul>
      {notice.evidenceCount > notice.evidence.length && (
        <p className="pt-2 text-xs text-muted-foreground">
          Latest {notice.evidence.length} of {notice.evidenceCount}.
        </p>
      )}
    </div>
  )
}

function NoticeCard({ notice }: { notice: Notice }) {
  const [open, setOpen] = useState(false)
  const { Icon, color, border } = severityStyle[notice.severity]
  const points = notice.chart?.points ?? []
  const min = Math.min(...points)
  const max = Math.max(...points)
  const count = notice.evidenceCount
  return (
    <article className={cn('rounded-xl border bg-card/40 px-4 pt-3.5', border)}>
      <h3
        className="flex gap-2 text-[15px] font-semibold leading-snug"
        dir="ltr"
      >
        <Icon
          size={16}
          className={cn('mt-0.5 shrink-0', color)}
          aria-label={notice.severity === 'action' ? 'Action needed' : 'Watch'}
        />
        <span>{notice.title}</span>
      </h3>
      <p
        className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground"
        dir="ltr"
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
      <div className="mt-1 flex items-center justify-between gap-3">
        {count > 0 ? (
          <Button
            variant="ghost"
            className="min-h-11 px-0 text-xs font-medium hover:bg-transparent hover:underline dark:hover:bg-transparent"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDown
              size={14}
              className={cn('transition-transform', open && 'rotate-180')}
              aria-hidden="true"
            />
            {count === 1 ? 'See the transaction' : `See ${count} transactions`}
          </Button>
        ) : (
          <span />
        )}
        <AskAgent notice={notice} />
      </div>
      {open && <Evidence notice={notice} />}
      {open && <div className="h-2" />}
    </article>
  )
}

function ReviewLink({ count }: { count: number }) {
  const { fixtures } = useSearch({ strict: false }) as { fixtures?: 1 }
  return (
    <Link
      to="/categorize"
      search={{ fixtures }}
      className="flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      Review {count === 1 ? '1 merchant' : `${count} merchants`}, largest first
      <ChevronRight size={16} aria-hidden="true" />
    </Link>
  )
}

function QuietNotice({
  notice,
  reviewCount,
}: {
  notice: Notice
  reviewCount: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center gap-2 py-2 text-start text-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="min-w-0 flex-1" dir="ltr">
          {notice.title}
        </span>
        <ChevronDown
          size={16}
          className={cn(
            'shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      {reviewCount > 0 && <ReviewLink count={reviewCount} />}
      {open && (
        <div className="pb-2">
          <p
            className="text-[13px] leading-relaxed text-muted-foreground"
            dir="ltr"
          >
            {notice.body}
          </p>
          {notice.evidenceCount > 0 && <Evidence notice={notice} />}
          <div className="flex justify-end">
            <AskAgent notice={notice} />
          </div>
        </div>
      )}
    </li>
  )
}

function Brief({ data }: { data: BriefResponse }) {
  const main = data.notices.filter((n) => n.severity !== 'info')
  const quiet = data.notices.filter((n) => n.severity === 'info')
  const reviewCount = data.coverage.reviewMerchants ?? 0
  const coverageNotice = data.notices.find((n) =>
    n.title.endsWith('of recent transactions are uncategorized'),
  )
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Week of {format(parseISO(data.weekOf), 'd MMM')}
      </p>
      <h2 className="mt-2 max-w-80 text-2xl font-semibold leading-tight tracking-tight text-balance">
        {data.headline}
      </h2>
      <DataThrough items={data.coverage.freshness} className="mt-3" />
      {main.length > 0 && (
        <div className="mt-6 space-y-3">
          {main.map((notice) => (
            <NoticeCard key={notice.id} notice={notice} />
          ))}
        </div>
      )}
      {quiet.length > 0 && (
        <section className="mt-7" aria-labelledby="also-noticed">
          <h3
            id="also-noticed"
            className="border-b border-border pb-2 text-sm font-semibold"
          >
            Also noticed
          </h3>
          <ul className="divide-y divide-border">
            {quiet.map((notice) => (
              <QuietNotice
                key={notice.id}
                notice={notice}
                reviewCount={notice === coverageNotice ? reviewCount : 0}
              />
            ))}
          </ul>
        </section>
      )}
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
        {!coverageNotice && reviewCount > 0 && (
          <ReviewLink count={reviewCount} />
        )}
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
