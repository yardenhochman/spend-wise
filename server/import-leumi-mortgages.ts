import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import './lib/import-env.js'
import { readBrokerInput } from './lib/broker-input.js'

import { collectLeumiMortgageTracks } from './lib/leumi-mortgage-fetch.js'

import { resolveCredentialsFromEnv } from './lib/bank-scraper-import.js'
import {
  extractLeumiMortgageSnapshot,
  type LeumiMortgageSnapshot,
} from './lib/leumi-mortgage-import.js'

type CliOptions = {
  input?: string
  write: boolean
  showBrowser: boolean
  accountSuffix: string
  out: string
}

type MortgageScrapeResult = {
  snapshot: LeumiMortgageSnapshot
  rawResponse: unknown
}

type PuppeteerFrame = {
  url: () => string
  evaluate: <T>(
    fn: (...args: unknown[]) => T | Promise<T>,
    ...args: unknown[]
  ) => Promise<T>
}

type PuppeteerPage = {
  waitForFrame: (
    predicate: (frame: PuppeteerFrame) => boolean,
    options?: { timeout: number },
  ) => Promise<PuppeteerFrame>
  goto: (url: string) => Promise<void>
  click: (selector: string) => Promise<void>
  evaluate: <T>(
    fn: (...args: unknown[]) => T | Promise<T>,
    ...args: unknown[]
  ) => Promise<T>
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
const LEUMI_MORTGAGES_URL =
  'https://hb2.bankleumi.co.il/ebanking/SO/SPA.aspx#/ts/reactFrame?action=mortgages'
const MORTGAGE_DETAILS_PATH =
  '/uiapiproxy/v1/digital-retails/mobile/mortgagedetails'

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    write: false,
    showBrowser: false,
    accountSuffix: process.env.SPENDWISE_LEUMI_ACCOUNT_SUFFIX?.trim() ?? '',
    out: 'private/leumi-mortgages.latest.json',
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
    } else if (arg === '--account-suffix') {
      options.accountSuffix = readRequiredValue(argv[++i], '--account-suffix')
    } else if (arg.startsWith('--account-suffix=')) {
      options.accountSuffix = readRequiredValue(
        arg.slice('--account-suffix='.length),
        '--account-suffix',
      )
    } else if (arg === '--out') {
      options.out = readRequiredValue(argv[++i], '--out')
    } else if (arg.startsWith('--out=')) {
      options.out = readRequiredValue(arg.slice('--out='.length), '--out')
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!options.input && !options.accountSuffix) {
    throw new Error(
      'Set SPENDWISE_LEUMI_ACCOUNT_SUFFIX or --account-suffix before scraping',
    )
  }
  return options
}

