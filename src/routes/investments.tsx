import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  BadgeInfo,
  Building2,
  Home,
  PieChart,
  RefreshCw,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import FileUpload from '@/components/app/FileUpload'
import { PerformanceChart } from '@/components/app/PerformanceChart'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getInvestmentsSummary } from '@/lib/api'
import type {
  BrokerageInvestmentsSummary,
  HomeInvestmentsSummary,
  InvestmentBreakdownItem,
  InvestmentHolding,
  InvestmentsSummary,
} from '@/lib/types'
import { useViewMode } from '@/lib/view-mode'
import { formatILS } from '@/utils/currency'

export const Route = createFileRoute('/investments')({
  component: InvestmentsPage,
})

function formatReportDate(value: string | null): string {
  if (!value) return 'Unknown'
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

function formatMonthLabel(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    year: '2-digit',
    month: 'short',
  }).format(new Date(`${value}T00:00:00`))
}

function formatHoldingQuantity(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4,
  }).format(value)
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function pnlTextClass(value: number): string {
  if (value > 0) return 'text-positive'
  if (value < 0) return 'text-negative'
  return 'text-gray-80'
}

function InvestmentsPage() {
  const { mode } = useViewMode()
  const [data, setData] = useState<InvestmentsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    setLoading(true)
    setError(null)

    getInvestmentsSummary(mode)
      .then((summary) => {
        if (!mounted) return
        setData(summary)
      })
      .catch((err: Error) => {
        if (!mounted) return
        setError(err.message)
      })
      .finally(() => {
        if (!mounted) return
        setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [mode])

  const isHomeMode = data?.kind === 'home'
  const brokerageData =
    data?.kind === 'brokerage' ? (data as BrokerageInvestmentsSummary) : null
  const homeData =
    data?.kind === 'home' ? (data as HomeInvestmentsSummary) : null

  const chartPoints =
    data?.kind === 'brokerage'
      ? (brokerageData?.performance.map((point) => ({
          date: formatMonthLabel(point.date),
          asset_value: point.asset_value,
          cost_basis: point.cost_basis,
          net_gain: point.net_gain,
        })) ?? [])
      : (homeData?.history.map((point) => ({
          date: formatMonthLabel(point.date),
          asset_value: point.asset_value,
          cost_basis: point.cost_basis,
          saved_rent: point.saved_rent,
          net_gain: point.net_gain,
        })) ?? [])

  const chartSeries =
    data?.kind === 'brokerage'
      ? [
          { key: 'asset_value', label: 'Portfolio Value', color: '#2563eb' },
          { key: 'cost_basis', label: 'Cost Basis', color: '#f59e0b' },
          { key: 'net_gain', label: 'Unrealized P&L', color: '#10b981' },
        ]
      : [
          {
            key: 'asset_value',
            label: 'Purchase Basis',
            color: '#2563eb',
          },
          { key: 'cost_basis', label: 'Net Cash Invested', color: '#f97316' },
          { key: 'saved_rent', label: 'Saved Rent', color: '#14b8a6' },
          { key: 'net_gain', label: 'Net Gain', color: '#10b981' },
        ]

  const topHoldings = brokerageData?.holdings.slice(0, 5) ?? []

  return (
    <div className="min-h-screen bg-page p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-100">
              {isHomeMode ? 'Home Investment' : 'Investments'}
            </h2>
            <p className="text-gray-60">
              {isHomeMode
                ? 'Modeled from your apartment purchase, financing cash flows, and an assumed Tel Aviv rent yield.'
                : 'Track brokerage snapshots from Interactive Brokers Flex Query XML exports.'}
            </p>
          </div>
          {brokerageData?.latest && (
            <Badge
              variant="outline"
              className="w-fit border-gray-20 text-gray-80"
            >
              Latest snapshot:{' '}
              {formatReportDate(brokerageData.latest.report_date)}
            </Badge>
          )}
          {homeData?.latest && (
            <Badge
              variant="outline"
              className="w-fit border-gray-20 text-gray-80"
            >
              Latest home data: {formatReportDate(homeData.latest.latest_date)}
            </Badge>
          )}
        </div>

        {brokerageData && (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="Portfolio Value"
                icon={<WalletCards size={16} />}
                value={
                  brokerageData.latest
                    ? formatILS(brokerageData.latest.portfolio_value_base)
                    : 'No data'
                }
              />
              <MetricCard
                title="Unrealized P&L"
                icon={<TrendingUp size={16} />}
                value={
                  brokerageData.latest
                    ? formatILS(brokerageData.latest.unrealized_pnl_base)
                    : 'No data'
                }
                tone={brokerageData.latest?.unrealized_pnl_base ?? 0}
              />
              <MetricCard
                title="Holdings"
                icon={<PieChart size={16} />}
                value={
                  brokerageData.latest
                    ? String(brokerageData.latest.positions_count)
                    : '0'
                }
                description={
                  brokerageData.latest
                    ? `${brokerageData.latest.accounts_count} account${brokerageData.latest.accounts_count === 1 ? '' : 's'}`
                    : 'Import a snapshot'
                }
              />
              <MetricCard
                title="Period"
                icon={<RefreshCw size={16} />}
                value={brokerageData.latest?.period ?? 'Snapshot'}
                description={
                  brokerageData.latest
                    ? `${formatReportDate(brokerageData.latest.from_date)} to ${formatReportDate(brokerageData.latest.to_date)}`
                    : 'No imported range yet'
                }
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
              <div className="space-y-6">
                <PerformanceCard
                  title="Performance Monitor"
                  description="Track portfolio value, cost basis, and unrealized gain across imported market dates."
                  chartPoints={chartPoints}
                  chartSeries={chartSeries}
                  emptyMessage={
                    brokerageData.latest
                      ? 'You have one imported snapshot. Import another XML later to unlock a full trend line.'
                      : 'No history yet. Import your first XML snapshot to get started.'
                  }
                />

                <Card className="border-gray-10 shadow-sm">
                  <CardHeader>
                    <CardTitle>Holdings</CardTitle>
                    <CardDescription>
                      Current open positions from the most recent imported
                      snapshot.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!brokerageData.latest ? (
                      <EmptyState />
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="border-gray-10">
                            <TableHead>Symbol</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">
                              Quantity
                            </TableHead>
                            <TableHead className="text-right">
                              Avg Cost
                            </TableHead>
                            <TableHead className="text-right">
                              Market Price
                            </TableHead>
                            <TableHead className="text-right">Value</TableHead>
                            <TableHead className="text-right">
                              Unrealized
                            </TableHead>
                            <TableHead className="text-right">Weight</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {brokerageData.holdings.map((holding) => (
                            <HoldingRow key={holding.id} holding={holding} />
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card className="border-gray-10 shadow-sm">
                  <CardHeader>
                    <CardTitle>Import Snapshot</CardTitle>
                    <CardDescription>
                      Upload a fresh Interactive Brokers XML export whenever you
                      want to extend the portfolio history.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FileUpload
                      onComplete={() => {
                        setLoading(true)
                        setError(null)
                        getInvestmentsSummary(mode)
                          .then(setData)
                          .catch((err: Error) => setError(err.message))
                          .finally(() => setLoading(false))
                      }}
                    />
                  </CardContent>
                </Card>

                <BreakdownCard
                  title="Performance Breakdown"
                  description="Latest imported basis and gain details."
                  items={brokerageData.breakdown}
                />

                <Card className="border-gray-10 shadow-sm">
                  <CardHeader>
                    <CardTitle>Concentration</CardTitle>
                    <CardDescription>
                      Largest positions in the latest imported snapshot.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!brokerageData.latest ? (
                      <EmptyState compact />
                    ) : (
                      topHoldings.map((holding) => (
                        <div key={holding.id} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium text-gray-100">
                                {holding.symbol}
                              </p>
                              <p className="text-xs text-gray-50">
                                {holding.description}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-medium text-gray-100">
                                {formatILS(holding.market_value_base)}
                              </p>
                              <p className="text-xs text-gray-50">
                                {formatPercent(holding.portfolio_weight)}
                              </p>
                            </div>
                          </div>
                          <div className="h-2 rounded-full bg-surface-alt">
                            <div
                              className="h-full rounded-full bg-brand"
                              style={{
                                width: `${Math.max(holding.portfolio_weight * 100, 4)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}

        {homeData && (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="Purchase Basis"
                icon={<Building2 size={16} />}
                value={formatILS(homeData.latest.purchase_basis)}
                description="Tracked acquisition spend from SpendWise"
              />
              <MetricCard
                title="Net Cash Invested"
                icon={<WalletCards size={16} />}
                value={formatILS(homeData.latest.net_cash_invested)}
                description="Visible out-of-pocket home cash flows"
              />
              <MetricCard
                title="Saved Rent"
                icon={<Home size={16} />}
                value={formatILS(homeData.latest.saved_rent)}
                tone={homeData.latest.saved_rent}
                description={`${formatILS(homeData.latest.monthly_rent_estimate)} / month modeled rent`}
              />
              <MetricCard
                title="Net Gain"
                icon={<TrendingUp size={16} />}
                value={formatILS(homeData.latest.net_gain)}
                tone={homeData.latest.net_gain}
                description="Saved rent minus hard and explicit interest costs"
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
              <div className="space-y-6">
                <PerformanceCard
                  title="Performance Monitor"
                  description="Track cumulative purchase basis, cash committed, modeled saved rent, and net gain over time."
                  chartPoints={chartPoints}
                  chartSeries={chartSeries}
                  emptyMessage="Home investment history appears once you have apartment-purchase transactions in SpendWise."
                />

                <BreakdownCard
                  title="Home Breakdown"
                  description="How the home model is currently assembled from SpendWise."
                  items={homeData.breakdown}
                />
              </div>

              <div className="space-y-6">
                <Card className="border-gray-10 shadow-sm">
                  <CardHeader>
                    <CardTitle>Model Assumptions</CardTitle>
                    <CardDescription>
                      The home view is an estimate, not an imported appraisal.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <AssumptionRow
                      label="Rent Yield"
                      value={formatPercent(homeData.latest.annual_rent_yield)}
                      detail="Used to estimate avoided rent in Tel Aviv"
                    />
                    <AssumptionRow
                      label="Occupancy Start"
                      value={formatReportDate(homeData.latest.occupancy_date)}
                      detail="First recurring mortgage date used as the rent-savings start"
                    />
                    <AssumptionRow
                      label="Value Basis"
                      value="Tracked purchase basis"
                      detail="The blue line is not a live market appraisal. It reflects the acquisition basis captured in SpendWise."
                    />
                  </CardContent>
                </Card>

                <Card className="border-gray-10 shadow-sm">
                  <CardHeader>
                    <CardTitle>What This Means</CardTitle>
                    <CardDescription>
                      Read the modeled return with the right level of caution.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-gray-60">
                    <p>
                      Saved rent is treated like an ownership benefit, using the
                      current Tel Aviv rent-yield assumption.
                    </p>
                    <p>
                      Mortgage balance is not yet modeled as a live liability,
                      so this view is best used as an ownership-performance
                      monitor, not a formal mark-to-market equity statement.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}

        {loading && (
          <p className="text-sm text-gray-60">Loading investments data…</p>
        )}
        {error && <p className="text-sm text-negative">{error}</p>}
      </div>
    </div>
  )
}

function MetricCard({
  title,
  icon,
  value,
  description,
  tone,
}: {
  title: string
  icon: ReactNode
  value: string
  description?: string
  tone?: 'neutral' | number
}) {
  return (
    <Card className="border-gray-10 shadow-sm">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-gray-50">
            {icon}
            <span>{title}</span>
          </div>
          <p
            className={`text-2xl font-semibold ${
              tone === 'neutral' || tone === undefined
                ? 'text-gray-100'
                : pnlTextClass(tone)
            }`}
          >
            {value}
          </p>
          {description && (
            <p className="mt-1 text-sm text-gray-60">{description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function PerformanceCard({
  title,
  description,
  chartPoints,
  chartSeries,
  emptyMessage,
}: {
  title: string
  description: string
  chartPoints: { date: string; [key: string]: number | string }[]
  chartSeries: { key: string; label: string; color: string }[]
  emptyMessage: string
}) {
  return (
    <Card className="border-gray-10 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {chartPoints.length > 1 ? (
          <PerformanceChart points={chartPoints} series={chartSeries} />
        ) : (
          <p className="text-sm text-gray-60">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  )
}

function BreakdownCard({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: InvestmentBreakdownItem[]
}) {
  return (
    <Card className="border-gray-10 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-gray-10 bg-surface-alt/40 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-gray-100">{item.label}</p>
                {item.detail && (
                  <p className="mt-1 text-sm text-gray-60">{item.detail}</p>
                )}
              </div>
              <p className={`font-semibold ${pnlTextClass(item.amount)}`}>
                {item.label.includes('Snapshots')
                  ? new Intl.NumberFormat('en-US').format(item.amount)
                  : formatILS(item.amount)}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function AssumptionRow({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="rounded-xl border border-gray-10 bg-surface-alt/40 p-4">
      <div className="flex items-start gap-3">
        <BadgeInfo className="mt-0.5 shrink-0 text-gray-50" size={16} />
        <div className="flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-gray-100">{label}</p>
            <p className="text-sm font-semibold text-gray-80">{value}</p>
          </div>
          <p className="mt-1 text-sm text-gray-60">{detail}</p>
        </div>
      </div>
    </div>
  )
}

function HoldingRow({ holding }: { holding: InvestmentHolding }) {
  return (
    <TableRow className="border-gray-10">
      <TableCell className="font-medium text-gray-100">
        {holding.symbol}
      </TableCell>
      <TableCell className="max-w-[260px] truncate text-gray-60">
        {holding.description}
      </TableCell>
      <TableCell className="text-right text-gray-80">
        {formatHoldingQuantity(holding.quantity)}
      </TableCell>
      <TableCell className="text-right text-gray-80">
        {holding.currency} {holding.avg_open_price.toFixed(2)}
      </TableCell>
      <TableCell className="text-right text-gray-80">
        {holding.currency} {holding.market_price.toFixed(2)}
      </TableCell>
      <TableCell className="text-right font-medium text-gray-100">
        {formatILS(holding.market_value_base)}
      </TableCell>
      <TableCell
        className={`text-right font-medium ${pnlTextClass(holding.unrealized_pnl_base)}`}
      >
        {formatILS(holding.unrealized_pnl_base)}
      </TableCell>
      <TableCell className="text-right text-gray-80">
        {formatPercent(holding.portfolio_weight)}
      </TableCell>
    </TableRow>
  )
}

function EmptyState({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`rounded-xl border border-dashed border-gray-20 bg-surface-alt/40 text-gray-60 ${
        compact ? 'p-4 text-sm' : 'p-8 text-center'
      }`}
    >
      Import an Interactive Brokers Flex Query XML file to populate this area.
    </div>
  )
}
