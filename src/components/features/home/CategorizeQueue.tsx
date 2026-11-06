import { useEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Link, useSearch } from '@tanstack/react-router'
import { Check, ChevronLeft, Loader2, RefreshCw, Undo2 } from 'lucide-react'
import { okAsync } from 'neverthrow'
import { Button } from '@/components/ui/button'
import {
  applyReviewAnswer,
  getHomeReviewQueue,
  undoReviewAnswer,
} from '@/lib/api'
import type { ApiError } from '@/lib/api'
import { CATEGORY_HEX_COLORS } from '@/lib/constants'
import type {
  ReviewApplied,
  ReviewQueueItem,
  ReviewQueueResponse,
} from '@/lib/types'
import { formatILS } from '@/utils/currency'
import { apiErrorMessage, HomeResource } from './HomeState'

const QUICK_CATEGORIES = 6
const SKIPPED_KEY = 'spendwise:review-skipped'

type Category = ReviewQueueResponse['categories'][number]
type Answer = {
  item: ReviewQueueItem
  categoryName: string
  applied: ReviewApplied
  position: number
}
type Failure =
  | { kind: 'save'; category: Category; message: string }
  | { kind: 'undo'; message: string }

function readSkipped(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SKIPPED_KEY) ?? '[]')
    return Array.isArray(value) ? (value as string[]) : []
  } catch {
    return []
  }
}

function writeSkipped(keys: string[]) {
  try {
    localStorage.setItem(SKIPPED_KEY, JSON.stringify(keys))
  } catch {
    // Without storage, skips simply last for this visit.
  }
}

function percent(share: number) {
  return `${Math.round(share * 100)}%`
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function saveFailure(error: ApiError) {
  return apiErrorMessage(error).replace('load this view', 'save this answer')
}

function CategoryDot({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full bg-muted-foreground"
      style={{ backgroundColor: CATEGORY_HEX_COLORS[name] }}
    />
  )
}

function CategoryButton({
  category,
  busy,
  pending,
  onPick,
}: {
  category: Category
  busy: boolean
  pending: boolean
  onPick: (category: Category) => void
}) {
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() => onPick(category)}
      className="min-h-11 justify-start gap-2 whitespace-normal px-3 py-2 text-start"
    >
      {pending ? (
        <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
      ) : (
        <CategoryDot name={category.name} />
      )}
      <span className="min-w-0">{category.name}</span>
    </Button>
  )
}

