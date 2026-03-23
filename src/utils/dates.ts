import { format, parse } from 'date-fns'

/**
 * Format a YYYY-MM string as a full month label.
 * e.g. "2026-02" → "February 2026"
 */
export function formatMonthLabel(ym: string): string {
  const date = parse(ym, 'yyyy-MM', new Date())
  return format(date, 'MMMM yyyy')
}

/**
 * Format a YYYY-MM string as abbreviated month.
 * e.g. "2026-02" → "Feb 26"
 */
export function formatMonthAbbr(ym: string): string {
  const date = parse(ym, 'yyyy-MM', new Date())
  return format(date, 'MMM yy')
}

/**
 * Format a period label based on granularity.
 * - month: "2026-02" → "Feb 26"
 * - day: "2026-02-15" → "15"
 */
export function formatChartLabel(
  period: string,
  granularity: 'month' | 'day',
): string {
  if (granularity === 'day') {
    return period.split('-')[2].replace(/^0/, '')
  }
  return formatMonthAbbr(period)
}
