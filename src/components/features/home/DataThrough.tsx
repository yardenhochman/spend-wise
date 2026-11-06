import { format, parseISO } from 'date-fns'
import { TriangleAlert } from 'lucide-react'
import type { DataFreshness } from '@/lib/types'
import { cn } from '@/lib/utils'

/** How far each source's transactions reach. A stale source is what the numbers are missing. */
export default function DataThrough({
  items,
  className,
}: {
  items: DataFreshness[]
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground',
        className,
      )}
    >
      {items.map((item) => (
        <span
          key={item.label}
          className={cn(
            'inline-flex items-center gap-1',
            item.stale && 'font-medium text-(--color-cat-insurance)',
          )}
        >
          {item.stale && <TriangleAlert size={12} aria-hidden="true" />}
          {item.label} through {format(parseISO(item.through), 'd MMM')}
          {item.stale && <span className="sr-only">, may be out of date</span>}
        </span>
      ))}
    </p>
  )
}
