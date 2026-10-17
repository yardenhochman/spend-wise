import { generateDedupHash } from './dedup.js'
import type { ParsedTransaction } from '../types.js'

export type LeumiCardActivityRow = {
  DateDealUTC?: string
  AmountDouble?: number
  DebitCardFirmName?: string
  NextPaymentAmountDouble?: number
  CardTransactionId?: string | number
  TransactionCurrency?: string
  PaymentCurrency?: string
}
export type LeumiCardActivityResponse = {
  Activity?: {
    TabNisTransactionItems?: unknown[]
    TabForeignTransactionItems?: unknown[]
    RealTimeTransItems?: unknown[]
  } | null
}
export type LeumiCardTransactionContext = {
  accountNumber: string
  cardLast4Digits: string
  cycleLabel: string
  valueInIls?: (currency: string, amount: number, date: string) => number
}
export type LeumiCardSpendWiseTransaction = ParsedTransaction & {
  accountNumber: string
  cardLast4Digits: string
  cycleLabel: string
  notes: string
  originalAmount: number
  originalCurrency: string
  billingCurrency: string
  valuationStatus: 'actual' | 'estimated'
  sourceKey: string
}
export function parseLeumiWcfJsonResponse(value: unknown): unknown {
  if (!isRecord(value)) return null
  return typeof value.jsonResp === 'string'
    ? (JSON.parse(value.jsonResp) as unknown)
    : value
}
function currency(
  code: string | undefined,
  fallback: string,
  label = false,
): string {
  if (code == null) return fallback
  const result = (
    { '-1': 'ILS', '1': 'USD', '49': 'EUR' } as Record<string, string>
  )[code]
  // Purchase currency is only a label; billing currency must be known for valuation.
  if (!result && label && /^-?\d{1,4}$/.test(String(code)))
    return `LEUMI-${code}`
  if (!result) throw new Error(`Unsupported card currency code: ${code}`)
  return result
}
export function extractLeumiCardTransactions(
  response: LeumiCardActivityResponse,
  context: LeumiCardTransactionContext,
): LeumiCardSpendWiseTransaction[] {
  // Authorizations are not settled expenses. Only traverse the two posted tables.
  return [
    ...collect(response.Activity?.TabNisTransactionItems).map((row) =>
      mapRow(row, context, false),
    ),
    ...collect(response.Activity?.TabForeignTransactionItems).map((row) =>
      mapRow(row, context, true),
    ),
  ]
}
function collect(value: unknown): LeumiCardActivityRow[] {
  if (Array.isArray(value)) return value.flatMap(collect)
  if (!isRecord(value)) return []
  if ('DateDealUTC' in value && 'DebitCardFirmName' in value)
    return [value as LeumiCardActivityRow]
  return Object.values(value).flatMap(collect)
}
function mapRow(
  row: LeumiCardActivityRow,
  context: LeumiCardTransactionContext,
  foreign: boolean,
): LeumiCardSpendWiseTransaction {
  if (!row.DateDealUTC) throw new Error('Missing Leumi card transaction date')
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(row.DateDealUTC))
  const merchant =
    row.DebitCardFirmName?.replace(/\s+/g, ' ').trim() || 'Unknown'
  const originalCurrency = currency(row.TransactionCurrency, 'ILS', true)
  const billingCurrency = foreign
    ? currency(row.PaymentCurrency, originalCurrency)
    : 'ILS'
  if (foreign && !row.PaymentCurrency)
    throw new Error('Missing foreign billing currency')
  const billed = row.NextPaymentAmountDouble ?? row.AmountDouble
  if (billed == null || !Number.isFinite(billed))
    throw new Error('Missing card amount')
  const originalAmount = -(row.AmountDouble ?? billed)
  const amount =
    billingCurrency === 'ILS'
      ? -billed
      : context.valueInIls?.(billingCurrency, -billed, date)
  if (amount == null || !Number.isFinite(amount))
    throw new Error(`Missing ILS valuation for ${billingCurrency}`)
  const ref =
    row.CardTransactionId == null ? undefined : String(row.CardTransactionId)
  if (!ref) throw new Error('Missing posted card transaction reference')
  const sourceKey = `leumi-card:${context.accountNumber}:${context.cardLast4Digits}:${ref}`
  return {
    ...context,
    date,
    merchant,
    amount: Math.round(amount * 100) / 100,
    currency: 'ILS',
    ref,
    raw_hash: generateDedupHash(date, 0, sourceKey),
    sourceKey,
    originalAmount,
    originalCurrency,
    billingCurrency,
    valuationStatus: billingCurrency === 'ILS' ? 'actual' : 'estimated',
    notes: `leumi account ${context.accountNumber} card ${context.cardLast4Digits} cycle ${context.cycleLabel}`,
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
