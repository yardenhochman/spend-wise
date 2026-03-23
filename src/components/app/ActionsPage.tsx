import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  CircleHelp,
  CreditCard,
  Droplets,
  GlassWater,
  Music,
  Newspaper,
  Phone,
  Shield,
  ShoppingCart,
  Smartphone,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react'
import { getActionCards, getMonthlyInsights } from '@/lib/api'
import type {
  ActionCardBlock,
  ActionCardDefinition,
  MonthlyInsights,
} from '@/lib/types'
import { CATEGORY_HEX_COLORS } from '@/lib/constants'
import { formatMonthAbbr } from '@/utils/dates'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const ACTION_ICONS: Record<string, LucideIcon> = {
  CreditCard,
  Droplets,
  GlassWater,
  Music,
  Newspaper,
  Phone,
  Shield,
  ShoppingCart,
  Smartphone,
  Wrench,
}

function DiningVsGroceriesChart() {
  const [data, setData] = useState<MonthlyInsights | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMonthlyInsights({ view_mode: 'routine' })
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading || !data) {
    return <p className="text-gray-40 py-4 text-xs">Loading chart...</p>
  }

  const months = data.months.slice().reverse().slice(-12)
  const diningColor = CATEGORY_HEX_COLORS.Dining || '#ff7e14'
  const groceriesColor = CATEGORY_HEX_COLORS.Groceries || '#00c070'

  const points = months.map((month) => {
    const dining = month.categories.find((c) => c.category_name === 'Dining')
    const groceries = month.categories.find(
      (c) => c.category_name === 'Groceries',
    )
    const tripsAbroad = month.categories.find(
      (c) => c.category_name === 'Trips Abroad',
    )

    return {
      month: month.month,
      dining: Math.abs(dining?.total ?? 0),
      groceries: Math.abs(groceries?.total ?? 0),
      abroad: Math.abs(tripsAbroad?.total ?? 0) > 500,
    }
  })

  const maxVal = Math.max(
    ...points.map((point) => Math.max(point.dining, point.groceries)),
    1,
  )
  const chartW = Math.max(points.length * 60, 300)
  const chartH = 140
  const barW = 20
  const groupW = 50
  const labelOffset = 14

  const fmtShort = (value: number) =>
    value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value))

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded"
            style={{ backgroundColor: diningColor }}
          />
          Dining
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded"
            style={{ backgroundColor: groceriesColor }}
          />
          Groceries
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          width={chartW}
          height={chartH + labelOffset + 42}
          viewBox={`0 0 ${chartW} ${chartH + labelOffset + 42}`}
        >
          {points.map((point, index) => {
            const x = 10 + index * groupW
            const diningHeight = (point.dining / maxVal) * chartH
            const groceriesHeight = (point.groceries / maxVal) * chartH
            const label = formatMonthAbbr(point.month).split(' ')[0]

            return (
              <g key={point.month}>
                {point.abroad ? (
                  <>
                    <rect
                      x={x - 4}
                      y={labelOffset}
                      width={groupW}
                      height={chartH}
                      rx={4}
                      fill="var(--color-gray-20)"
                      opacity={0.35}
                    />
                    <text
                      x={x + groupW / 2 - 2}
                      y={labelOffset + chartH + 27}
                      textAnchor="middle"
                      fill="var(--color-gray-40)"
                      fontSize={8}
                    >
                      ✈ abroad
                    </text>
                  </>
                ) : null}
                {point.dining > 0 ? (
                  <text
                    x={x + barW / 2}
                    y={labelOffset + chartH - diningHeight - 4}
                    textAnchor="middle"
                    fill={diningColor}
                    fontSize={8}
                    fontWeight={600}
                  >
                    {fmtShort(point.dining)}
                  </text>
                ) : null}
                <rect
                  x={x}
                  y={labelOffset + chartH - diningHeight}
                  width={barW}
                  height={diningHeight}
                  rx={3}
                  fill={diningColor}
                  opacity={0.85}
                />
                {point.groceries > 0 ? (
                  <text
                    x={x + barW + 2 + barW / 2}
                    y={labelOffset + chartH - groceriesHeight - 4}
                    textAnchor="middle"
                    fill={groceriesColor}
                    fontSize={8}
                    fontWeight={600}
                  >
                    {fmtShort(point.groceries)}
                  </text>
                ) : null}
                <rect
                  x={x + barW + 2}
                  y={labelOffset + chartH - groceriesHeight}
                  width={barW}
                  height={groceriesHeight}
                  rx={3}
                  fill={groceriesColor}
                  opacity={0.85}
                />
                <text
                  x={x + groupW / 2}
                  y={labelOffset + chartH + 16}
                  textAnchor="middle"
                  fill="var(--color-gray-60)"
                  fontSize={9}
                >
                  {label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function renderBlock(block: ActionCardBlock, index: number) {
  switch (block.type) {
    case 'paragraph':
      return <p key={index}>{block.text}</p>
    case 'note':
      return (
        <p key={index} className="mt-1 text-xs text-gray-40">
          {block.text}
        </p>
      )
    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul'
      return (
        <ListTag
          key={index}
          className={
            block.ordered
              ? 'ml-2 list-inside list-decimal space-y-1'
              : 'ml-2 list-inside list-disc space-y-1'
          }
        >
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ListTag>
      )
    }
    case 'table':
      return (
        <div key={index} className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-10">
                {block.headers.map((header) => (
                  <TableHead
                    key={header}
                    className="text-gray-40 text-xs uppercase tracking-wider"
                  >
                    {header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {block.rows.map((row, rowIndex) => (
                <TableRow
                  key={`${rowIndex}-${row.join('|')}`}
                  className="border-gray-10"
                >
                  {row.map((cell, cellIndex) => (
                    <TableCell
                      key={`${rowIndex}-${cellIndex}`}
                      className="text-gray-80"
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )
  }
}

function RecommendationCard({ card }: { card: ActionCardDefinition }) {
  const Icon = ACTION_ICONS[card.icon] ?? CircleHelp

  return (
    <Card className="border-gray-10 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-gray-100">
          <Icon size={20} className={card.icon_color} />
          {card.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 text-sm text-gray-60">
          {card.blocks.map((block, index) => renderBlock(block, index))}
        </div>
      </CardContent>
    </Card>
  )
}

export default function ActionsPage() {
  const [cards, setCards] = useState<ActionCardDefinition[]>([])
  const [loadingCards, setLoadingCards] = useState(true)

  useEffect(() => {
    getActionCards()
      .then((response) => setCards(response.items))
      .finally(() => setLoadingCards(false))
  }, [])

  return (
    <div className="min-h-screen bg-page p-6">
      <div className="mx-auto max-w-4xl">
        <h2 className="mb-6 text-2xl font-bold text-gray-100">
          Actions & Recommendations
        </h2>

        <div className="grid gap-5">
          {loadingCards ? (
            <Card className="border-gray-10 shadow-sm">
              <CardContent className="py-6 text-sm text-gray-60">
                Loading recommendations...
              </CardContent>
            </Card>
          ) : cards.length > 0 ? (
            cards.map((card) => (
              <RecommendationCard key={card.id} card={card} />
            ))
          ) : (
            <Card className="border-gray-10 shadow-sm">
              <CardContent className="py-6 text-sm text-gray-60">
                No recommendation cards configured. Add public defaults in
                `config/spendwise.defaults.json` or local private cards in
                `private/spendwise.private.json`.
              </CardContent>
            </Card>
          )}

          <Card className="border-gray-10 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-gray-100">
                <UtensilsCrossed size={20} className="text-orange-400" />
                Dining vs Groceries Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-gray-60">
                Compare dining and groceries month by month to see whether your
                cooking-at-home trend is holding.
              </p>
              <DiningVsGroceriesChart />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
