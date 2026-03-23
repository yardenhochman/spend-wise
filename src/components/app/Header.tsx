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
} from 'lucide-react'
import { useViewMode } from '@/lib/view-mode'
import type { ViewMode } from '@/lib/types'
import { Button } from '@/components/ui/button'

const VIEW_MODES: { value: ViewMode; label: string; icon: typeof Wallet }[] = [
  { value: 'routine', label: 'Routine', icon: Wallet },
  { value: 'home', label: 'Home', icon: Home },
  { value: 'wedding', label: 'Wedding', icon: Heart },
]

export default function Header({
  onOpenSearch,
}: {
  onOpenSearch?: () => void
}) {
  const { mode, setMode } = useViewMode()

  const linkClass =
    'flex items-center gap-2 px-4 py-2 rounded-[14px] text-sm font-medium transition-colors text-gray-60 hover:text-gray-100 hover:bg-surface-alt'
  const activeClass =
    'flex items-center gap-2 px-4 py-2 rounded-[14px] text-sm font-bold bg-brand text-white hover:bg-brand-dark transition-colors'

  return (
    <header className="px-6 py-3 flex items-center gap-6 bg-surface border-b border-gray-10 shadow-sm">
      <Link
        to="/insights"
        className="text-xl font-bold tracking-tight mr-4 text-gray-100"
      >
        SpendWise
      </Link>

      <nav className="flex items-center gap-1">
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

      {/* Right side: search trigger, import button, view mode switcher */}
      <div className="ml-auto flex items-center gap-2">
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

        <div className="flex items-center bg-surface-alt rounded-[14px] p-0.5 border border-gray-10">
          {VIEW_MODES.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={mode === value ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode(value)}
              className={`gap-1.5 rounded-[12px] text-xs ${
                mode === value
                  ? 'bg-brand text-white shadow-sm hover:bg-brand-dark'
                  : 'text-gray-60 hover:text-gray-100'
              }`}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
            </Button>
          ))}
        </div>
      </div>
    </header>
  )
}
