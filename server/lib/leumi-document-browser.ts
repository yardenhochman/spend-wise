/// <reference lib="dom" />
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Page } from 'puppeteer'
import { resolveCredentialsFromEnv } from './bank-scraper-import.js'
import { DOCUMENT_TYPES, type DocumentType } from './leumi-document-store.js'

export const ORDER_URL =
  'https://hb2.bankleumi.co.il/ebanking/PartialUC/UC_250/MortgagesDocumentRequest.aspx'
export const MAILBOX_URL =
  'https://hb2.bankleumi.co.il/ebanking/SupportAndReports/EbankMail.aspx'

export async function withLeumiDocuments<T>(
  action: (page: Page) => Promise<T>,
): Promise<T> {
  const require = createRequire(import.meta.url)
  const root = path.dirname(
    require.resolve('israeli-bank-scrapers/package.json'),
  )
  const imported = await import(
    pathToFileURL(path.join(root, 'lib/scrapers/leumi.js')).href
  )
  const Base = (imported.default ?? imported) as new (options: unknown) => {
    page: Page
    scrape: (
      credentials: Record<string, string>,
    ) => Promise<{ success: boolean; result?: T }>
  }
  class DocumentsScraper extends Base {
    async fetchData() {
      try {
        return { success: true, result: await action(this.page) }
      } catch (error) {
        await recordPrivateError(error)
        throw error
      }
    }
  }
  const scraper = new DocumentsScraper({
    companyId: 'leumi',
    showBrowser: false,
    timeout: 120_000,
    defaultTimeout: 60_000,
  })
  const result = await scraper.scrape(resolveCredentialsFromEnv('leumi'))
  // Scraper errors can contain bank URLs, credentials, and raw response data.
  if (!result.success || result.result === undefined) {
    await recordPrivateError(result)
    throw new Error(
      'Leumi document session failed; saved documents and pending requests were preserved',
    )
  }
  return result.result
}

