import { randomUUID } from 'node:crypto'

import './lib/import-env.js'
import { readBrokerInput } from './lib/broker-input.js'
import { isInternalSettlement } from './lib/internal-settlements.js'

import { db, ensureAccount, nowIso } from './db.js'
import {
  mapScrapedAccountTransactions,
  resolveCredentialsFromEnv,
  type SupportedScraperProvider,
} from './lib/bank-scraper-import.js'
import { buildFuzzyIndex, findFuzzyDuplicate } from './lib/dedup.js'
import type { RuleRow } from './types.js'

type CliOptions = {
  input?: string
  provider: SupportedScraperProvider
  from: string | null
  write: boolean
  showBrowser: boolean
}

type ScraperModule = {
  CompanyTypes: Record<string, unknown>
  createScraper: (options: Record<string, unknown>) => {
    scrape: (credentials: Record<string, string>) => Promise<{
      success: boolean
      accounts?: unknown[]
      errorType?: string
      errorMessage?: string
    }>
  }
}

type ImportSummary = {
  provider: string
  from: string
  mode: 'dry-run' | 'write'
  accounts: number
  parsed: number
  inserted: number
  deduped: number
  crossSourceDupes: number
  pendingSkipped: number
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    provider: 'leumi',
    from: null,
    write: false,
    showBrowser: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--input' || arg.startsWith('--input=')) {
      options.input = arg === '--input' ? argv[++i] : arg.slice('--input='.length)
      if (!options.input) throw new Error('--input requires a file')
    } else if (arg === '--write') {
      options.write = true
    } else if (arg === '--show-browser') {
      options.showBrowser = true
    } else if (arg === '--provider') {
      options.provider = readProvider(argv[++i])
    } else if (arg.startsWith('--provider=')) {
      options.provider = readProvider(arg.slice('--provider='.length))
    } else if (arg === '--from') {
      options.from = readDate(argv[++i], '--from')
    } else if (arg.startsWith('--from=')) {
      options.from = readDate(arg.slice('--from='.length), '--from')
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function readProvider(value: string | undefined): SupportedScraperProvider {
  if (value === 'leumi') return value
  throw new Error(`Unsupported provider: ${value ?? '(missing)'}`)
}

function readDate(value: string | undefined, flag: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flag} must be YYYY-MM-DD`)
  }
  return value
}

function defaultStartDate(): string {
  const row = db
    .prepare("SELECT MAX(date) as maxDate FROM transactions WHERE date <> ''")
    .get() as { maxDate: string | null }

  if (!row.maxDate) return '2026-01-01'

  const date = new Date(`${row.maxDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function applyCategoryRules(merchant: string): string | null {
  const rules = db
    .prepare('SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC')
    .all() as RuleRow[]

  for (const rule of rules) {
    let matches = false
    if (rule.match_type === 'contains') {
      matches = merchant.toLowerCase().includes(rule.pattern.toLowerCase())
    } else if (rule.match_type === 'exact') {
      matches = merchant.toLowerCase() === rule.pattern.toLowerCase()
    } else if (rule.match_type === 'regex') {
      try {
        matches = new RegExp(rule.pattern, 'i').test(merchant)
      } catch {
        matches = false
      }
    }

    if (matches) return rule.category_id
  }

  return null
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/\b\d{5,}\b/g, '[REDACTED]')
    .replace(
      /"(password|username|userCode|id|card6Digits|cardSuffix)"\s*:\s*"[^"]*"/gi,
      '"$1":"[REDACTED]"',
    )
    .replace(
      /\b(password|username|userCode|id|card6Digits|cardSuffix)\s*=\s*\S+/gi,
      '$1=[REDACTED]',
    )
}

async function loadScraper(): Promise<ScraperModule> {
  return (await import('israeli-bank-scrapers')) as unknown as ScraperModule
}

async function scrape(options: CliOptions): Promise<{
  accounts: unknown[]
  from: string
}> {
  const scraperModule = await loadScraper()
  const companyId = scraperModule.CompanyTypes[options.provider]
  if (!companyId)
    throw new Error(`Scraper provider not found: ${options.provider}`)

  const from = options.from ?? defaultStartDate()
  const credentials = resolveCredentialsFromEnv(options.provider)
  const scraper = scraperModule.createScraper({
    companyId,
    startDate: new Date(`${from}T00:00:00.000Z`),
    combineInstallments: false,
    showBrowser: options.showBrowser,
    verbose: options.showBrowser,
    timeout: 60_000,
    args: options.showBrowser
      ? ['--disable-blink-features=AutomationControlled']
      : [],
  })

  const result = await scraper.scrape(credentials)
  if (!result.success) {
    const detail = result.errorMessage ?? result.errorType ?? 'unknown error'
    throw new Error(`Scrape failed: ${sanitizeErrorMessage(detail)}`)
  }

  return { accounts: result.accounts ?? [], from }
}

