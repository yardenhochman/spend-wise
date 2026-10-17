import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import './lib/import-env.js'
import { readBrokerInput } from './lib/broker-input.js'
import { loadCardFxValuation } from './lib/card-fx-rates.js'

import { db, ensureAccount, nowIso } from './db.js'
import {
  extractLeumiCardTransactions,
  parseLeumiWcfJsonResponse,
  type LeumiCardSpendWiseTransaction,
} from './lib/leumi-card-import.js'
import { resolveCredentialsFromEnv } from './lib/bank-scraper-import.js'
import {
  buildFuzzyIndex,
  findFuzzyDuplicate,
  normalizeMerchant,
} from './lib/dedup.js'
import type { RuleRow } from './types.js'

type CliOptions = {
  input?: string
  from: string
  write: boolean
  showBrowser: boolean
  accountSuffix: string | null
}

type ScrapeSummary = {
  accountCount: number
  cardCount: number
  monthsVisited: number
  rawTransactions: number
}

type ImportSummary = ScrapeSummary & {
  provider: 'leumi-cards'
  from: string
  mode: 'dry-run' | 'write'
  parsed: number
  inserted: number
  deduped: number
  crossSourceDupes: number
  legacyForeignNeedsReview: number
}

type ScrapedCardAccount = {
  accountNumber: string
  cardLast4Digits: string
  cycleLabel: string
  transactions: LeumiCardSpendWiseTransaction[]
}

type PuppeteerPage = {
  goto: (url: string) => Promise<void>
  click: (selector: string) => Promise<void>
  evaluate: <T>(
    fn: (...args: unknown[]) => T | Promise<T>,
    ...args: unknown[]
  ) => Promise<T>
  on: (event: string, handler: (value: unknown) => void) => void
  waitForResponse: (
    predicate: (response: PuppeteerResponse) => boolean | Promise<boolean>,
    options?: { timeout?: number },
  ) => Promise<PuppeteerResponse>
}

type PuppeteerResponse = {
  url: () => string
  request: () => { method: () => string }
  json: () => Promise<unknown>
}

const LEUMI_CARDS_URL =
  'https://hb2.bankleumi.co.il/eBanking/SO/SPA.aspx#/ts/CardsWorld?cards=1'

const CARD_INFO_MODULE = 'UC_SO_GetCreditCardsInfo'
const CARD_ACTIVITY_MODULE = 'UC_MS_125_CreditCardsInfo'

