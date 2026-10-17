import { useRef, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  BarChart3,
  ClipboardCheck,
  List,
  Repeat,
  Search,
  TrendingUp,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getHomeProjects } from '@/lib/api'
import { formatILS } from '@/utils/currency'
import { HomeResource } from './HomeState'

const browse = [
  { to: '/transactions', label: 'All transactions', Icon: List },
  { to: '/insights', label: 'Insights', Icon: BarChart3 },
  { to: '/subscriptions', label: 'Subscriptions', Icon: Repeat },
  { to: '/review', label: 'Review', Icon: ClipboardCheck },
  { to: '/upload', label: 'Upload statements', Icon: Upload },
  { to: '/actions', label: 'Actions', Icon: Zap },
  { to: '/investments', label: 'Investments', Icon: TrendingUp },
] as const

export default function HomeSearchSheet() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-11 rounded-full border border-border bg-card/50"
          />
        }
        aria-label="Open search"
      >
        <Search size={20} />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-safe:transition-opacity" />
        <Dialog.Popup
          initialFocus={inputRef}
          className="home-theme fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-3xl border border-border bg-background text-foreground shadow-2xl outline-none data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full motion-safe:transition-transform motion-safe:duration-200"
        >
          <div
            className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-muted"
            aria-hidden="true"
          />
          <div className="flex shrink-0 items-center justify-between px-5 pt-2 pb-2">
            <Dialog.Title className="text-xl font-semibold tracking-tight">
              Search & explore
            </Dialog.Title>
            <Dialog.Close
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 rounded-full"
                />
              }
              aria-label="Close search"
            >
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Search transactions, open a project, or browse SpendWise pages.
          </Dialog.Description>
          <div className="overflow-y-auto overscroll-contain px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
            <form
              className="mb-6 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!query.trim()) return
                setOpen(false)
                void navigate({
                  to: '/transactions',
                  search: { q: query.trim() },
                })
              }}
            >
              <Input
                ref={inputRef}
                aria-label="Search transactions"
                placeholder="Merchant, amount, or tag…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-12 bg-card text-base"
                dir="auto"
              />
              <Button
                type="submit"
                disabled={!query.trim()}
                className="size-12 shrink-0"
                aria-label="Search transactions with query"
              >
                <ArrowRight size={18} />
              </Button>
            </form>
            <section aria-labelledby="projects-title">
              <h2 id="projects-title" className="mb-1 text-sm font-semibold">
                Projects
              </h2>
              <HomeResource load={getHomeProjects}>
                {(data, preview) =>
                  data.projects.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                      Tag transactions to start tracking a project.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {data.projects.map((project) => (
                        <li key={project.tag}>
                          <Link
                            to="/insights"
                            search={{ view: 'tags', tag: project.tag }}
                            onClick={() => setOpen(false)}
                            className="flex min-h-16 items-center justify-between gap-3 py-3 focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <div className="min-w-0">
                              <p className="text-start text-sm font-medium">
                                <bdi dir="auto">{project.label}</bdi>
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {project.status === 'open' ? 'Open' : 'Ended'}
                                {preview ? ' · Demo project' : ''}
                              </p>
                            </div>
                            <span className="text-right text-sm tabular-nums">
                              {project.net < 0 ? '−' : ''}
                              {formatILS(project.net)}
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                net cost
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )
                }
              </HomeResource>
            </section>
            <section className="mt-6" aria-labelledby="browse-title">
              <h2 id="browse-title" className="mb-2 text-sm font-semibold">
                Browse
              </h2>
              <nav aria-label="Browse pages" className="divide-y divide-border">
                {browse.map(({ to, label, Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setOpen(false)}
                    className="flex min-h-12 items-center gap-3 py-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Icon size={17} aria-hidden="true" />
                    <span className="flex-1">{label}</span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                ))}
              </nav>
            </section>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
