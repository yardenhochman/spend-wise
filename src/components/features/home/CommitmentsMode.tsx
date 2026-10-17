import MerchantName from '@/components/app/MerchantName'
import { Dialog } from '@base-ui/react/dialog'
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { match } from 'ts-pattern'
import { Check, Minus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  confirmHomeObligation,
  dismissHomeObligation,
  getHomeCommitments,
  markObligationMonth,
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
    .with(
      'external',
      () => 'border border-muted-foreground bg-muted text-muted-foreground',
    )
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
        .with('none', 'external', () => <Minus size={9} aria-hidden="true" />)
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
  const [monthUpdates, setMonthUpdates] = useState<
    Record<string, CommitmentsResponse['obligations'][number]['trail'][number]>
  >({})
  const [selected, setSelected] = useState<{
    id: string
    month: string
  } | null>(null)
  const [markNote, setMarkNote] = useState('')
  const [markError, setMarkError] = useState<string | null>(null)
  const selectedItem = data.obligations.find((o) => o.id === selected?.id)
  const selectedTrail =
    selectedItem && selected
      ? (monthUpdates[`${selected.id}:${selected.month}`] ??
        selectedItem.trail.find((t) => t.month === selected.month))
      : undefined
  async function markMonth(status: 'paid' | 'clear') {
    if (!selected || !selectedTrail) return
    setPendingId(selected.id)
    setMarkError(null)
    const result = await markObligationMonth(
      selected.id,
      selected.month,
      status,
      markNote || undefined,
      preview,
    )
    if (result.isErr()) setMarkError(apiErrorMessage(result.error))
    else {
      const fresh = await getHomeCommitments()
      if (fresh.isErr()) setMarkError(apiErrorMessage(fresh.error))
      else {
        const trail = preview
          ? {
              ...selectedTrail,
              status: status === 'paid' ? ('paid' as const) : ('due' as const),
              markedByYou: status === 'paid',
              manualNote: markNote,
            }
          : fresh.value.data.obligations
              .find((o) => o.id === selected.id)
              ?.trail.find((t) => t.month === selected.month)
        if (trail)
          setMonthUpdates((updates) => ({
            ...updates,
            [`${selected.id}:${selected.month}`]: trail,
          }))
        setAnnouncement(
          status === 'paid' ? 'Month marked as paid.' : 'Manual mark cleared.',
        )
      }
    }
    setPendingId(null)
  }
  const currentMonth = data.months.at(-1) ?? format(new Date(), 'yyyy-MM')
  const confirmed = (id: string, existing: boolean) =>
    existing || confirmedIds.includes(id)
  const obligations = data.obligations
    .filter((o) => !dismissedIds.includes(o.id))
    .map((o) => ({
      ...o,
      trail: o.trail.map((t) => monthUpdates[`${o.id}:${t.month}`] ?? t),
    }))
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
  async function confirmAll() {
    setPendingId('all')
    setConfirmationError(null)
    const results = await Promise.all(
      obligations
        .filter((o) => !confirmed(o.id, o.confirmed))
        .map(async (o) => ({
          id: o.id,
          result: await confirmHomeObligation(o.id, preview),
        })),
    )
    setConfirmedIds((ids) => [
      ...ids,
      ...results.filter((r) => r.result.isOk()).map((r) => r.id),
    ])
    const failed = results.filter((r) => r.result.isErr()).length
    if (failed)
      setConfirmationError({
        id: 'all',
        message: `${failed} could not be confirmed. Try Confirm all again.`,
      })
    setAnnouncement(
      `${results.length - failed} obligations confirmed. Payment history is unchanged.`,
    )
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
          <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <p>
              These were detected automatically — confirm the ones that are real
            </p>
            <Button
              variant="ghost"
              className="mt-1 min-h-11 min-w-11 px-2 text-xs text-primary"
              disabled={pendingId !== null}
              onClick={() => void confirmAll()}
            >
              {pendingId === 'all' ? 'Confirming…' : 'Confirm all'}
            </Button>
          </div>
        )}
        {confirmationError?.id === 'all' && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {confirmationError.message}
          </p>
        )}
        <div
          className="mt-4 flex justify-end"
          aria-label="Trail months, oldest to newest"
        >
          {data.months.map((month) => (
            <span
              key={month}
              className="w-11 text-center text-[10px] text-muted-foreground"
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
              <div className="flex flex-wrap items-center justify-between gap-x-3">
                <div className="min-w-0">
                  <MerchantName
                    name={item.name}
                    rawMerchant={item.rawMerchant}
                    obligationId={item.id}
                    preview={preview}
                    disabled={pendingId !== null}
                  />
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {item.expectedAmount === null
                      ? 'Amount unknown'
                      : formatILS(item.expectedAmount)}{' '}
                    · {cadence(item.cadence)}
                  </p>
                  {item.paidFrom === 'untracked' && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Paid elsewhere
                      {item.paidFromLabel ? ` · ${item.paidFromLabel}` : ''}
                    </p>
                  )}
                </div>
                <div className="ms-auto flex shrink-0">
                  {data.months.map((month) => {
                    const trail = item.trail.find((t) => t.month === month)
                    const status = trail?.status ?? 'none'
                    return (
                      <button
                        type="button"
                        className="flex size-11 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                        key={month}
                        aria-label={`View ${item.name}, ${formatMonthLabel(month)}`}
                        onClick={() => {
                          setSelected({ id: item.id, month })
                          setMarkNote(trail?.manualNote ?? '')
                          setMarkError(null)
                        }}
                      >
                        <TrailDot
                          status={status}
                          label={`${item.name}, ${formatMonthLabel(month)}: ${status === 'none' ? 'no payment expected' : status === 'external' ? 'paid elsewhere' : status}${trail?.amount !== null && trail?.amount !== undefined ? `, ${formatILS(trail.amount)}` : ''}${trail?.markedByYou ? ', marked by you' : ''}`}
                        />
                      </button>
                    )
                  })}
                </div>
              </div>
              {item.trail.some((t) => t.markedByYou) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Marked by you:{' '}
                  {item.trail
                    .filter((t) => t.markedByYou)
                    .map((t) => formatMonthAbbr(t.month))
                    .join(', ')}
                </p>
              )}
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
          {(
            ['paid', 'due', 'late', 'unconfirmed', 'external', 'none'] as const
          ).map((status) => (
            <span key={status} className="inline-flex items-center gap-1">
              <TrailDot status={status} label={status} />
              {status === 'external'
                ? 'Paid elsewhere'
                : status === 'none'
                  ? 'Not expected'
                  : status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
          ))}
        </div>
      </section>
      <Dialog.Root
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Popup className="home-theme fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] max-w-[480px] overflow-y-auto rounded-t-3xl border border-border bg-background p-5 pb-[max(24px,env(safe-area-inset-bottom))] text-foreground shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-semibold">
                  <bdi dir="auto">{selectedItem?.name}</bdi>
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  {selected && formatMonthLabel(selected.month)}
                </Dialog.Description>
              </div>
              <Dialog.Close
                render={<Button variant="ghost" className="size-11 shrink-0" />}
                aria-label="Close payment details"
              >
                <X size={20} />
              </Dialog.Close>
            </div>
            {selectedTrail?.payments?.map((payment, i) => (
              <div
                key={i}
                className="mt-4 flex items-center justify-between gap-4 border-b border-border pb-4"
              >
                <div className="min-w-0">
                  <bdi dir="auto" className="block break-words">
                    {payment.payee}
                  </bdi>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {format(parseISO(payment.date), 'd MMM yyyy')}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">
                  {formatILS(payment.amount)}
                </span>
              </div>
            ))}
            {selectedTrail?.markedByYou && (
              <p className="mt-4 text-sm">
                Marked by you
                {selectedTrail.manualNote
                  ? ` · ${selectedTrail.manualNote}`
                  : ''}
              </p>
            )}
            {selectedTrail?.status === 'external' && (
              <p className="mt-4">
                Paid elsewhere
                {selectedItem?.paidFromLabel
                  ? ` · ${selectedItem.paidFromLabel}`
                  : ''}
              </p>
            )}
            {!selectedTrail?.payments?.length &&
              !selectedTrail?.markedByYou &&
              selectedTrail?.status !== 'external' && (
                <p className="mt-4 text-sm text-muted-foreground">
                  No matching payment found.
                </p>
              )}
            {(!selectedTrail?.payments?.length ||
              selectedTrail.markedByYou) && (
              <div className="mt-5 space-y-3">
                {!selectedTrail?.markedByYou && (
                  <label className="block text-sm">
                    Note (optional)
                    <input
                      value={markNote}
                      onChange={(event) => setMarkNote(event.target.value)}
                      maxLength={500}
                      className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-base"
                    />
                  </label>
                )}
                <Button
                  className="min-h-11 w-full"
                  disabled={pendingId !== null}
                  onClick={() =>
                    void markMonth(
                      selectedTrail?.markedByYou ? 'clear' : 'paid',
                    )
                  }
                >
                  {pendingId
                    ? 'Saving…'
                    : selectedTrail?.markedByYou
                      ? 'Clear mark'
                      : 'Mark as paid'}
                </Button>
              </div>
            )}
            {markError && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {markError}
              </p>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
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
                <MerchantName
                  name={item.merchant}
                  rawMerchant={item.rawMerchant}
                  preview={preview}
                />
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
