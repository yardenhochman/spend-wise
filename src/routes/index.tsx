import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import HomeShell from '@/components/features/home/HomeShell'
import type { HomeMode } from '@/lib/types'

const isHomeMode = (value: unknown): value is HomeMode =>
  value === 'runway' || value === 'commitments' || value === 'brief'

export const Route = createFileRoute('/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { mode?: HomeMode; fixtures?: 1 } => ({
    mode: isHomeMode(search.mode) ? search.mode : undefined,
    fixtures:
      import.meta.env.DEV && String(search.fixtures) === '1' ? 1 : undefined,
  }),
  component: HomePage,
})

function HomePage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  useEffect(() => {
    if (!search.mode) {
      let remembered: HomeMode = 'runway'
      try {
        const stored = localStorage.getItem('spendwise.home.mode')
        if (isHomeMode(stored)) remembered = stored
      } catch {
        /* Storage may be unavailable in private/restricted browsers. */
      }
      void navigate({ search: { ...search, mode: remembered }, replace: true })
      return
    }
    try {
      localStorage.setItem('spendwise.home.mode', search.mode)
    } catch {
      /* The explicit URL remains usable without storage access. */
    }
  }, [search.mode, search.fixtures, navigate])
  return <HomeShell mode={search.mode ?? 'runway'} fixtures={search.fixtures} />
}
