import { useState } from 'react'
import type { CategoryTrendPoint } from '@/lib/types'
import { formatILS } from '@/utils/currency'
import { formatChartLabel } from '@/utils/dates'

interface CategoryChartProps {
  points: CategoryTrendPoint[]
  color: string
  granularity: 'month' | 'day'
  average?: number
  peak?: CategoryTrendPoint | null
  lowest?: CategoryTrendPoint | null
}

export default function CategoryChart({
  points,
  color,
  granularity,
  average,
}: CategoryChartProps) {
  const [hovered, setHovered] = useState<number | null>(null)

  if (points.length === 0) {
    return <p className="text-gray-40 text-xs py-2">No data for this period.</p>
  }

  const maxTotal = Math.max(...points.map((p) => p.total), 1)
  const padLeft = 8
  const padRight = 8
  const padTop = 16
  const padBottom = 24
  const chartWidth = Math.max(points.length * 24, 300)
  const chartHeight = 120
  const innerW = chartWidth - padLeft - padRight
  const innerH = chartHeight - padTop - padBottom

  // Map points to x,y coordinates
  const coords = points.map((p, i) => ({
    x:
      padLeft +
      (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW),
    y: padTop + innerH - (p.total / maxTotal) * innerH,
  }))

  // Build the line path (smooth curve using catmull-rom-like bezier)
  const linePath =
    coords.length === 1
      ? `M${coords[0].x},${coords[0].y}`
      : coords
          .map((c, i) => {
            if (i === 0) return `M${c.x},${c.y}`
            const prev = coords[i - 1]
            const cpx = (prev.x + c.x) / 2
            return `C${cpx},${prev.y} ${cpx},${c.y} ${c.x},${c.y}`
          })
          .join(' ')

  // Build the area path (line path + close along bottom)
  const bottomY = padTop + innerH
  const areaPath = `${linePath} L${coords[coords.length - 1].x},${bottomY} L${coords[0].x},${bottomY} Z`

  // Label frequency
  const labelFreq =
    points.length > 24
      ? Math.ceil(points.length / 12)
      : points.length > 12
        ? 2
        : 1

  // Average line Y
  const avgY =
    average != null && average > 0
      ? padTop + innerH - (average / maxTotal) * innerH
      : null

  return (
    <div className="overflow-x-auto py-2">
      <svg
        width={chartWidth}
        height={chartHeight}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="block"
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient
            id={`area-grad-${color.replace('#', '')}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Filled area */}
        <path d={areaPath} fill={`url(#area-grad-${color.replace('#', '')})`} />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Average dashed line */}
        {avgY != null && (
          <>
            <line
              x1={padLeft}
              y1={avgY}
              x2={chartWidth - padRight}
              y2={avgY}
              stroke="var(--color-gray-40)"
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            <text
              x={chartWidth - padRight}
              y={avgY - 3}
              textAnchor="end"
              fill="var(--color-gray-40)"
              fontSize={8}
            >
              avg {formatILS(average!)}
            </text>
          </>
        )}

        {/* X-axis labels */}
        {points.map((p, i) => {
          if (i % labelFreq !== 0) return null
          return (
            <text
              key={p.period}
              x={coords[i].x}
              y={chartHeight - 4}
              textAnchor="middle"
              fill="var(--color-gray-60)"
              fontSize={9}
            >
              {formatChartLabel(p.period, granularity)}
            </text>
          )
        })}

        {/* Hover hit areas + dots */}
        {coords.map((c, i) => {
          const hitWidth = innerW / points.length
          const isHovered = hovered === i
          return (
            <g key={points[i].period}>
              {/* Invisible hit area */}
              <rect
                x={c.x - hitWidth / 2}
                y={padTop}
                width={hitWidth}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
              />
              {/* Dot on hover */}
              {isHovered && (
                <>
                  {/* Vertical guide line */}
                  <line
                    x1={c.x}
                    y1={padTop}
                    x2={c.x}
                    y2={padTop + innerH}
                    stroke="var(--color-gray-20)"
                    strokeWidth={1}
                  />
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={3.5}
                    fill={color}
                    stroke="var(--color-gray-100)"
                    strokeWidth={1.5}
                  />
                  {/* Tooltip */}
                  <text
                    x={c.x}
                    y={Math.max(c.y - 8, padTop - 2)}
                    textAnchor="middle"
                    fill="var(--color-gray-100)"
                    fontSize={9}
                    fontWeight={600}
                  >
                    {formatILS(points[i].total)}
                  </text>
                </>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
