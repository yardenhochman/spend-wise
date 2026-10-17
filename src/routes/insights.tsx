import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import TagSummary from '@/components/features/insights/TagSummary'
import { FileDown, BarChart3, Calendar } from 'lucide-react'
import SpendingBreakdown from '@/components/features/insights/SpendingBreakdown'
import MonthlyDrilldown from '@/components/features/insights/MonthlyDrilldown'
import { getAnalysisReport } from '@/lib/api'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/insights')({
  validateSearch: (
    s: Record<string, unknown>,
  ): { view?: 'tags'; tag?: string } => ({
    view: s.view === 'tags' ? 'tags' : undefined,
    tag: typeof s.tag === 'string' ? s.tag : undefined,
  }),
  component: InsightsPage,
})

function InsightsPage() {
  const { tag } = Route.useSearch()
  const [exporting, setExporting] = useState(false)
  const [view, setView] = useState<'summary' | 'monthly' | 'tags'>(
    Route.useSearch().view === 'tags' ? 'tags' : 'summary',
  )

  const handleExport = async () => {
    setExporting(true)
    try {
      const markdown = await getAnalysisReport()
      const blob = new Blob([markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'analysis.md'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="min-h-screen bg-page p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-bold text-gray-100">Insights</h2>
          <Button
            onClick={handleExport}
            hidden={view === 'tags'}
            disabled={exporting}
            className="bg-brand hover:bg-brand-dark text-white"
          >
            <FileDown size={16} />
            {exporting ? 'Exporting...' : 'Export Analysis'}
          </Button>
        </div>

        {/* View toggle */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Button
            variant={view === 'summary' ? 'default' : 'outline'}
            onClick={() => setView('summary')}
            className={
              view === 'summary'
                ? 'bg-brand text-white hover:bg-brand-dark'
                : 'bg-surface text-gray-60 hover:text-gray-100 border-gray-20'
            }
          >
            <BarChart3 size={16} />
            Summary
          </Button>
          <Button
            variant={view === 'monthly' ? 'default' : 'outline'}
            onClick={() => setView('monthly')}
            className={
              view === 'monthly'
                ? 'bg-brand text-white hover:bg-brand-dark'
                : 'bg-surface text-gray-60 hover:text-gray-100 border-gray-20'
            }
          >
            <Calendar size={16} />
            Monthly
          </Button>
          <Button
            variant={view === 'tags' ? 'default' : 'outline'}
            onClick={() => setView('tags')}
            className={
              view === 'tags'
                ? 'bg-brand text-white'
                : 'bg-surface text-gray-60 border-gray-20'
            }
          >
            Tags & trips
          </Button>
        </div>

        {view === 'tags' ? (
          <TagSummary selectedTag={tag} />
        ) : view === 'summary' ? (
          <SpendingBreakdown />
        ) : (
          <MonthlyDrilldown />
        )}
      </div>
    </div>
  )
}
