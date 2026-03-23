interface SparklineProps {
  points: { total: number }[]
  color: string
  width?: number
  height?: number
}

export function Sparkline({
  points,
  color,
  width = 80,
  height = 24,
}: SparklineProps) {
  if (points.length < 2) return null

  const pad = 2
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const maxAbs = Math.max(...points.map((p) => Math.abs(p.total)), 1)

  const coords = points.map((p, i) => ({
    x: pad + (i / (points.length - 1)) * innerW,
    y: pad + innerH - (Math.abs(p.total) / maxAbs) * innerH,
  }))

  const d = coords
    .map((c, i) => {
      if (i === 0) return `M${c.x},${c.y}`
      const prev = coords[i - 1]
      const cpx = (prev.x + c.x) / 2
      return `C${cpx},${prev.y} ${cpx},${c.y} ${c.x},${c.y}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} className="shrink-0">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}