async function recordPrivateError(error: unknown) {
  const directory = path.resolve('private/leumi-documents')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(
    path.join(directory, `error-${Date.now()}.json`),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : error,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
}

export async function discoverDocuments(page: Page) {
  await page.goto(ORDER_URL)
  await page.waitForSelector('#ddlSubject')
  await page.select('#ddlSubject', '1')
  await page.waitForFunction(
    () => document.querySelectorAll('#ddlDocument option').length > 1,
  )
  return page.$$eval('#ddlDocument option', (options) =>
    options
      .filter((o) => o.value !== '-999')
      .map((o) => ({ id: o.value, title: o.textContent?.trim() ?? '' })),
  )
}

export async function prepareDocumentRequest(
  page: Page,
  type: DocumentType,
): Promise<string> {
  const available = await discoverDocuments(page)
  const definition = DOCUMENT_TYPES[type]
  if (
    !available.some(
      (d) => d.id === definition.id && d.title === definition.title,
    )
  ) {
    throw new Error('Requested document is not available in the bank catalogue')
  }
  await page.select('#ddlDocument', definition.id)
  await page.click('#btnDisplayMortgage')
  await page.waitForSelector('input[name="rdMortgages"]:not([disabled])', {
    visible: true,
  })
  const groups = await page.$$('input[name="rdMortgages"]:not([disabled])')
  // Do not silently request only one group if the bank presents multiple choices.
  if (groups.length !== 1)
    throw new Error('Multiple mortgage groups require explicit selection')
  await page.click('input[name="rdMortgages"]:not([disabled])')
  await page.waitForSelector('input[name="rdMortgages"]:checked')
  await page.click('#btnContinue')
  await page.waitForSelector('#btnContinueValid', { visible: true })
  const confirmation = await page.$eval(
    '#lblDocNameVAlueVerify',
    (e) => e.textContent?.trim() ?? '',
  )
  const message = await page.$eval(
    '#lblMessageDaysVerify',
    (e) => e.textContent?.trim() ?? '',
  )
  if (
    confirmation !== definition.title ||
    !message.includes('תיבת הדואר שלי')
  ) {
    throw new Error('Bank document confirmation changed; no request submitted')
  }
  return message
}

export async function submitDocumentRequest(page: Page): Promise<string> {
  await page.click('#btnContinueValid')
  await page.waitForSelector('#lblSuccessConfirm', {
    visible: true,
    timeout: 30_000,
  })
  const receipt = await page.$eval(
    '#lblSuccessConfirm',
    (e) => e.textContent?.trim() ?? '',
  )
  if (!receipt.includes('בקשתך התקבלה'))
    throw new Error('Document request acceptance could not be confirmed')
  return receipt
}

export type MailDocument = {
  id: number
  title: string
  sentDate: string
  pdf: boolean
}

export async function visitMortgageMail(
  page: Page,
  since: string,
  visit: (mail: MailDocument) => Promise<void>,
): Promise<number> {
  await page.goto(MAILBOX_URL)
  await page.waitForSelector('#ListMailTable')
  let count = 0
  for (let pageNumber = 1; pageNumber <= 40; pageNumber++) {
    const rows = await page.$$eval('#ListMailTable tr[id]', (rows) =>
      rows.map((row) => {
        const cells = row.querySelectorAll('td')
        const date = cells[5]?.textContent
          ?.trim()
          .match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
        return {
          id: Number(row.id),
          title: cells[4]?.textContent?.trim() ?? '',
          sentDate: date ? `${date[3]}-${date[2]}-${date[1]}` : '',
          pdf: cells[3]?.classList.contains('imagecolumnPDF') ?? false,
        }
      }),
    )
    if (rows.some((row) => !row.sentDate || !Number.isInteger(row.id)))
      throw new Error('Bank mailbox format changed')
    for (const mail of rows) {
      if (
        mail.sentDate >= since &&
        /משכ|יתרות לסילוק|פ[י]?רעון מוקדם/.test(mail.title)
      ) {
        if (!mail.pdf)
          throw new Error('Matching bank document is not available as a PDF')
        await visit(mail)
        count++
      }
    }
    // Stop by date only if this page actually uses descending date order.
    const descending = rows.every(
      (r, i) => i === 0 || r.sentDate <= rows[i - 1].sentDate,
    )
    if (descending && rows.some((row) => row.sentDate < since)) return count
    const next = await page.$('a[title="מעבר לדף הבא"][onclick]')
    if (!next || rows.length === 0) return count
    const previous = await page.$eval(
      '#hidPageNum',
      (e) => (e as HTMLInputElement).value,
    )
    await next.click()
    await page.waitForFunction(
      (old) =>
        (document.querySelector('#hidPageNum') as HTMLInputElement)?.value !==
          old && document.querySelectorAll('#ListMailTable tr[id]').length > 0,
      { timeout: 30_000 },
      previous,
    )
  }
  throw new Error('Mailbox scan limit reached; collection is incomplete')
}

export async function downloadMailPdf(
  page: Page,
  mail: MailDocument,
): Promise<Buffer> {
  const pdfUrl = await page.evaluate(
    (id) =>
      new Promise<string>((resolve, reject) => {
        const bank = window as unknown as {
          OpenMail: (id: number) => void
          CallBackOpenMail: (model: unknown) => void
          GetDataFromBusinessModelByID: (model: unknown, id: string) => string
        }
        const original = bank.CallBackOpenMail
        const timer = setTimeout(() => {
          bank.CallBackOpenMail = original
          reject(new Error('Mailbox open timed out'))
        }, 30_000)
        bank.CallBackOpenMail = (model) => {
          clearTimeout(timer)
          bank.CallBackOpenMail = original
          try {
            original(model)
            const url = bank.GetDataFromBusinessModelByID(model, 'URLsrcPDF')
            if (!url) throw new Error('Document PDF is unavailable')
            resolve(url)
          } catch {
            reject(new Error('Document PDF is unavailable'))
          }
        }
        bank.OpenMail(id)
      }),
    mail.id,
  )
  const url = new URL(pdfUrl, MAILBOX_URL)
  if (
    url.origin !== new URL(MAILBOX_URL).origin ||
    url.pathname.toLowerCase() !==
      '/ebanking/supportandreports/showmailpdf.aspx'
  ) {
    throw new Error('Unexpected bank document download location')
  }
  const result = await page.evaluate(async (href) => {
    const response = await fetch(href, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error('Bank PDF download failed')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > 25 * 1024 * 1024)
      throw new Error('Bank document exceeds size limit')
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(binary)
  }, url.href)
  return Buffer.from(result, 'base64')
}
