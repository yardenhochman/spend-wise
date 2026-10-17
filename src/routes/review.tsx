import { createFileRoute } from '@tanstack/react-router'
import ReviewPage from '@/components/features/review/ReviewPage'

type ReviewSearch = {
  filter?: string
  category_id?: string
}

export const Route = createFileRoute('/review')({
  validateSearch: (search: Record<string, unknown>): ReviewSearch => ({
    filter: typeof search.filter === 'string' ? search.filter : undefined,
    category_id:
      typeof search.category_id === 'string' ? search.category_id : undefined,
  }),
  component: ReviewRoute,
})

function ReviewRoute() {
  return (
    <div className="min-h-screen bg-page p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-100 mb-6">
          Review Transactions
        </h2>
        <ReviewPage />
      </div>
    </div>
  )
}
