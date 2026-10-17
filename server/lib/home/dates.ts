export const round = (n: number) => Math.round(n * 100) / 100
export function addDays(date: string, count: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + count)
  return d.toISOString().slice(0, 10)
}
export function monthOffset(month: string, offset: number): string {
  const [y, m] = month.slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7)
}
export function dueDate(month: string, day: number): string {
  const last = Number(addDays(monthOffset(month, 1) + '-01', -1).slice(8))
  return `${month}-${String(Math.min(last, day)).padStart(2, '0')}`
}
export function monthsThrough(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    monthOffset(today, i - count + 1),
  )
}
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  return n
    ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2
    : 0
}
export function todayInIsrael(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
