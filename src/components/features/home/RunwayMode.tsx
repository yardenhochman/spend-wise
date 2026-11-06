import MerchantName from '@/components/app/MerchantName'
import { format, parseISO } from 'date-fns'
import { Wallet } from 'lucide-react'
import { getHomeRunway } from '@/lib/api'
import type { RunwayResponse } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatILS } from '@/utils/currency'
import { HomeResource, signedILS } from './HomeState'
import RunwayChart from './RunwayChart'
import DataThrough from './DataThrough'
import { leftBeforeSalary, relativeDay, upcomingGroups } from './presentation'

const money = (value: number) =>
  signedILS(value, formatILS(value)).replace(/^\+/, '')

function Runway({ data, preview }: { data: RunwayResponse; preview: boolean }) {
  const groups = upcomingGroups(data)
  const left = leftBeforeSalary(data)
  const balanceOn = new Map(data.days.map((d) => [d.date, d.balance]))
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
            {money(data.openingBalance)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {data.accounts.length} checking{' '}
            {data.accounts.length === 1 ? 'account' : 'accounts'}
            {data.balanceAsOf && (
              <>
                {' '}
                · Balance from{' '}
                {format(parseISO(data.balanceAsOf), 'd MMM, HH:mm')}
              </>
            )}
          </p>
          <DataThrough items={data.freshness} className="mt-1" />
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
              {left !== null && data.nextSalary && (
                <>
                  About <strong className="tabular-nums">{money(left)}</strong>{' '}
                  left before the salary on{' '}
                  <strong>
                    {format(parseISO(data.nextSalary.date), 'd MMM')}
                  </strong>
                  .{' '}
                </>
              )}
              Lowest point{' '}
              <strong className="tabular-nums">
                {money(data.low.balance)}
              </strong>{' '}
              on <strong>{format(parseISO(data.low.date), 'd MMM')}</strong>
              {data.low.balance < 0
                ? ', below zero if payments go out as expected.'
                : ', still above zero.'}
            </p>
          )}
        </section>
      )}
      <section className="mt-8" aria-label="Upcoming payments">
        {!data.nextSalary && (
          <p className="mb-3 text-sm text-muted-foreground">
            Next salary date isn’t known yet.
          </p>
        )}
        {groups.length === 0 && (
          <p className="py-5 text-sm text-muted-foreground">
            No upcoming events have been identified.
          </p>
        )}
        {groups.map((group) => (
          <div key={group.title} className="mb-6">
            <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
              <h2 className="text-sm font-semibold">{group.title}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatILS(group.out)} out
              </span>
            </div>
            <ul className="divide-y divide-border">
              {group.events.map((event, index) => {
                const lastOfDay = group.events[index + 1]?.date !== event.date
                const after = balanceOn.get(event.date)
                return (
                  <li
                    key={`${event.date}-${index}`}
                    className="flex items-center gap-3 py-2.5"
                  >
                    <time
                      dateTime={event.date}
                      className={cn(
                        'flex w-10 shrink-0 flex-col items-center rounded-md border border-border py-1 leading-none',
                        event.amount > 0 &&
                          'border-(--color-positive)/40 text-(--color-positive)',
                      )}
                    >
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {format(parseISO(event.date), 'MMM')}
                      </span>
                      <span className="mt-0.5 text-sm font-semibold tabular-nums">
                        {format(parseISO(event.date), 'd')}
                      </span>
                    </time>
                    <div className="min-w-0 flex-1">
                      <MerchantName
                        name={event.label}
                        rawMerchant={event.rawMerchant}
                        preview={preview}
                      />
                      <p className="text-xs text-muted-foreground">
                        {relativeDay(event.date, data.asOf)}
                        {event.estimated && ' · Estimated'}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <p
                        className={cn(
                          'text-sm font-medium tabular-nums',
                          event.amount > 0 && 'text-(--color-positive)',
                        )}
                      >
                        {signedILS(event.amount, formatILS(event.amount))}
                      </p>
                      {lastOfDay && after !== undefined && (
                        <p
                          className={cn(
                            'mt-0.5 text-xs tabular-nums text-muted-foreground',
                            after < 0 && 'text-destructive',
                          )}
                        >
                          {money(after)} after
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
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
      {(data, preview) => <Runway data={data} preview={preview} />}
    </HomeResource>
  )
}
