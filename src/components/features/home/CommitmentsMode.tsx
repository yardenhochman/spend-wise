import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { match } from 'ts-pattern'
import { Check, Minus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  confirmHomeObligation,
  dismissHomeObligation,
  getHomeCommitments,
} from '@/lib/api'
import type { CommitmentsResponse, TrailStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatILS } from '@/utils/currency'
import { formatMonthAbbr, formatMonthLabel } from '@/utils/dates'
import { apiErrorMessage, HomeResource } from './HomeState'
import { paymentCounts } from './presentation'

function TrailDot({ status, label }: { status: TrailStatus; label: string }) {
  const style = match(status)
    .with('paid', () => 'bg-(--color-positive) text-background')
    .with('due', () => 'border-2 border-(--color-cat-insurance)')
    .with('late', () => 'bg-destructive text-background')
    .with(
      'unconfirmed',
      () =>
        'border border-dashed border-muted-foreground text-muted-foreground',
    )
    .with('none', () => 'bg-muted/50 text-muted-foreground')
    .exhaustive()
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-3.5 shrink-0 items-center justify-center rounded-[4px]',
        style,
      )}
    >
      {match(status)
        .with('paid', () => <Check size={10} aria-hidden="true" />)
        .with('late', () => <X size={10} aria-hidden="true" />)
        .with('none', () => <Minus size={9} aria-hidden="true" />)
        .with('unconfirmed', () => (
          <span className="text-[9px]" aria-hidden="true">
            ?
          </span>
        ))
        .with('due', () => null)
        .exhaustive()}
    </span>
  )
}

const cadence = (
  value: CommitmentsResponse['obligations'][number]['cadence'],
) =>
  match(value)
    .with('monthly', () => 'monthly')
    .with('bimonthly', () => 'every 2 months')
    .with('yearly', () => 'yearly')
    .with('irregular', () => 'irregular')
    .exhaustive()

