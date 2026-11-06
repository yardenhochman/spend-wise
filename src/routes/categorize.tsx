import { createFileRoute } from '@tanstack/react-router'
import CategorizeQueue from '@/components/features/home/CategorizeQueue'

export const Route = createFileRoute('/categorize')({
  validateSearch: (search: Record<string, unknown>): { fixtures?: 1 } => ({
    fixtures:
      import.meta.env.DEV && String(search.fixtures) === '1' ? 1 : undefined,
  }),
  component: CategorizeQueue,
})
