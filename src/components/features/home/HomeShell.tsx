import { format } from 'date-fns'
import { Link } from '@tanstack/react-router'
import { match } from 'ts-pattern'
import { ChartNoAxesCombined, ClipboardList, Newspaper } from 'lucide-react'
import type { HomeMode } from '@/lib/types'
import { cn } from '@/lib/utils'
import RunwayMode from './RunwayMode'
import CommitmentsMode from './CommitmentsMode'
import BriefMode from './BriefMode'
import HomeSearchSheet from './HomeSearchSheet'

const modes = [
  { mode: 'runway', label: 'Runway', Icon: ChartNoAxesCombined },
  { mode: 'commitments', label: 'Commitments', Icon: ClipboardList },
  { mode: 'brief', label: 'Brief', Icon: Newspaper },
] as const

export default function HomeShell({
  mode,
  fixtures,
}: {
  mode: HomeMode
  fixtures?: 1
}) {
  const title = match(mode)
    .with('runway', () => 'Runway')
    .with('commitments', () => 'Commitments')
    .with('brief', () => 'Brief')
    .exhaustive()
  return (
    <div
      dir="ltr"
      className="home-theme min-h-dvh bg-background text-foreground selection:bg-primary/25"
      style={{ '--home-tab-height': '73px' } as React.CSSProperties}
    >
      <div className="mx-auto max-w-[480px] px-5 pt-[max(20px,env(safe-area-inset-top))] sm:px-7 sm:pt-10">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {format(new Date(), 'EEE d MMM')}{' '}
              <span aria-hidden="true">·</span> SpendWise
            </p>
          </div>
          <HomeSearchSheet />
        </header>
        <main
          id="home-content"
          key={mode}
          style={{
            paddingBottom:
              'calc(var(--home-tab-height) + env(safe-area-inset-bottom, 0px) + 24px)',
          }}
        >
          {match(mode)
            .with('runway', () => <RunwayMode />)
            .with('commitments', () => <CommitmentsMode />)
            .with('brief', () => <BriefMode />)
            .exhaustive()}
        </main>
      </div>
      <nav
        aria-label="Home modes"
        className="home-theme fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto grid max-w-[480px] grid-cols-3 px-3">
          {modes.map(({ mode: item, label, Icon }) => (
            <Link
              key={item}
              to="/"
              search={{ mode: item, fixtures }}
              aria-current={mode === item ? 'page' : undefined}
              className={cn(
                'flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring',
                mode === item ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon
                size={21}
                strokeWidth={mode === item ? 2 : 1.6}
                aria-hidden="true"
              />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}
