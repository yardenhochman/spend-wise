import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ResultAsync } from 'neverthrow'
import { match } from 'ts-pattern'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ApiError } from '@/lib/api'
import type { HomeData } from '@/lib/types'

export function apiErrorMessage(error: ApiError) {
  return match(error)
    .with(
      { type: 'network' },
      () => 'Could not connect. Check your connection and try again.',
    )
    .with({ type: 'http' }, (e) =>
      e.status === 404
        ? 'This home view is not available yet. Try again after the service is updated.'
        : `The service could not load this view (HTTP ${e.status}). Please try again.`,
    )
    .with(
      { type: 'parse' },
      () => 'The service returned an unreadable response. Please try again.',
    )
    .exhaustive()
}

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ready'; value: HomeData<T> }

/** Ignore stale results when switching modes or retrying. */
export function useHomeData<T>(load: () => ResultAsync<HomeData<T>, ApiError>) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    void load().match(
      (value) => {
        if (active) setState({ status: 'ready', value })
      },
      (error) => {
        if (active) setState({ status: 'error', error })
      },
    )
    return () => {
      active = false
    }
  }, [load, attempt])
  return { state, retry }
}

export function HomeError({
  error,
  retry,
}: {
  error: ApiError
  retry: () => void
}) {
  return (
    <div
      role="alert"
      className="space-y-3 rounded-xl border border-destructive/35 p-5"
    >
      <h2 className="font-semibold">Couldn’t load this view</h2>
      <p className="text-sm text-muted-foreground">{apiErrorMessage(error)}</p>
      <Button variant="outline" className="min-h-11" onClick={retry}>
        <RefreshCw /> Try again
      </Button>
    </div>
  )
}

export function HomeSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading home view"
      className="space-y-6 motion-safe:animate-pulse"
    >
      <span className="sr-only">Loading home view…</span>
      <div className="h-5 w-40 rounded bg-muted" />
      <div className="h-12 w-56 rounded bg-muted" />
      <div className="h-44 rounded-xl bg-muted/60" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 rounded bg-muted/50" />
      ))}
    </div>
  )
}

export function HomeResource<T>({
  load,
  children,
}: {
  load: () => ResultAsync<HomeData<T>, ApiError>
  children: (data: T, preview: boolean) => ReactNode
}) {
  const { state, retry } = useHomeData(load)
  return match(state)
    .with({ status: 'loading' }, () => <HomeSkeleton />)
    .with({ status: 'error' }, ({ error }) => (
      <HomeError error={error} retry={retry} />
    ))
    .with({ status: 'ready' }, ({ value }) => (
      <>
        {value.source === 'fixtures' && (
          <p className="mb-4 rounded-lg bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
            Demo household · synthetic data
          </p>
        )}
        {children(value.data, value.source === 'fixtures')}
      </>
    ))
    .exhaustive()
}

export function signedILS(amount: number, formatted: string) {
  return `${amount < 0 ? '−' : amount > 0 ? '+' : ''}${formatted}`
}
