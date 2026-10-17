import { format, parseISO } from 'date-fns'
import { ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react'
import { getHomeRunway } from '@/lib/api'
import type { RunwayResponse } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatILS } from '@/utils/currency'
import { HomeResource, signedILS } from './HomeState'
import RunwayChart from './RunwayChart'
import { upcomingEvents } from './presentation'

function Runway({ data }: { data: RunwayResponse }) {
  const events = upcomingEvents(data)
  return (
    <>
      {data.openingBalance === null ? (
        <section className="space-y-3 rounded-xl border border-border p-5">
          <Wallet className="text-muted-foreground" aria-hidden="true" />
          <h2 className="text-xl font-semibold">Balance not available yet</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Balances arrive with the daily bank import. Upcoming payments are
            listed below.
          </p>
        </section>
      ) : (
        <section aria-label="Household cash forecast">
          <p className="text-sm text-muted-foreground">Household balance now</p>
          <p className="mt-1 text-[44px] font-semibold tracking-tight tabular-nums">
            {signedILS(
              data.openingBalance,
              formatILS(data.openingBalance),
            ).replace(/^\+/, '')}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {data.accounts.length} checking{' '}
            {data.accounts.length === 1 ? 'account' : 'accounts'}
            {data.balanceAsOf && (
              <>
                {' '}
                · Snapshot {format(parseISO(data.balanceAsOf), 'd MMM, HH:mm')}
              </>
            )}
          </p>
          <RunwayChart data={data} />
          {data.low && (
            <p
              className={cn(
                'rounded-xl border px-4 py-3 text-sm leading-relaxed',
                data.low.balance < 0
                  ? 'border-destructive/35 bg-destructive/10'
                  : 'border-(--color-cat-insurance)/25 bg-(--color-cat-insurance)/10',
              )}
            >
              Lowest point{' '}
              <strong className="tabular-nums">
                {signedILS(
                  data.low.balance,
                  formatILS(data.low.balance),
                ).replace(/^\+/, '')}
              </strong>{' '}
              on <strong>{format(parseISO(data.low.date), 'd MMM')}</strong>.{' '}
              {data.low.balance < 0
                ? 'Expected payments could take the balance below zero.'
                : 'The forecast stays above zero.'}
            </p>
          )}
        </section>
      )}
      <section className="mt-7" aria-labelledby="upcoming-title">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="upcoming-title" className="text-sm font-semibold">
            {data.nextSalary ? 'Until next salary' : 'Upcoming events'}
          </h2>
          {data.nextSalary && (
            <span className="text-xs text-muted-foreground">
              {format(parseISO(data.nextSalary.date), 'd MMM')}
            </span>
          )}
        </div>
        {!data.nextSalary && (
          <p className="mb-3 text-sm text-muted-foreground">
            Next salary date isn’t known yet.
          </p>
        )}
        {events.length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">
            No upcoming events have been identified.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event, index) => (
              <li
                key={`${event.date}-${index}`}
                className="flex items-center gap-3 py-3"
              >
                {event.amount > 0 ? (
                  <ArrowUpRight
                    size={18}
                    className="shrink-0 text-(--color-positive)"
                    aria-hidden="true"
                  />
                ) : (
                  <ArrowDownLeft
                    size={18}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-start text-sm font-medium">
                    <bdi dir="auto">{event.label}</bdi>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {format(parseISO(event.date), 'd MMM')}
                    {event.estimated && ' · Estimated'}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 text-sm font-medium tabular-nums',
                    event.amount > 0 && 'text-(--color-positive)',
                  )}
                >
                  {signedILS(event.amount, formatILS(event.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {data.warnings.length > 0 && (
        <ul
          className="mt-5 space-y-1 text-xs leading-relaxed text-muted-foreground"
          aria-label="Forecast warnings"
        >
          {data.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}
    </>
  )
}

export default function RunwayMode() {
  return (
    <HomeResource load={getHomeRunway}>
      {(data) => <Runway data={data} />}
    </HomeResource>
  )
}
