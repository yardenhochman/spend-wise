import { Link } from '@tanstack/react-router'
import {
  Search,
  BarChart3,
  Zap,
  ClipboardCheck,
  Repeat,
  Wallet,
  TrendingUp,
  Home,
  Heart,
  Import,
  Landmark,
  Receipt,
} from 'lucide-react'
import { useViewMode } from '@/lib/view-mode'
import type { ViewExclusion } from '@/lib/types'
import { Button } from '@/components/ui/button'

const EXCLUSION_TOGGLES: {
  value: ViewExclusion
  label: string
  icon: typeof Wallet
}[] = [
  { value: 'wedding', label: 'Wedding', icon: Heart },
  { value: 'loans', label: 'Loans', icon: Receipt },
  { value: 'mortgage', label: 'Mortgage', icon: Landmark },
  { value: 'home', label: 'Home', icon: Home },
]

export default function Header({
  onOpenSearch,
}: {
  onOpenSearch?: () => void
}) {
  const { excludedKinds, setExcludedKinds, toggleExcludedKind } = useViewMode()

  const linkClass =
    'flex shrink-0 items-center gap-2 rounded-[14px] px-3 py-2 text-sm font-medium text-gray-60 transition-colors hover:bg-surface-alt hover:text-gray-100 sm:px-4'
  const activeClass =
    'flex shrink-0 items-center gap-2 rounded-[14px] bg-brand px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark sm:px-4'

  return (
    <header className="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b border-gray-10 bg-surface/95 px-3 py-2 shadow-sm backdrop-blur sm:px-4 lg:gap-6 lg:px-6">
      <Link
        to="/insights"
        className="mr-2 shrink-0 text-lg font-bold tracking-tight text-gray-100 sm:mr-4 sm:text-xl"
      >
        SpendWise
      </Link>

      <nav className="order-3 -mx-1 flex w-full items-center gap-1 overflow-x-auto px-1 pb-1 sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:px-0 sm:pb-0">
        <Link
          to="/insights"
          className={linkClass}
          activeProps={{ className: activeClass }}
        >
          <BarChart3 size={16} />
          <span className="hidden sm:inline">Insights</span>
        </Link>
        <Link
          to="/investments"
          className={linkClass}
          activeProps={{ className: activeClass }}
        >
          <TrendingUp size={16} />
          <span className="hidden sm:inline">Investments</span>
        </Link>
        <Link
          to="/subscriptions"
          className={linkClass}
          activeProps={{ className: activeClass }}
        >
          <Repeat size={16} />
          <span className="hidden sm:inline">Recurring</span>
        </Link>
        <Link
          to="/actions"
          className={linkClass}
          activeProps={{ className: activeClass }}
        >
          <Zap size={16} />
          <span className="hidden sm:inline">Actions</span>
        </Link>
        <Link
          to="/review"
          className={linkClass}
          activeProps={{ className: activeClass }}
        >
          <ClipboardCheck size={16} />
          <span className="hidden sm:inline">Review</span>
        </Link>
        <Link
          to="/transactions"
          className={linkClass}
          activeProps={{ className: activeClass }}
        >
          <Search size={16} />
          <span className="hidden sm:inline">Search</span>
        </Link>
      </nav>

      {/* Right side: search trigger, import button, cashflow exclusions */}
      <div className="order-2 ml-auto flex shrink-0 items-center gap-1 sm:order-none sm:gap-2">
        {onOpenSearch && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSearch}
            className="text-gray-40 hover:text-gray-100 gap-1.5 text-xs"
            title="Search (⌘K)"
          >
            <Search size={14} />
            <span className="hidden sm:inline text-gray-40">⌘K</span>
          </Button>
        )}

        <Link to="/upload">
          <Button
            variant="ghost"
            size="icon"
            className="text-gray-40 hover:text-gray-100 h-8 w-8"
            title="Import statement"
          >
            <Import size={16} />
          </Button>
        </Link>
      </div>

      <div className="order-4 flex w-full items-center gap-1 overflow-x-auto rounded-[14px] border border-gray-10 bg-surface-alt p-0.5 sm:order-none sm:w-auto sm:shrink-0">
        {excludedKinds.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExcludedKinds([])}
            className="shrink-0 rounded-[12px] text-xs text-gray-60 hover:text-gray-100"
            title="Show all cashflow"
          >
            All
          </Button>
        )}
        {EXCLUSION_TOGGLES.map(({ value, label, icon: Icon }) => {
          const isActive = excludedKinds.includes(value)
          return (
            <Button
              key={value}
              variant={isActive ? 'default' : 'ghost'}
              size="sm"
              onClick={() => toggleExcludedKind(value)}
              className={`shrink-0 gap-1.5 rounded-[12px] text-xs ${
                isActive
                  ? 'bg-brand text-white shadow-sm hover:bg-brand-dark'
                  : 'text-gray-60 hover:text-gray-100'
              }`}
              title={`${isActive ? 'Show' : 'Hide'} ${label}`}
            >
              <Icon size={14} />
              <span>{label}</span>
            </Button>
          )
        })}
      </div>
    </header>
  )
}
