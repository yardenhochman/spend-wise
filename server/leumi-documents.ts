import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  discoverDocuments,
  downloadMailPdf,
  prepareDocumentRequest,
  submitDocumentRequest,
  visitMortgageMail,
  withLeumiDocuments,
} from './lib/leumi-document-browser.js'
import {
  DOCUMENT_TYPES,
  pendingRequest,
  readDocumentIndex,
  reconcileRequests,
  saveBankPdf,
  writeDocumentIndex,
  type DocumentRequest,
  type DocumentType,
} from './lib/leumi-document-store.js'

const directory = path.resolve('private/leumi-documents')

function parseArgs(args: string[]) {
  let action: 'list' | 'collect' | 'request' = 'list'
  let type: DocumentType | undefined
  let watch = false
  let selected = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--watch') {
      watch = true
      continue
    }
    if (selected)
      throw new Error('Choose one of --list, --collect, or --request TYPE')
    selected = true
    if (args[i] === '--list') action = 'list'
    else if (args[i] === '--collect') action = 'collect'
    else if (args[i] === '--request') {
      const candidate = args[++i]
      if (!Object.hasOwn(DOCUMENT_TYPES, candidate ?? ''))
        throw new Error(
          'Document type must be repayment-information or clearing-balance',
        )
      type = candidate as DocumentType
      action = 'request'
    } else throw new Error('Unknown document command option')
  }
  if (watch && action === 'list')
    throw new Error('--watch requires --collect or --request')
  return { action, type, watch }
}

async function runOnce(options: ReturnType<typeof parseArgs>) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const lock = path.join(directory, '.lock')
  try {
    await mkdir(lock)
  } catch {
    throw new Error(
      'Another document collector is running; if it crashed, remove private/leumi-documents/.lock after checking its PID',
    )
  }
  await writeFile(path.join(lock, 'pid'), String(process.pid), { mode: 0o600 })
  try {
    const index = await readDocumentIndex(directory)
    if (
      options.watch &&
      options.action === 'collect' &&
      !index.requests.some((r) => r.status !== 'ready')
    )
      return { status: 'ready', pending: 0, downloaded: 0 }
    if (options.type) {
      const existing = pendingRequest(index, options.type)
      if (existing)
        return {
          status: existing.status,
          pending: 1,
          downloaded: 0,
          requestId: existing.id,
        }
    }
    return await withLeumiDocuments(async (page) => {
      if (options.action === 'list')
        return {
          status: 'catalogue',
          pending: index.requests.filter((r) => r.status !== 'ready').length,
          downloaded: 0,
          available: await discoverDocuments(page),
        }
      let downloaded = 0
      const since = new Date(Date.now() - 30 * 86400_000)
        .toISOString()
        .slice(0, 10)
      await visitMortgageMail(page, since, async (mail) => {
        const data = await downloadMailPdf(page, mail)
        const saved = await saveBankPdf(directory, index, data, {
          title: mail.title,
          sentDate: mail.sentDate,
          fetchedAt: new Date().toISOString(),
        })
        if (saved.added) downloaded++
      })
      reconcileRequests(index)
      await writeDocumentIndex(directory, index)
      if (options.type) {
        await prepareDocumentRequest(page, options.type)
        const request: DocumentRequest = {
          id: randomUUID(),
          type: options.type,
          requestedAt: new Date().toISOString(),
          status: 'submitting',
          baselineHashes: index.documents.map((d) => d.sha256),
          documents: [],
        }
        index.requests.push(request)
        // Persist intent before the single irreversible order click. Never automatically
        // resubmit if the connection drops after Leumi may have accepted it.
        await writeDocumentIndex(directory, index)
        try {
          request.receipt = await submitDocumentRequest(page)
          request.status = 'pending'
        } catch {
          request.status = 'uncertain'
          await writeDocumentIndex(directory, index)
          throw new Error(
            'Document order acceptance is uncertain; collect or inspect the bank before placing another order',
          )
        }
        await writeDocumentIndex(directory, index)
      }
      const pending = index.requests.filter((r) => r.status !== 'ready').length
      return {
        status: pending ? 'pending' : 'ready',
        pending,
        downloaded,
        saved: index.documents.length,
        indexPath: path.join(directory, 'index.json'),
        readyDocuments: index.requests
          .filter((r) => r.status === 'ready')
          .flatMap((r) =>
            r.documents.map((hash) => path.join(directory, `${hash}.pdf`)),
          ),
      }
    })
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const deadline = Date.now() + 2 * 60 * 60_000
  do {
    try {
      const result = await runOnce(options)
      console.log(JSON.stringify(result, null, 2))
      if (!options.watch || result.pending === 0) return
      options.action = 'collect'
      options.type = undefined
    } catch (error) {
      // Only our own sanitized messages reach stdout; browser errors are hidden by
      // withLeumiDocuments. No URLs, response bodies, or credentials are logged.
      if (!options.watch) throw error
      console.error(
        JSON.stringify({
          status: 'retry-later',
          error: 'Document collection failed; pending request preserved',
        }),
      )
    }
    if (Date.now() + 5 * 60_000 >= deadline) break
    await delay(5 * 60_000)
  } while (Date.now() < deadline)
  console.log(
    JSON.stringify({
      status: 'pending-timeout',
      message:
        'Collection stopped after two hours; rerun --collect. No new order was placed.',
    }),
  )
  process.exitCode = 2
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: 'failed',
      error: error instanceof Error ? error.message : 'Document command failed',
    }),
  )
  process.exitCode = 1
})