function Commitments({
  data,
  preview,
}: {
  data: CommitmentsResponse
  preview: boolean
}) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const [confirmedIds, setConfirmedIds] = useState<string[]>([])
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [confirmationError, setConfirmationError] = useState<{
    id: string
    message: string
  } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const currentMonth = data.months.at(-1) ?? format(new Date(), 'yyyy-MM')
  const confirmed = (id: string, existing: boolean) =>
    existing || confirmedIds.includes(id)
  const obligations = data.obligations.filter(
    (o) => !dismissedIds.includes(o.id),
  )
  const counts = paymentCounts(obligations, currentMonth)
  const hasSuggestions = obligations.some((o) => !confirmed(o.id, o.confirmed))
  async function dismiss(id: string, name: string) {
    setPendingId(id)
    setConfirmationError(null)
    const result = await dismissHomeObligation(id, preview)
    if (result.isErr())
      setConfirmationError({ id, message: apiErrorMessage(result.error) })
    else {
      setDismissedIds((ids) => [...ids, id])
      setAnnouncement(`${name} dismissed${preview ? ' in this demo' : ''}.`)
    }
    setPendingId(null)
  }
  async function confirm(id: string, name: string) {
    setPendingId(id)
    setConfirmationError(null)
    const result = await confirmHomeObligation(id, preview)
    if (result.isErr())
      setConfirmationError({ id, message: apiErrorMessage(result.error) })
    else {
      setConfirmedIds((ids) => [...ids, id])
      setAnnouncement(
        `${name} confirmed${preview ? ' in this demo' : ''}. Payment history is unchanged.`,
      )
    }
    setPendingId(null)
  }
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        {formatMonthLabel(currentMonth)}
      </p>
      <div
        className="flex flex-wrap gap-2"
        aria-label="Current month payment counts"
      >
        <span className="rounded-full bg-(--color-positive)/10 px-3 py-1.5 text-xs font-medium text-(--color-positive)">
          {counts.paid} paid
        </span>
        <span className="rounded-full bg-(--color-cat-insurance)/10 px-3 py-1.5 text-xs font-medium text-(--color-cat-insurance)">
          {counts.due} due
        </span>
        <span className="rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
          {counts.late} late
        </span>
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <section className="mt-7" aria-labelledby="obligations-title">
        <h2 id="obligations-title" className="text-sm font-semibold">
          Obligations{' '}
          <span className="font-normal text-muted-foreground">
            · last 6 months
          </span>
        </h2>
        {hasSuggestions && (
          <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            These were detected automatically — confirm the ones that are real
          </p>
        )}
        <div
          className="mt-4 flex justify-end gap-1.5"
          aria-label="Trail months, oldest to newest"
        >
          {data.months.map((month) => (
            <span
              key={month}
              className="w-5 text-center text-[10px] text-muted-foreground"
              title={formatMonthLabel(month)}
            >
              {formatMonthAbbr(month).split(' ')[0]}
            </span>
          ))}
        </div>
        {obligations.length === 0 && (
          <p className="py-5 text-sm text-muted-foreground">
            No obligations identified yet. Import statements to start building
            your payment history.
          </p>
        )}
        <ul className="divide-y divide-border">
          {obligations.map((item) => (
            <li key={item.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-start text-sm font-medium">
                    <bdi dir="auto">{item.name}</bdi>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {item.expectedAmount === null
                      ? 'Amount unknown'
                      : formatILS(item.expectedAmount)}{' '}
                    · {cadence(item.cadence)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {data.months.map((month) => {
                    const trail = item.trail.find((t) => t.month === month)
                    const status = trail?.status ?? 'none'
                    return (
                      <span className="flex w-5 justify-center" key={month}>
                        <TrailDot
                          status={status}
                          label={`${item.name}, ${formatMonthLabel(month)}: ${status === 'none' ? 'no payment expected' : status}${trail?.amount !== null && trail?.amount !== undefined ? `, ${formatILS(trail.amount)}` : ''}`}
                        />
                      </span>
                    )
                  })}
                </div>
              </div>
              {item.note && (
                <p
                  className={cn(
                    'mt-1 text-xs',
                    item.trail.some(
                      (t) => t.month === currentMonth && t.status === 'late',
                    )
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                  dir="ltr"
                >
                  {item.note}
                </p>
              )}
              {!confirmed(item.id, item.confirmed) && (
                <div className="mt-1 flex items-center gap-1">
                  <Button
                    variant="ghost"
                    className="min-h-11 min-w-11 gap-1 px-2 text-xs text-primary"
                    disabled={pendingId !== null}
                    onClick={() => void confirm(item.id, item.name)}
                    aria-label={`Confirm ${item.name}`}
                  >
                    <Check size={14} aria-hidden="true" /> Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-11 min-w-11 gap-1 px-2 text-xs text-muted-foreground"
                    disabled={pendingId !== null}
                    onClick={() => void dismiss(item.id, item.name)}
                    aria-label={`Dismiss ${item.name}`}
                  >
                    <X size={14} aria-hidden="true" /> Dismiss
                  </Button>
                </div>
              )}
              {confirmationError?.id === item.id && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {confirmationError.message}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div
          className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-[10px] text-muted-foreground"
          aria-label="Payment history legend"
        >
          {(['paid', 'due', 'late', 'unconfirmed', 'none'] as const).map(
            (status) => (
              <span key={status} className="inline-flex items-center gap-1">
                <TrailDot status={status} label={status} />
                {status === 'none'
                  ? 'Not expected'
                  : status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
            ),
          )}
        </div>
      </section>
      <section className="mt-7" aria-labelledby="repayments-title">
        <h2 id="repayments-title" className="mb-2 text-sm font-semibold">
          Repayments
        </h2>
        {data.repayments.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">
            No repayments tracked.
          </p>
        )}
        {data.repayments.map((item) => {
          const progress =
            item.original !== null && item.original > 0
              ? Math.max(
                  0,
                  Math.min(100, (1 - item.remaining / item.original) * 100),
                )
              : null
          return (
            <div key={item.id} className="border-b border-border py-3">
              <div className="flex justify-between gap-3 text-sm">
                <bdi className="text-start font-medium" dir="auto">
                  {item.name}
                </bdi>
                <span className="tabular-nums">
                  {formatILS(item.remaining)} left
                </span>
              </div>
              {progress !== null ? (
                <div
                  role="progressbar"
                  aria-label={`${item.name} repaid`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress)}
                  aria-valuetext={`${Math.round(progress)}% repaid, ${formatILS(item.remaining)} remaining`}
                  className="my-2 h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              ) : (
                <p className="my-2 text-xs text-muted-foreground">
                  Original balance unknown
                </p>
              )}
              <p className="text-xs text-muted-foreground tabular-nums">
                {item.monthly === null
                  ? 'Monthly amount unknown'
                  : `${formatILS(item.monthly)}/mo`}
                {item.original !== null && ` · of ${formatILS(item.original)}`}
                {item.endDate &&
                  ` · ends ${format(parseISO(item.endDate), 'MMM yyyy')}`}
              </p>
            </div>
          )
        })}
      </section>
      <section className="mt-7" aria-labelledby="recurring-title">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 id="recurring-title" className="text-sm font-semibold">
            Recurring
          </h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatILS(data.recurring.annualTotal)}/year
          </span>
        </div>
        {data.recurring.items.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">
            No recurring charges detected yet.
          </p>
        )}
        <ul className="divide-y divide-border">
          {data.recurring.items.map((item, index) => (
            <li
              key={`${item.merchant}-${index}`}
              className="flex justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="text-start text-sm font-medium">
                  <bdi dir="auto">{item.merchant}</bdi>
                </p>
                {item.flag && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {match(item.flag)
                      .with('new', () => 'New')
                      .with('price-up', () => 'Price up')
                      .with('price-down', () => 'Price down')
                      .with('renewal-soon', () => 'Renewal soon')
                      .exhaustive()}
                    {item.flagDetail && ` · ${item.flagDetail}`}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-sm tabular-nums">
                {formatILS(item.amount)}
                {match(item.cadence)
                  .with('monthly', () => '/mo')
                  .with('yearly', () => '/yr')
                  .with('other', () => ' / charge')
                  .exhaustive()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

export default function CommitmentsMode() {
  return (
    <HomeResource load={getHomeCommitments}>
      {(data, preview) => <Commitments data={data} preview={preview} />}
    </HomeResource>
  )
}
