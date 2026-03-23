import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { FileDown, BarChart3, Calendar } from 'lucide-react'
import SpendingBreakdown from '@/components/features/insights/SpendingBreakdown'
import MonthlyDrilldown from '@/components/features/insights/MonthlyDrilldown'
import { getAnalysisReport } from '@/lib/api'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/insights')({ component: InsightsPage })

function InsightsPage() {
  const [exporting, setExporting] = useState(false)
  const [view, setView] = useState<'summary' | 'monthly'>('summary')

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
    <div className="min-h-screen bg-page p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-100">Insights</h2>
          <Button
            onClick={handleExport}
            disabled={exporting}
            className="bg-brand hover:bg-brand-dark text-white"
          >
            <FileDown size={16} />
            {exporting ? 'Exporting...' : 'Export Analysis'}
          </Button>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-2 mb-6">
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
        </div>

        {view === 'summary' ? <SpendingBreakdown /> : <MonthlyDrilldown />}
      </div>
    </div>
  )
}