function importTransactions(args: {
  provider: SupportedScraperProvider
  from: string
  write: boolean
  accounts: unknown[]
}): ImportSummary {
  const mapped = mapScrapedAccountTransactions(
    args.accounts as Parameters<typeof mapScrapedAccountTransactions>[0],
  )
  const rawCount = (args.accounts as { txns?: unknown[] }[]).reduce(
    (count, account) => count + (account.txns?.length ?? 0),
    0,
  )

  const summary: ImportSummary = {
    provider: args.provider,
    from: args.from,
    mode: args.write ? 'write' : 'dry-run',
    accounts: args.accounts.length,
    parsed: mapped.length,
    inserted: 0,
    deduped: 0,
    crossSourceDupes: 0,
    pendingSkipped: rawCount - mapped.length,
  }

  const existingTxns = db
    .prepare('SELECT date, amount, merchant, raw_hash FROM transactions')
    .all() as {
    date: string
    amount: number
    merchant: string
    raw_hash: string
  }[]
  const existingHashes = new Set(existingTxns.map((t) => t.raw_hash))
  const fuzzyIndex = buildFuzzyIndex(existingTxns)

  const importId = randomUUID()
  const accountId = ensureAccount('Leumi', 'Checking', 'ILS')
  const insertFile = db.prepare(
    'INSERT INTO statement_files (id, filename, type, imported_at, parser_id, status) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const insertTx = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (id, date, merchant, amount, currency, account_id, category_id, confidence, is_recurring_candidate, notes, source_file_id, raw_hash, is_internal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertAll = db.transaction(() => {
    if (args.write) {
      insertFile.run(
        importId,
        `${args.provider}-scraper-${args.from}`,
        'scraper',
        nowIso(),
        `israeli-bank-scrapers:${args.provider}`,
        'completed',
      )
    }

    for (const tx of mapped) {
      if (existingHashes.has(tx.raw_hash)) {
        summary.deduped += 1
        continue
      }

      if (findFuzzyDuplicate(tx, fuzzyIndex)) {
        summary.crossSourceDupes += 1
        continue
      }

      if (!args.write) {
        summary.inserted += 1
        continue
      }

      const response = insertTx.run(
        randomUUID(),
        tx.date,
        tx.merchant,
        tx.amount,
        tx.currency,
        accountId,
        applyCategoryRules(tx.merchant),
        0,
        0,
        buildTransactionNotes(tx.accountNumber, tx.notes),
        importId,
        tx.raw_hash,
        isInternalSettlement(tx.merchant) ? 1 : 0,
      )

      if (response.changes > 0) {
        summary.inserted += 1
        existingHashes.add(tx.raw_hash)
      } else {
        summary.deduped += 1
      }
    }
  })

  insertAll()
  return summary
}

function buildTransactionNotes(
  accountNumber: string | null,
  transactionNotes: string | null,
): string | null {
  return (
    [
      accountNumber ? `scraper account ${accountNumber}` : null,
      transactionNotes,
    ]
      .filter((part): part is string => Boolean(part))
      .join('; ') || null
  )
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2))
    const input = options.input ? await readBrokerInput(options.input, 'leumi-bank') : null
    const { accounts, from } = input
      ? { accounts: input.payload.accounts as unknown[], from: options.from ?? String(input.coverage.requested_from) }
      : await scrape(options)
    const summary = importTransactions({
      provider: options.provider,
      from,
      write: options.write,
      accounts,
    })
    console.log(JSON.stringify({ ...summary, ...(input ? { broker: { fetchedAt: input.fetched_at, coverage: input.coverage } } : {}) }, null, 2))
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status: 'failed',
          error:
            error instanceof Error
              ? sanitizeErrorMessage(error.message)
              : String(error),
        },
        null,
        2,
      ),
    )
    process.exit(1)
  }
}

void main()
