import { createFileRoute } from '@tanstack/react-router'
import TransactionTable from '@/components/features/transactions/TransactionTable'

type TransactionSearch = {
  category_id?: string
  q?: string
}

export const Route = createFileRoute('/transactions')({
  validateSearch: (search: Record<string, unknown>): TransactionSearch => ({
    category_id:
      typeof search.category_id === 'string' ? search.category_id : undefined,
    q: typeof search.q === 'string' ? search.q : undefined,
  }),
  component: TransactionsPage,
})

function TransactionsPage() {
  return (
    <div className="min-h-screen bg-page p-6">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-100 mb-6">Search</h2>
        <TransactionTable />
      </div>
    </div>
  )
}
