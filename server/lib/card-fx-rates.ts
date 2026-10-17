/** Representative-rate estimates only; never presented as actual bank settlement. */
export async function loadCardFxValuation(from: string) {
  const end = new Date().toISOString().slice(0, 10)
  const start = new Date(from)
  start.setUTCDate(start.getUTCDate() - 7)
  const url = new URL(
    'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/',
  )
  url.search = new URLSearchParams({
    'c[SERIES_CODE]': 'RER_EUR_ILS,RER_USD_ILS',
    startperiod: start.toISOString().slice(0, 10),
    endperiod: end,
    format: 'csv',
  }).toString()
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error('Unable to retrieve FX valuation rates')
  const lines = (await response.text())
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(','))
  const header = lines.shift() ?? []
  const observations = lines
    .map((r) => ({
      currency: r[header.indexOf('BASE_CURRENCY')],
      date: r[header.indexOf('TIME_PERIOD')],
      rate: Number(r[header.indexOf('OBS_VALUE')]),
    }))
    .filter((r) => Number.isFinite(r.rate) && r.rate > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  return (currency: string, amount: number, date: string): number => {
    const rate = observations
      .filter((r) => r.currency === currency && r.date <= date)
      .at(-1)?.rate
    if (!rate)
      throw new Error(`No representative rate for ${currency} on ${date}`)
    return amount * rate
  }
}
