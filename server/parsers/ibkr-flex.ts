import type {
  InvestmentFlexParseResult,
  ParsedInvestmentPosition,
} from '../types.js'

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrPattern = /([A-Za-z0-9_:-]+)="([^"]*)"/g
  let match: RegExpExecArray | null

  while ((match = attrPattern.exec(tag)) !== null) {
    attrs[match[1]] = decodeXmlEntities(match[2])
  }

  return attrs
}

function parseNumber(value: string | undefined, fallback = 0): number {
  if (!value) return fallback
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseDate(value: string | undefined): string {
  if (!value || value.length !== 8) return ''
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function collectTags(xml: string, tagName: string): Record<string, string>[] {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)\\/>`, 'g')
  const items: Record<string, string>[] = []
  let match: RegExpExecArray | null

  while ((match = pattern.exec(xml)) !== null) {
    items.push(parseAttributes(match[1]))
  }

  return items
}

export function parseIbkrFlexXml(xml: string): InvestmentFlexParseResult {
  if (!xml.includes('<FlexQueryResponse')) {
    throw new Error('Not an Interactive Brokers Flex Query XML file')
  }

  const flexStatementMatch = xml.match(/<FlexStatement\b([^>]*)>/)
  if (!flexStatementMatch) {
    throw new Error('Missing FlexStatement node')
  }
  const flexStatement = parseAttributes(flexStatementMatch[1])

  const accountInfoMatch = xml.match(/<AccountInformation\b([^>]*)\/>/)
  if (!accountInfoMatch) {
    throw new Error('Missing AccountInformation node')
  }
  const accountInfo = parseAttributes(accountInfoMatch[1])

  const summaryRows = collectTags(xml, 'FIFOPerformanceSummaryUnderlying')
  const totalSummary = summaryRows.find(
    (row) => row.description === 'Total (All Assets)',
  )

  const positions: ParsedInvestmentPosition[] = collectTags(xml, 'OpenPosition')
    .filter((row) => parseNumber(row.position, 0) !== 0)
    .map((row) => {
      const fxRateToBase = parseNumber(row.fxRateToBase, 1)
      const quantity = parseNumber(row.position)
      const marketPrice = parseNumber(row.markPrice)
      const marketValue = parseNumber(row.positionValue)
      const costBasis = parseNumber(row.costBasisMoney)
      const unrealizedPnl = parseNumber(row.fifoPnlUnrealized)

      return {
        symbol: row.symbol ?? 'Unknown',
        description: row.description ?? row.symbol ?? 'Unknown',
        asset_category: row.assetCategory ?? null,
        sub_category: row.subCategory ?? null,
        listing_exchange: row.listingExchange ?? null,
        currency: row.currency ?? accountInfo.currency ?? 'USD',
        fx_rate_to_base: fxRateToBase,
        quantity,
        market_price: marketPrice,
        market_value: marketValue,
        market_value_base: marketValue * fxRateToBase,
        cost_basis: costBasis,
        cost_basis_base: costBasis * fxRateToBase,
        avg_open_price: parseNumber(row.openPrice),
        unrealized_pnl: unrealizedPnl,
        unrealized_pnl_base: unrealizedPnl * fxRateToBase,
        portfolio_weight: parseNumber(row.percentOfNAV) / 100,
        side: row.side ?? null,
        isin: row.isin ?? null,
      }
    })

  const portfolioValueBase = positions.reduce(
    (sum, position) => sum + position.market_value_base,
    0,
  )

  return {
    parserId: 'ibkr-flex',
    account_number: accountInfo.accountId ?? flexStatement.accountId ?? '',
    account_name: accountInfo.name ?? null,
    base_currency: accountInfo.currency ?? 'ILS',
    from_date: parseDate(flexStatement.fromDate),
    to_date: parseDate(flexStatement.toDate),
    report_date: parseDate(flexStatement.toDate),
    period: flexStatement.period ?? null,
    portfolio_value_base: portfolioValueBase,
    unrealized_pnl_base: parseNumber(totalSummary?.totalUnrealizedPnl),
    positions,
    unparsed: [],
  }
}
