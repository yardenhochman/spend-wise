import { curveMonotoneX } from '@visx/curve'
import { ParentSize } from '@visx/responsive'
import {
  Axis,
  buildChartTheme,
  Grid,
  LineSeries,
  Tooltip,
  XYChart,
} from '@visx/xychart'

interface PerformanceChartPoint {
  date: string
  [key: string]: number | string
}

interface PerformanceChartSeries {
  key: string
  label: string
  color: string
}

type SeriesDatum = {
  x: string
  y: number
}

const chartTheme = buildChartTheme({
  backgroundColor: 'transparent',
  colors: ['#2563eb', '#f59e0b', '#10b981', '#14b8a6'],
  gridColor: 'rgba(148, 163, 184, 0.16)',
  gridColorDark: 'rgba(148, 163, 184, 0.16)',
  tickLength: 0,
  svgLabelSmall: {
    fill: 'rgb(100 116 139)',
    fontSize: 11,
    fontFamily: 'inherit',
  },
  svgLabelBig: {
    fill: 'rgb(15 23 42)',
    fontSize: 12,
    fontFamily: 'inherit',
    fontWeight: 600,
  },
  xAxisLineStyles: {
    stroke: 'rgba(148, 163, 184, 0.18)',
  },
  yAxisLineStyles: {
    stroke: 'rgba(148, 163, 184, 0.18)',
  },
})

function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'ILS',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatTooltipCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(value)
}

export function PerformanceChart({
  points,
  series,
  height = 320,
}: {
  points: PerformanceChartPoint[]
  series: PerformanceChartSeries[]
  height?: number
}) {
  if (points.length < 2 || series.length === 0) return null

  const seriesData = series.map((item) => ({
    ...item,
    data: points.map((point) => ({
      x: point.date,
      y: Number(point[item.key] ?? 0),
    })) satisfies SeriesDatum[],
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {series.map((item) => (
          <div
            key={item.key}
            className="flex items-center gap-2 rounded-full bg-surface-alt px-3 py-1 text-xs text-gray-70"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-10 bg-white/80 p-4">
        <div className="h-[320px] w-full">
          <ParentSize>
            {({ width }) => {
              if (width < 120) return null

              return (
                <XYChart
                  height={height}
                  width={width}
                  margin={{ top: 12, right: 20, bottom: 42, left: 72 }}
                  xScale={{ type: 'point' }}
                  yScale={{ type: 'linear' }}
                  theme={chartTheme}
                >
                  <Grid columns={false} numTicks={4} />
                  <Axis
                    orientation="bottom"
                    numTicks={Math.min(points.length, 4)}
                    tickFormat={(value) => String(value)}
                  />
                  <Axis
                    orientation="left"
                    numTicks={4}
                    tickFormat={(value) => formatCompactCurrency(Number(value))}
                  />

                  {seriesData.map((item) => (
                    <LineSeries
                      key={item.key}
                      dataKey={item.label}
                      data={item.data}
                      curve={curveMonotoneX}
                      stroke={item.color}
                      xAccessor={(datum) => datum.x}
                      yAccessor={(datum) => datum.y}
                    />
                  ))}

                  <Tooltip<SeriesDatum>
                    showVerticalCrosshair
                    showSeriesGlyphs
                    snapTooltipToDatumX
                    snapTooltipToDatumY
                    renderTooltip={({ tooltipData, colorScale }) => {
                      const dateLabel = tooltipData?.nearestDatum?.datum.x ?? ''
                      const hoveredPoint = points.find(
                        (point) => String(point.date) === String(dateLabel),
                      )

                      return (
                        <div className="min-w-[180px] rounded-xl border border-gray-10 bg-white px-3 py-2 shadow-lg">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-50">
                            {dateLabel}
                          </p>
                          <div className="space-y-1.5">
                            {series.map((item) => (
                              <div
                                key={item.key}
                                className="flex items-center justify-between gap-4 text-sm"
                              >
                                <div className="flex items-center gap-2 text-gray-70">
                                  <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{
                                      backgroundColor:
                                        colorScale?.(item.label) ?? item.color,
                                    }}
                                  />
                                  <span>{item.label}</span>
                                </div>
                                <span className="font-medium text-gray-100">
                                  {formatTooltipCurrency(
                                    Number(hoveredPoint?.[item.key] ?? 0),
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    }}
                  />
                </XYChart>
              )
            }}
          </ParentSize>
        </div>
      </div>
    </div>
  )
}
