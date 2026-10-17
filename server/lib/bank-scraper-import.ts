import { generateDedupHash } from './dedup.js'
import type { ParsedTransaction } from '../types.js'

type Env = Record<string, string | undefined>

export type SupportedScraperProvider = 'leumi'

export type ScrapedTxnLike = {
  date: string | Date
  processedDate?: string | Date
  chargedAmount: number
  chargedCurrency?: string | null
  description: string
  memo?: string | null
  identifier?: string | number | null
  status?: string
}

export type ScrapedAccountLike = {
  accountNumber?: string
  txns: ScrapedTxnLike[]
}

export type ScrapedSpendWiseTransaction = ParsedTransaction & {
  accountNumber: string | null
  status: string
  notes: string | null
}

export function normalizeScraperDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const byType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  )
  return `${byType.year}-${byType.month}-${byType.day}`
}

export function mapScrapedAccountTransactions(
  accounts: ScrapedAccountLike[],
): ScrapedSpendWiseTransaction[] {
  return accounts.flatMap((account) =>
    account.txns
      .filter((tx) => tx.status !== 'pending')
      .map((tx) => {
        const date = normalizeScraperDate(tx.date)
        const amount = tx.chargedAmount
        const merchant = tx.description?.trim() || tx.memo?.trim() || 'Unknown'

        return {
          accountNumber: account.accountNumber ?? null,
          date,
          merchant,
          amount,
          currency: tx.chargedCurrency || 'ILS',
          ref: tx.identifier == null ? undefined : String(tx.identifier),
          raw_hash: generateDedupHash(date, amount, merchant),
          status: tx.status ?? 'completed',
          notes: tx.memo?.trim() || null,
        }
      }),
  )
}

export function resolveCredentialsFromEnv(
  provider: SupportedScraperProvider,
  env: Env = process.env,
): Record<string, string> {
  if (provider !== 'leumi') {
    throw new Error(`Unsupported scraper provider: ${provider}`)
  }

  const username = env.LEUMI_USERNAME ?? env.BANK_LEUMI_USERNAME
  const password = env.LEUMI_PASSWORD ?? env.BANK_LEUMI_PASSWORD

  const missing = [
    username ? null : 'LEUMI_USERNAME',
    password ? null : 'LEUMI_PASSWORD',
  ].filter((item): item is string => item !== null)

  if (missing.length > 0) {
    throw new Error(
      `Missing Leumi credential environment variable(s): ${missing.join(', ')}`,
    )
  }

  if (!username || !password) {
    throw new Error('Missing Leumi credentials')
  }

  return { username, password }
}
