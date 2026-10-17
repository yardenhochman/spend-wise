import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  documentType,
  israelDate,
  pendingRequest,
  readDocumentIndex,
  reconcileRequests,
  saveBankPdf,
  writeDocumentIndex,
  type DocumentIndex,
} from './leumi-document-store.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  )
})
async function directory() {
  const p = await mkdtemp(path.join(os.tmpdir(), 'leumi-documents-'))
  temporary.push(p)
  return p
}
const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
)
const metadata = {
  title: 'מידע לפירעון מוקדם ואישור יתרות לסילוק',
  sentDate: '2032-09-10',
  fetchedAt: '2032-09-10T09:00:00Z',
}

describe('official bank document storage', () => {
  it('preserves original PDF bytes and deduplicates by content', async () => {
    const dir = await directory()
    const index = await readDocumentIndex(dir)
    const first = await saveBankPdf(dir, index, pdf, metadata)
    expect(first.added).toBe(true)
    expect(await readFile(path.join(dir, first.document.filename))).toEqual(pdf)
    expect((await saveBankPdf(dir, index, pdf, metadata)).added).toBe(false)
    expect((await readDocumentIndex(dir)).documents).toHaveLength(1)
  })

  it.each([
    Buffer.from('<html>Chrome PDF viewer</html>'),
    pdf.subarray(0, pdf.length - 10),
  ])(
    'rejects a viewer wrapper or truncated PDF without replacing the index',
    async (invalid) => {
      const dir = await directory()
      const index = await readDocumentIndex(dir)
      await saveBankPdf(dir, index, pdf, metadata)
      const before = await readFile(path.join(dir, 'index.json'))
      await expect(saveBankPdf(dir, index, invalid, metadata)).rejects.toThrow(
        'invalid or incomplete PDF',
      )
      expect(await readFile(path.join(dir, 'index.json'))).toEqual(before)
    },
  )

  it('fails closed on a corrupt index instead of forgetting pending orders', async () => {
    const dir = await directory()
    await writeFile(path.join(dir, 'index.json'), '{broken')
    await expect(readDocumentIndex(dir)).rejects.toThrow('index is invalid')
  })
})

describe('asynchronous document requests', () => {
  const request = () => ({
    id: 'test-order',
    type: 'repayment-information' as const,
    requestedAt: '2032-09-09T22:00:00Z',
    status: 'pending' as const,
    baselineHashes: ['a'.repeat(64)],
    documents: [],
  })
  const doc = (hash: string, sentDate: string, title = metadata.title) => ({
    ...metadata,
    title,
    sentDate,
    sha256: hash.repeat(64),
    filename: `${hash.repeat(64)}.pdf`,
    bytes: 150,
  })

  it('does not fulfill a new request with old, pre-existing, or different reports', () => {
    const index: DocumentIndex = {
      version: 1,
      requests: [request()],
      documents: [
        doc('b', '2032-09-09'),
        doc('a', '2032-09-10'),
        doc('c', '2032-09-10', 'אישור יתרות לסילוק'),
        doc('d', '2032-09-10', 'משכ-חוק ההסדרים - מכתב עמלות וריביות'),
      ],
    }
    reconcileRequests(index)
    expect(index.requests[0].status).toBe('pending')
    index.documents.push(doc('e', '2032-09-10'))
    reconcileRequests(index)
    expect(index.requests[0].status).toBe('ready')
    expect(index.requests[0].documents).toEqual(['e'.repeat(64)])
  })

  it.each(['submitting', 'pending', 'uncertain'] as const)(
    'prevents duplicate submission when the saved state is %s',
    async (status) => {
      const dir = await directory()
      const index: DocumentIndex = {
        version: 1,
        documents: [],
        requests: [{ ...request(), status }],
      }
      await writeDocumentIndex(dir, index)
      expect(
        pendingRequest(await readDocumentIndex(dir), 'repayment-information')
          ?.status,
      ).toBe(status)
    },
  )

  it('uses the Israeli calendar date and distinguishes the two repayment reports', () => {
    expect(israelDate('2032-09-09T22:00:00Z')).toBe('2032-09-10')
    expect(documentType('משכ-מידע לפרעון מוקדם ואישור יתרות לסילוק')).toBe(
      'repayment-information',
    )
    expect(documentType('אישור יתרות לסילוק')).toBe('clearing-balance')
    expect(documentType('לוח סילוקין עדכני')).toBeNull()
  })
})