function Merchant({
  item,
  categories,
  busy,
  pendingId,
  failure,
  onPick,
  onSkip,
}: {
  item: ReviewQueueItem
  categories: Category[]
  busy: boolean
  pendingId: string | null
  failure: Failure | null
  onPick: (category: Category) => void
  onSkip: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const retry = useRef<HTMLButtonElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const saveFailed = failure?.kind === 'save' ? failure.category : null
  // The tapped button was disabled while saving, which dropped keyboard focus.
  useEffect(() => {
    if (saveFailed) retry.current?.focus()
  }, [saveFailed])
  const bankNames = item.bankNames.filter(
    (name) => name.trim() !== item.name.trim(),
  )
  const suggestion = item.suggestion
  const others = categories.filter((c) => c.id !== suggestion?.categoryId)
  const shown = showAll ? others : others.slice(0, QUICK_CATEGORIES)
  const reach = item.setsRule
    ? 'Future charges from this merchant will match too.'
    : 'Payments to people vary, so this covers only these charges and sets no rule.'
  return (
    <>
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-[26px] font-semibold leading-tight tracking-tight outline-none"
      >
        <bdi dir="auto" className="break-words">
          {item.name}
        </bdi>
      </h2>
      {bankNames.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Bank name:{' '}
          {bankNames.map((name, i) => (
            <span key={name}>
              {i > 0 && ', '}
              <bdi dir="auto" className="break-words">
                {name}
              </bdi>
            </span>
          ))}
        </p>
      )}
      <p className="mt-3 text-sm tabular-nums">
        <span className="font-semibold">{formatILS(item.total)}</span>
        <span className="text-muted-foreground">
          {' '}
          across {plural(item.count, 'charge')} in 6 months
        </span>
      </p>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {item.examples.map((row) => (
          <li
            key={row.id}
            className="flex items-baseline gap-3 py-2 text-[13px] leading-5"
          >
            <time
              dateTime={row.date}
              className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {format(parseISO(row.date), 'd MMM')}
            </time>
            <span className="min-w-0 flex-1 truncate">
              <bdi dir="auto">{row.label}</bdi>
            </span>
            <span className="shrink-0 tabular-nums">
              {formatILS(row.amount)}
            </span>
          </li>
        ))}
      </ul>
      {(item.count > item.examples.length || item.olderCount > 0) && (
        <p className="mt-2 text-xs text-muted-foreground">
          {item.count > item.examples.length &&
            `Latest ${item.examples.length} of ${item.count}. `}
          {item.olderCount > 0 &&
            `Your answer also covers ${plural(item.olderCount, 'older charge')}.`}
        </p>
      )}

      {failure?.kind === 'save' && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-destructive/35 p-3.5"
        >
          <p className="text-sm font-semibold">
            {failure.category.name} was not saved
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {failure.message}
          </p>
          <Button
            ref={retry}
            className="mt-3 min-h-11 w-full"
            disabled={busy}
            onClick={() => onPick(failure.category)}
          >
            <RefreshCw /> Try {failure.category.name} again
          </Button>
        </div>
      )}

      <section className="mt-6" aria-label="Choose a category">
        {suggestion ? (
          <>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {suggestion.reason}
            </p>
            {saveFailed?.id !== suggestion.categoryId && (
              <Button
                disabled={busy}
                onClick={() =>
                  onPick({
                    id: suggestion.categoryId,
                    name: suggestion.categoryName,
                  })
                }
                className="mt-2.5 min-h-12 w-full text-[15px] font-semibold"
              >
                {pendingId === suggestion.categoryId ? (
                  <Loader2
                    className="motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Check aria-hidden="true" />
                )}
                File as {suggestion.categoryName}
              </Button>
            )}
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            No suggestion: nothing in your rules or history matches this name.
          </p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {reach}
        </p>
        <h3 className="mt-5 text-sm font-semibold">
          {suggestion ? 'Or choose another' : 'Choose a category'}
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {shown.map((category) => (
            <CategoryButton
              key={category.id}
              category={category}
              busy={busy}
              pending={pendingId === category.id}
              onPick={onPick}
            />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {others.length > QUICK_CATEGORIES ? (
            <Button
              variant="ghost"
              className="min-h-11"
              aria-expanded={showAll}
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? 'Fewer categories' : 'All categories'}
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={busy}
            onClick={onSkip}
          >
            Skip for now
          </Button>
        </div>
      </section>
    </>
  )
}

function Finished({
  answered,
  transactions,
  startShare,
  share,
  empty,
  skipped,
  briefSearch,
  onReviewSkipped,
}: {
  answered: number
  transactions: number
  startShare: number
  share: number
  empty: boolean
  skipped: number
  briefSearch: { mode: 'brief'; fixtures?: 1 }
  onReviewSkipped: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  return (
    <div className="pt-6">
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-[26px] font-semibold leading-tight tracking-tight outline-none"
      >
        {empty
          ? 'Nothing to review'
          : skipped > 0
            ? `${plural(skipped, 'merchant')} skipped`
            : 'All reviewed'}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {empty
          ? 'Every recent charge has a category.'
          : answered > 0
            ? `You filed ${plural(transactions, 'charge')} from ${plural(answered, 'merchant')}. Uncategorized spending ${
                percent(share) === percent(startShare)
                  ? `stays at ${percent(share)}, because those charges fall outside the recent window`
                  : `is now ${percent(share)}, down from ${percent(startShare)}`
              }.`
            : `Nothing was filed. Recent spending is still ${percent(share)} uncategorized.`}
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Button
          className="min-h-12 text-[15px] font-semibold"
          render={<Link to="/" search={briefSearch} />}
          nativeButton={false}
        >
          Back to Brief
        </Button>
        {skipped > 0 && (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={onReviewSkipped}
          >
            Review the skipped {skipped === 1 ? 'merchant' : 'merchants'}
          </Button>
        )}
      </div>
    </div>
  )
}

function Queue({
  data,
  preview,
}: {
  data: ReviewQueueResponse
  preview: boolean
}) {
  const { fixtures } = useSearch({ strict: false }) as { fixtures?: 1 }
  const briefSearch = { mode: 'brief' as const, fixtures }
  const [remaining, setRemaining] = useState(() => {
    const skipped = new Set(readSkipped())
    return [
      ...data.items.filter((item) => !skipped.has(item.key)),
      ...data.items.filter((item) => skipped.has(item.key)),
    ]
  })
  const [position, setPosition] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [share, setShare] = useState(data.uncategorizedShare)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const busy = pendingId !== null || undoing
  const total = data.items.length
  const current = remaining[position] as ReviewQueueItem | undefined
  const latest = answers.at(-1)

  function answered(
    item: ReviewQueueItem,
    category: Category,
    applied: ReviewApplied,
    newShare: number,
  ) {
    setAnswers((list) => [
      ...list,
      { item, categoryName: category.name, applied, position },
    ])
    setRemaining((list) => list.filter((row) => row.key !== item.key))
    setShare(newShare)
    writeSkipped(readSkipped().filter((key) => key !== item.key))
  }

  function pick(category: Category) {
    if (!current || busy) return
    const item = current
    setFailure(null)
    setPendingId(category.id)
    const save = preview
      ? okAsync<
          { applied: ReviewApplied; uncategorizedShare: number },
          ApiError
        >({
          applied: {
            key: item.key,
            categoryId: category.id,
            transactionIds: Array.from(
              { length: item.count },
              (_, index) => `${item.key}-${index}`,
            ),
            createdRuleIds: [],
            changedRules: [],
          },
          uncategorizedShare: share * ((total - answers.length - 1) / total),
        })
      : applyReviewAnswer(item.key, category.id)
    void save
      .match(
        ({ applied, uncategorizedShare }) =>
          answered(item, category, applied, uncategorizedShare),
        (error) => {
          // Someone else already filed these charges; there is nothing to keep.
          if (error.type === 'http' && error.status === 404)
            setRemaining((list) => list.filter((row) => row.key !== item.key))
          else
            setFailure({
              kind: 'save',
              category,
              message: `${saveFailure(error)} Your answer is kept here.`,
            })
        },
      )
      .finally(() => setPendingId(null))
  }

  function skip() {
    if (!current) return
    setFailure(null)
    writeSkipped([...new Set([...readSkipped(), current.key])])
    setPosition((value) => value + 1)
  }

  function undo() {
    if (!latest || busy) return
    setFailure(null)
    setUndoing(true)
    const restore = preview
      ? okAsync<{ uncategorizedShare: number }, ApiError>({
          uncategorizedShare:
            share * ((total - answers.length + 1) / (total - answers.length)) ||
            data.uncategorizedShare,
        })
      : undoReviewAnswer(latest.applied)
    void restore
      .match(
        ({ uncategorizedShare }) => {
          setAnswers((list) => list.slice(0, -1))
          setRemaining((list) => {
            const index = Math.min(position, list.length)
            return [...list.slice(0, index), latest.item, ...list.slice(index)]
          })
          setShare(uncategorizedShare)
        },
        (error) =>
          setFailure({
            kind: 'undo',
            message: `${saveFailure(error)} ${latest.item.name} stays filed.`,
          }),
      )
      .finally(() => setUndoing(false))
  }

  const skippedLeft = remaining.length
  const filed = answers.reduce(
    (sum, answer) => sum + answer.applied.transactionIds.length,
    0,
  )
  const number = Math.min(answers.length + position + 1, total)
  return (
    <div
      className="pb-[calc(env(safe-area-inset-bottom,0px)+88px)]"
      aria-busy={busy}
    >
      {current ? (
        <>
          <div className="mb-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <p className="tabular-nums" aria-live="polite">
              {number} of {total}
            </p>
            <p className="tabular-nums">{percent(share)} uncategorized</p>
          </div>
          <div
            role="progressbar"
            aria-label="Merchants reviewed"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={answers.length}
            className="mb-6 h-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${(answers.length / total) * 100}%` }}
            />
          </div>
          <Merchant
            key={current.key}
            item={current}
            categories={data.categories}
            busy={busy}
            pendingId={pendingId}
            failure={failure}
            onPick={pick}
            onSkip={skip}
          />
        </>
      ) : (
        <Finished
          answered={answers.length}
          transactions={filed}
          startShare={data.uncategorizedShare}
          share={share}
          empty={total === 0}
          skipped={skippedLeft}
          briefSearch={briefSearch}
          onReviewSkipped={() => setPosition(0)}
        />
      )}
      <p role="status" className="sr-only">
        {latest
          ? `${latest.item.name} filed as ${latest.categoryName}.`
          : undefined}
      </p>
      {(latest || failure?.kind === 'undo') && (
        <div className="home-theme fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex min-h-16 max-w-[480px] items-center gap-3 px-5 py-2 sm:px-7">
            <p className="min-w-0 flex-1 text-[13px] leading-snug">
              {failure?.kind === 'undo' ? (
                <span role="alert" className="text-destructive">
                  {failure.message}
                </span>
              ) : (
                latest && (
                  <>
                    <span className="block truncate font-medium">
                      <bdi dir="auto">{latest.item.name}</bdi>
                    </span>
                    <span className="text-muted-foreground">
                      {latest.categoryName} ·{' '}
                      {plural(latest.applied.transactionIds.length, 'charge')}
                    </span>
                  </>
                )
              )}
            </p>
            {latest && (
              <Button
                variant="outline"
                className="min-h-11 shrink-0"
                disabled={busy}
                onClick={undo}
              >
                {undoing ? (
                  <Loader2
                    className="motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Undo2 aria-hidden="true" />
                )}
                Undo
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CategorizeQueue() {
  const { fixtures } = useSearch({ strict: false }) as { fixtures?: 1 }
  return (
    <div
      dir="ltr"
      className="home-theme min-h-dvh bg-background text-foreground selection:bg-primary/25"
    >
      <div className="mx-auto max-w-[480px] px-5 pt-[max(12px,env(safe-area-inset-top))] sm:px-7 sm:pt-10">
        <header className="mb-3 -ml-3 flex items-center gap-1">
          <Link
            to="/"
            search={{ mode: 'brief', fixtures }}
            aria-label="Back to Brief"
            className="flex size-11 items-center justify-center rounded-lg hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">
            Categorize spending
          </h1>
        </header>
        <main>
          <HomeResource load={getHomeReviewQueue}>
            {(data, preview) => <Queue data={data} preview={preview} />}
          </HomeResource>
        </main>
      </div>
    </div>
  )
}