const HEBREW_MONTHS = new Map([
  ['ינואר', 1],
  ['פברואר', 2],
  ['מרץ', 3],
  ['אפריל', 4],
  ['מאי', 5],
  ['יוני', 6],
  ['יולי', 7],
  ['אוגוסט', 8],
  ['ספטמבר', 9],
  ['אוקטובר', 10],
  ['נובמבר', 11],
  ['דצמבר', 12],
])

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    from: '2025-06-01',
    write: false,
    showBrowser: false,
    accountSuffix: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--input' || arg.startsWith('--input=')) {
      options.input =
        arg === '--input' ? argv[++i] : arg.slice('--input='.length)
      if (!options.input) throw new Error('--input requires a file')
    } else if (arg === '--write') {
      options.write = true
    } else if (arg === '--show-browser') {
      options.showBrowser = true
    } else if (arg === '--from') {
      options.from = readDate(argv[++i], '--from')
    } else if (arg.startsWith('--from=')) {
      options.from = readDate(arg.slice('--from='.length), '--from')
    } else if (arg === '--account-suffix') {
      options.accountSuffix = argv[++i] ?? null
    } else if (arg.startsWith('--account-suffix=')) {
      options.accountSuffix = arg.slice('--account-suffix='.length)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function readDate(value: string | undefined, flag: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flag} must be YYYY-MM-DD`)
  }
  return value
}

async function loadLeumiScraperClass(): Promise<
  new (options: unknown) => unknown
> {
  const require = createRequire(import.meta.url)
  const packageJson = require.resolve('israeli-bank-scrapers/package.json')
  const scraperPath = path.join(
    path.dirname(packageJson),
    'lib/scrapers/leumi.js',
  )
  const module = await import(pathToFileURL(scraperPath).href)
  return (module.default ?? module) as new (options: unknown) => unknown
}

async function scrapeLeumiCards(
  options: CliOptions,
): Promise<{ accounts: ScrapedCardAccount[]; scrape: ScrapeSummary }> {
  const { CompanyTypes } = (await import('israeli-bank-scrapers')) as {
    CompanyTypes: Record<string, unknown>
  }
  const LeumiScraper = await loadLeumiScraperClass()
  const valueInIls = await loadCardFxValuation(options.from)

  class LeumiCardsScraper extends (LeumiScraper as new (options: unknown) => {
    page: PuppeteerPage
    navigateTo: (url: string) => Promise<void>
    scrape: (credentials: Record<string, string>) => Promise<unknown>
  }) {
    async fetchData(): Promise<{
      success: true
      accounts: ScrapedCardAccount[]
      scrape: ScrapeSummary
    }> {
      const accounts = await scrapeCardsFromPage(
        this.page,
        options.from,
        options.accountSuffix,
        valueInIls,
      )
      const scrape = {
        accountCount: new Set(accounts.map((account) => account.accountNumber))
          .size,
        cardCount: new Set(
          accounts.map(
            (account) => `${account.accountNumber}:${account.cardLast4Digits}`,
          ),
        ).size,
        monthsVisited: accounts.length,
        rawTransactions: accounts.reduce(
          (count, account) => count + account.transactions.length,
          0,
        ),
      }
      return { success: true, accounts, scrape }
    }
  }

  const scraper = new LeumiCardsScraper({
    companyId: CompanyTypes.leumi,
    showBrowser: options.showBrowser,
    timeout: 120_000,
    defaultTimeout: 60_000,
    args: options.showBrowser
      ? ['--disable-blink-features=AutomationControlled']
      : [],
  }) as {
    scrape: (credentials: Record<string, string>) => Promise<{
      success: boolean
      accounts?: ScrapedCardAccount[]
      scrape?: ScrapeSummary
      errorType?: string
      errorMessage?: string
    }>
  }

  const result = await scraper.scrape(resolveCredentialsFromEnv('leumi'))
  if (!result.success) {
    throw new Error(
      `Scrape failed: ${sanitizeErrorMessage(
        result.errorMessage ?? result.errorType ?? 'unknown error',
      )}`,
    )
  }

  return {
    accounts: result.accounts ?? [],
    scrape: result.scrape ?? {
      accountCount: 0,
      cardCount: 0,
      monthsVisited: 0,
      rawTransactions: 0,
    },
  }
}

async function scrapeCardsFromPage(
  page: PuppeteerPage,
  from: string,
  accountSuffix: string | null,
  valueInIls: (currency: string, amount: number, date: string) => number,
): Promise<ScrapedCardAccount[]> {
  const scraped: ScrapedCardAccount[] = []

  await navigateCards(page)
  const accountNumbers = (await getAccountNumbers(page)).filter(
    (accountNumber) => !accountSuffix || accountNumber.endsWith(accountSuffix),
  )

  for (const accountNumber of accountNumbers) {
    await selectAccount(page, accountNumber)
    const cardInfoPromise = waitForCardInfo(page)
    await navigateCards(page)

    const cardInfo = await cardInfoPromise
    const cards = extractCardMetadata(cardInfo)
    const months = (await getMonthLabels(page))
      .filter((label) => monthStart(label) >= monthStart(from))
      .sort((left, right) => monthStart(left).localeCompare(monthStart(right)))

    for (const month of months) {
      const activity = await selectMonthAndReadActivity(page, month)
      const selectedCards = cards.filter(
        (card) => isRecord(activity) && card.cardIndex === activity.CardIndex,
      )
      if (selectedCards.length !== 1)
        throw new Error('Cannot identify selected card in activity response')
      for (const card of selectedCards) {
        const transactions = extractLeumiCardTransactions(
          activity as Parameters<typeof extractLeumiCardTransactions>[0],
          {
            accountNumber,
            cardLast4Digits: card.cardLast4Digits,
            cycleLabel: month,
            valueInIls,
          },
        ).filter((transaction) => transaction.date >= from)

        scraped.push({
          accountNumber,
          cardLast4Digits: card.cardLast4Digits,
          cycleLabel: month,
          transactions,
        })
      }
    }
  }

  return scraped
}

async function navigateCards(page: PuppeteerPage): Promise<void> {
  await page.goto(LEUMI_CARDS_URL)
  await sleep(7_000)
}

async function getAccountNumbers(page: PuppeteerPage): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      (globalThis as unknown as { document: any }).document.querySelectorAll(
        'span.display-number-li',
      ),
    )
      .map((element: any) => element.textContent ?? '')
      .map((text) => text.match(/[\d-]+\/\d+/)?.[0] ?? null)
      .filter((value): value is string => value !== null),
  )
}

async function selectAccount(
  page: PuppeteerPage,
  accountNumber: string,
): Promise<void> {
  await page.click('.number.combo-inner')
  await sleep(500)
  const selected = await page.evaluate((target) => {
    const option = Array.from(
      (globalThis as unknown as { document: any }).document.querySelectorAll(
        'span.display-number-li',
      ),
    ).find((element: any) =>
      (element.textContent ?? '').includes(String(target)),
    ) as any
    option?.click()
    return Boolean(option)
  }, accountNumber)

  if (!selected) throw new Error(`Leumi account not found: ${accountNumber}`)
  await sleep(5_000)
}

async function waitForCardInfo(page: PuppeteerPage): Promise<unknown> {
  const response = await page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      candidate.url().includes(`moduleName=${CARD_INFO_MODULE}`),
    { timeout: 60_000 },
  )
  return parseLeumiWcfJsonResponse(await response.json())
}

async function selectMonthAndReadActivity(
  page: PuppeteerPage,
  monthLabel: string,
): Promise<unknown> {
  let activityPayload: unknown = null
  const responsePromise = page.waitForResponse(
    async (candidate) => {
      if (
        candidate.request().method() !== 'POST' ||
        !candidate.url().includes(`moduleName=${CARD_ACTIVITY_MODULE}`)
      ) {
        return false
      }

      try {
        const payload = parseLeumiWcfJsonResponse(await candidate.json())
        const isActivityPayload = isRecord(payload) && 'Activity' in payload
        if (isActivityPayload) activityPayload = payload
        return isActivityPayload
      } catch {
        return false
      }
    },
    { timeout: 60_000 },
  )

  await openMonthDropdown(page)
  const selected = await page.evaluate((target) => {
    const option = Array.from(
      (globalThis as unknown as { document: any }).document.querySelectorAll(
        'li,button,a,[role=option]',
      ),
    ).find(
      (element: any) => (element.textContent ?? '').trim() === String(target),
    ) as any
    option?.click()
    return Boolean(option)
  }, monthLabel)

  if (!selected) throw new Error(`Leumi card month not found: ${monthLabel}`)

  await responsePromise
  return activityPayload
}

async function openMonthDropdown(page: PuppeteerPage): Promise<void> {
  await page.evaluate(() => {
    const monthButton = Array.from(
      (globalThis as unknown as { document: any }).document.querySelectorAll(
        'button',
      ),
    ).find(
      (button: any) =>
        /\d{4}/.test(button.innerText || button.textContent || '') &&
        /ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר/.test(
          button.innerText || button.textContent || '',
        ),
    ) as any
    monthButton?.click()
  })
  await sleep(500)
}

async function getMonthLabels(page: PuppeteerPage): Promise<string[]> {
  await openMonthDropdown(page)
  return page.evaluate(() => {
    const labels = Array.from(
      (globalThis as unknown as { document: any }).document.querySelectorAll(
        'li',
      ),
    )
      .map((element: any) => (element.textContent ?? '').trim())
      .filter((text) =>
        /^(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר) \d{4}$/.test(
          text,
        ),
      )
    return Array.from(new Set(labels))
  })
}

function extractCardMetadata(
  value: unknown,
): { cardLast4Digits: string; cardIndex: number }[] {
  if (!isRecord(value)) return []
  const cards = value.CreditCardsItems
  if (!Array.isArray(cards)) return []
  return cards
    .map((card) => {
      if (!isRecord(card) || typeof card.CardLast4Digits !== 'string')
        return null
      return {
        cardLast4Digits: card.CardLast4Digits,
        cardIndex: Number(card.CardIndex),
      }
    })
    .filter(
      (card): card is { cardLast4Digits: string; cardIndex: number } =>
        card !== null,
    )
}

function monthStart(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7)

  const [monthName, year] = value.split(/\s+/)
  const month = HEBREW_MONTHS.get(monthName)
  if (!month || !year)
    throw new Error(`Unsupported Leumi month label: ${value}`)
  return `${year}-${String(month).padStart(2, '0')}`
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

function importTransactions(args: {
  from: string
  write: boolean
  accounts: ScrapedCardAccount[]
  scrape: ScrapeSummary
}): ImportSummary {
  const transactions = args.accounts.flatMap((account) => account.transactions)
  const summary: ImportSummary = {
    provider: 'leumi-cards',
    from: args.from,
    mode: args.write ? 'write' : 'dry-run',
    ...args.scrape,
    parsed: transactions.length,
    inserted: 0,
    deduped: 0,
    crossSourceDupes: 0,
    legacyForeignNeedsReview: 0,
  }

  const existingTxns = db
    .prepare(
      'SELECT date, amount, merchant, raw_hash FROM transactions t WHERE NOT EXISTS (SELECT 1 FROM transaction_valuations v WHERE v.transaction_id=t.id)',
    )
    .all() as {
    date: string
    amount: number
    merchant: string
    raw_hash: string
  }[]
  const existingHashes = new Set(existingTxns.map((tx) => tx.raw_hash))
  const fuzzyIndex = buildFuzzyIndex(existingTxns)
  const accountId = ensureAccount('Leumi', 'Credit Card', 'ILS')
  const importId = randomUUID()

  const insertFile = db.prepare(
    'INSERT INTO statement_files (id, filename, type, imported_at, parser_id, status) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const insertTx = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (id, date, merchant, amount, currency, account_id, category_id, confidence, is_recurring_candidate, notes, source_file_id, raw_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertAll = db.transaction(() => {
    if (args.write) {
      insertFile.run(
        importId,
        `leumi-cards-${args.from}`,
        'scraper',
        nowIso(),
        'leumi-cards:cards-world',
        'completed',
      )
    }

    for (const tx of transactions) {
      const linked = db
        .prepare(
          'SELECT transaction_id FROM transaction_valuations WHERE source_key = ?',
        )
        .get(tx.sourceKey)
      if (linked) {
        summary.deduped += 1
        continue
      }
      // Old imports may contain a foreign amount mislabeled ILS. Never add a
      // newly-valued duplicate on top; require an audited reconciliation first.
      if (
        tx.billingCurrency !== 'ILS' &&
        existingTxns.some(
          (old) =>
            Math.abs(Math.abs(old.amount) - Math.abs(tx.originalAmount)) <
              0.01 &&
            Math.abs(Date.parse(old.date) - Date.parse(tx.date)) <= 86400000 &&
            normalizeMerchant(old.merchant).toUpperCase() ===
              normalizeMerchant(tx.merchant).toUpperCase(),
        )
      ) {
        summary.legacyForeignNeedsReview += 1
        continue
      }

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

      const transactionId = randomUUID()
      const response = insertTx.run(
        transactionId,
        tx.date,
        tx.merchant,
        tx.amount,
        tx.currency,
        accountId,
        applyCategoryRules(tx.merchant),
        0,
        0,
        tx.notes,
        importId,
        tx.raw_hash,
      )

      if (response.changes > 0) {
        summary.inserted += 1
        db.prepare(
          `INSERT INTO transaction_valuations (transaction_id,source_key,original_amount,original_currency,billing_currency,valuation_status,valuation_note,updated_at) VALUES (?,?,?,?,?,?,?,?)`,
        ).run(
          transactionId,
          tx.sourceKey,
          tx.originalAmount,
          tx.originalCurrency,
          tx.billingCurrency,
          tx.valuationStatus,
          tx.valuationStatus === 'estimated'
            ? 'BOI representative rate at purchase date; fees and final settlement not verified'
            : 'Card statement ILS amount',
          nowIso(),
        )
        existingHashes.add(tx.raw_hash)
      } else {
        summary.deduped += 1
      }
    }
  })

  insertAll()
  return summary
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2))
    const input = options.input
      ? await readBrokerInput(options.input, 'leumi-cards')
      : null
    const { accounts, scrape } = input
      ? {
          accounts: input.payload.accounts as ScrapedCardAccount[],
          scrape: input.payload.scrape as ScrapeSummary,
        }
      : await scrapeLeumiCards(options)
    const summary = importTransactions({
      from: input ? String(input.coverage.requested_from) : options.from,
      write: options.write,
      accounts,
      scrape,
    })
    console.log(
      JSON.stringify(
        {
          ...summary,
          ...(input
            ? {
                broker: {
                  fetchedAt: input.fetched_at,
                  coverage: input.coverage,
                },
              }
            : {}),
        },
        null,
        2,
      ),
    )
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