function readRequiredValue(value: string | undefined, flag: string): string {
  if (!value?.trim()) throw new Error(`${flag} requires a value`)
  return value.trim()
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

async function scrapeLeumiMortgages(
  options: CliOptions,
): Promise<MortgageScrapeResult> {
  const { CompanyTypes } = (await import('israeli-bank-scrapers')) as {
    CompanyTypes: Record<string, unknown>
  }
  const LeumiScraper = await loadLeumiScraperClass()

  class LeumiMortgagesScraper extends (LeumiScraper as new (
    options: unknown,
  ) => {
    page: PuppeteerPage
    scrape: (credentials: Record<string, string>) => Promise<unknown>
  }) {
    async fetchData(): Promise<{
      success: true
      result: MortgageScrapeResult
    }> {
      const rawResponse = await scrapeMortgageDetailsFromPage(
        this.page,
        options.accountSuffix,
      )
      const snapshot = extractLeumiMortgageSnapshot(rawResponse)
      return { success: true, result: { snapshot, rawResponse } }
    }
  }

  const scraper = new LeumiMortgagesScraper({
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
      result?: MortgageScrapeResult
      errorType?: string
      errorMessage?: string
    }>
  }

  const result = await scraper.scrape(resolveCredentialsFromEnv('leumi'))
  if (!result.success || !result.result) {
    throw new Error(
      `Scrape failed: ${sanitizeErrorMessage(
        result.errorMessage ?? result.errorType ?? 'unknown error',
      )}`,
    )
  }

  return result.result
}

async function scrapeMortgageDetailsFromPage(
  page: PuppeteerPage,
  accountSuffix: string,
): Promise<unknown> {
  await navigateCards(page)
  const accountNumbers = await getAccountNumbers(page)
  const accountNumber = accountNumbers.find((candidate) =>
    candidate.endsWith(accountSuffix),
  )
  if (!accountNumber) {
    throw new Error('Selected Leumi account was not found')
  }

  await selectAccount(page, accountNumber)
  const responsePromise = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'GET' &&
      candidate.url().toLowerCase().includes(MORTGAGE_DETAILS_PATH),
    { timeout: 60_000 },
  )
  await page.goto(LEUMI_MORTGAGES_URL)
  const response = await responsePromise
  const overview = await response.json()
  const frame = await page.waitForFrame(
    (candidate) => candidate.url().includes('/mortgages/index.html'),
    { timeout: 30_000 },
  )
  return collectLeumiMortgageTracks(overview, (key) =>
    frame.evaluate(async (mortgageKey) => {
      // The mortgage iframe permits this endpoint; the parent banking page does not.
      const response = await fetch(
        `/uiapiproxy/v1/digital-retails/mobile/${encodeURIComponent(String(mortgageKey))}/loanInfo`,
        { credentials: 'same-origin', signal: AbortSignal.timeout(30_000) },
      )
      if (!response.ok)
        throw new Error(`Mortgage details HTTP ${response.status}`)
      return response.json()
    }, key),
  )
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

async function writeSnapshots(
  options: CliOptions,
  result: MortgageScrapeResult,
): Promise<{ normalizedPath: string; rawPath?: string }> {
  const normalizedPath = path.resolve(options.out)
  const rawPath = normalizedPath.replace(/\.json$/i, '.raw.json')
  await mkdir(path.dirname(normalizedPath), { recursive: true })
  await writeFile(
    normalizedPath,
    `${JSON.stringify(result.snapshot, null, 2)}\n`,
  )
  if (result.rawResponse !== null)
    await writeFile(rawPath, `${JSON.stringify(result.rawResponse, null, 2)}\n`)
  return {
    normalizedPath,
    rawPath: result.rawResponse === null ? undefined : rawPath,
  }
}

function buildSummary(args: {
  options: CliOptions
  result: MortgageScrapeResult
  paths?: { normalizedPath: string; rawPath?: string }
}): Record<string, unknown> {
  return {
    provider: 'leumi-mortgages',
    mode: args.options.write ? 'write' : 'dry-run',
    mortgageCount: args.result.snapshot.mortgageCount,
    asOfDate: args.result.snapshot.asOfDate,
    trackCoverage: args.result.snapshot.trackCoverage,
    mortgagesWithPaymentDifferences: args.result.snapshot.mortgages.filter(
      (mortgage) =>
        mortgage.trackPaymentDifference !== null &&
        Math.abs(mortgage.trackPaymentDifference) > 0.01,
    ).length,
    hasClearingBalanceAll: args.result.snapshot.clearingBalanceAll !== null,
    hasInterestData: args.result.snapshot.mortgages.some(
      (mortgage) =>
        mortgage.interestPredicted !== null ||
        mortgage.interestForCompare !== null,
    ),
    normalizedPath: args.paths?.normalizedPath,
    rawPath: args.paths?.rawPath,
  }
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/\b\d{5,}\b/g, '[REDACTED]')
    .replace(
      /"(password|username|userCode|id|card6Digits|cardSuffix|mortgageKey)"\s*:\s*"[^"]*"/gi,
      '"$1":"[REDACTED]"',
    )
    .replace(
      /\b(password|username|userCode|id|card6Digits|cardSuffix|mortgageKey)\s*=\s*\S+/gi,
      '$1=[REDACTED]',
    )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2))
    const input = options.input
      ? await readBrokerInput(options.input, 'leumi-mortgages')
      : null
    const result: MortgageScrapeResult = input
      ? { snapshot: input.payload as LeumiMortgageSnapshot, rawResponse: null }
      : await scrapeLeumiMortgages(options)
    const paths = options.write
      ? await writeSnapshots(options, result)
      : undefined
    console.log(
      JSON.stringify(buildSummary({ options, result, paths }), null, 2),
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
