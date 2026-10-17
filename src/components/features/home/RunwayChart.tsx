import { format, parseISO } from 'date-fns'
import type { RunwayResponse } from '@/lib/types'
import { formatILS } from '@/utils/currency'
import { signedILS } from './HomeState'

export default function RunwayChart({ data }: { data: RunwayResponse }) {
  if (data.days.length === 0)
    return (
      <p className="py-8 text-sm text-muted-foreground">
        No daily forecast is available yet.
      </p>
    )
  const width = 400
  const height = 180
  const pad = 14
  const top = 30
  const bottom = 140
  const values = data.days.map((d) => d.balance)
  const min = Math.min(0, ...values)
  const max = Math.max(1, ...values)
  const span = max - min || 1
  const first = parseISO(data.days[0].date).getTime()
  const last = parseISO(data.days[data.days.length - 1].date).getTime()
  const x = (date: string) =>
    pad +
    ((parseISO(date).getTime() - first) / (last - first || 1)) *
      (width - 2 * pad)
  const y = (balance: number) =>
    bottom - ((balance - min) / span) * (bottom - top)
  const points = data.days.map((d) => `${x(d.date)},${y(d.balance)}`).join(' ')
  const low = data.low
  const salaries = data.events.filter(
    (e) =>
      e.kind === 'salary' &&
      e.date >= data.days[0].date &&
      e.date <= data.days[data.days.length - 1].date,
  )
  return (
    <figure className="my-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-[160px] w-full"
        role="img"
        aria-label={`Eight-week balance forecast${low ? `, lowest balance ${signedILS(low.balance, formatILS(low.balance)).replace(/^\+/, '')} on ${format(parseISO(low.date), 'd MMM')}` : ''}. Dashed line marks zero balance.`}
      >
        <line
          x1={pad}
          x2={width - pad}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--destructive)"
          strokeDasharray="4 4"
          opacity=".65"
        />
        <text
          x={width - pad}
          y={y(0) - 7}
          textAnchor="end"
          fontSize="10"
          fill="var(--destructive)"
        >
          ₪0 floor
        </text>
        {salaries.map((e, index) => (
          <g key={`${e.date}-${index}`}>
            <line
              x1={x(e.date)}
              x2={x(e.date)}
              y1={24}
              y2={bottom}
              stroke="var(--muted-foreground)"
              opacity=".25"
            />
            <text
              x={x(e.date)}
              y={15}
              textAnchor="middle"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              salary
            </text>
          </g>
        ))}
        <polyline
          points={points}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {low &&
          low.date >= data.days[0].date &&
          low.date <= data.days[data.days.length - 1].date && (
            <g>
              <circle
                cx={x(low.date)}
                cy={y(low.balance)}
                r="5"
                fill="var(--color-cat-insurance)"
                stroke="var(--background)"
                strokeWidth="2"
              />
              <text
                x={Math.max(65, Math.min(width - 65, x(low.date)))}
                y={Math.min(bottom - 5, y(low.balance) + 20)}
                textAnchor="middle"
                fontSize="10"
                fill="var(--foreground)"
              >
                low{' '}
                {signedILS(low.balance, formatILS(low.balance)).replace(
                  /^\+/,
                  '',
                )}
              </text>
            </g>
          )}
        <text x={pad} y={174} fontSize="10" fill="var(--muted-foreground)">
          Today
        </text>
        <text
          x={width - pad}
          y={174}
          textAnchor="end"
          fontSize="10"
          fill="var(--muted-foreground)"
        >
          {format(parseISO(data.days[data.days.length - 1].date), 'd MMM')}
        </text>
      </svg>
      <figcaption className="sr-only">
        Daily household balance forecast. Salary dates are marked with vertical
        lines.
      </figcaption>
    </figure>
  )
}
