import { CATEGORY_HEX_COLORS } from '@/lib/constants'
import { formatILS } from '@/utils/currency'

export interface DonutSlice {
  name: string
  value: number
}

export function DonutChart({
  slices,
  total,
  selected,
  onSelect,
  size = 200,
  label,
}: {
  slices: DonutSlice[]
  total: number
  selected: string | null
  onSelect: (name: string | null) => void
  size?: number
  label?: string
}) {
  const cx = size / 2
  const cy = size / 2
  const outerR = size * 0.44
  const innerR = size * 0.29
  const expandR = 6

  let startAngle = -Math.PI / 2
  const arcs = slices.map((s) => {
    const pct = total > 0 ? s.value / total : 0
    const angle = pct * Math.PI * 2
    const arc = { ...s, startAngle, angle, pct }
    startAngle += angle
    return arc
  })

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto"
    >
      {arcs.map((s) => {
        const isSelected = selected === s.name
        const r = isSelected ? outerR + expandR : outerR
        const mid = s.startAngle + s.angle / 2
        const offset = isSelected ? 4 : 0
        const offX = Math.cos(mid) * offset
        const offY = Math.sin(mid) * offset

        const x1 = cx + offX + Math.cos(s.startAngle) * r
        const y1 = cy + offY + Math.sin(s.startAngle) * r
        const x2 = cx + offX + Math.cos(s.startAngle + s.angle) * r
        const y2 = cy + offY + Math.sin(s.startAngle + s.angle) * r
        const ix1 = cx + offX + Math.cos(s.startAngle + s.angle) * innerR
        const iy1 = cy + offY + Math.sin(s.startAngle + s.angle) * innerR
        const ix2 = cx + offX + Math.cos(s.startAngle) * innerR
        const iy2 = cy + offY + Math.sin(s.startAngle) * innerR
        const large = s.angle > Math.PI ? 1 : 0
        const color = CATEGORY_HEX_COLORS[s.name] ?? '#9ca3af'

        const d = [
          `M${x1},${y1}`,
          `A${r},${r} 0 ${large} 1 ${x2},${y2}`,
          `L${ix1},${iy1}`,
          `A${innerR},${innerR} 0 ${large} 0 ${ix2},${iy2}`,
          'Z',
        ].join(' ')

        return (
          <path
            key={s.name}
            d={d}
            fill={color}
            opacity={selected && !isSelected ? 0.3 : 1}
            className="cursor-pointer transition-opacity"
            onClick={() => onSelect(isSelected ? null : s.name)}
          />
        )
      })}
      {/* Center click area */}
      <circle
        cx={cx}
        cy={cy}
        r={innerR - 2}
        fill="transparent"
        className="cursor-pointer"
        onClick={() => onSelect(null)}
      />
      {selected ? (
        <>
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            className="fill-gray-100 text-[11px] font-medium"
          >
            {selected}
          </text>
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            className="fill-gray-60 text-[10px]"
          >
            {formatILS(
              slices.find((s) => s.name === selected)?.value ?? 0,
            )}
          </text>
        </>
      ) : (
        <>
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            className="fill-gray-100 text-sm font-bold"
          >
            {formatILS(total)}
          </text>
          {label && (
            <text
              x={cx}
              y={cy + 12}
              textAnchor="middle"
              className="fill-gray-60 text-[10px]"
            >
              {label}
            </text>
          )}
        </>
      )}
    </svg>
  )
}
