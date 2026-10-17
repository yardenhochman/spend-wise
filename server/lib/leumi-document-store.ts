import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const documentSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  filename: z.string().regex(/^[a-f0-9]{64}\.pdf$/),
  title: z.string(),
  sentDate: z.string(),
  fetchedAt: z.string(),
  bytes: z.number().positive(),
})
const requestSchema = z.object({
  id: z.string(),
  type: z.enum(['repayment-information', 'clearing-balance']),
  requestedAt: z.string(),
  status: z.enum(['submitting', 'pending', 'ready', 'uncertain']),
  baselineHashes: z.array(z.string()),
  documents: z.array(z.string()),
  receipt: z.string().optional(),
})
const indexSchema = z.object({
  version: z.literal(1),
  documents: z.array(documentSchema),
  requests: z.array(requestSchema),
})
export type DocumentIndex = z.infer<typeof indexSchema>
export type DocumentRequest = z.infer<typeof requestSchema>
export type DocumentType = DocumentRequest['type']
export const DOCUMENT_TYPES = {
  'repayment-information': {
    id: '5',
    title: 'מידע לפירעון מוקדם ואישור יתרות לסילוק',
  },
  'clearing-balance': { id: '15', title: 'אישור יתרות לסילוק' },
} as const

export function documentType(title: string): DocumentType | null {
  const normalized = title
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/\s+/g, ' ')
  if (/פ[י]?רעון מוקדם/.test(normalized) && /יתרות|סילוק/.test(normalized))
    return 'repayment-information'
  if (/יתרות לסילוק/.test(normalized)) return 'clearing-balance'
  return null
}

export function israelDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))
}

export function pendingRequest(index: DocumentIndex, type: DocumentType) {
  return [...index.requests]
    .reverse()
    .find((r) => r.type === type && r.status !== 'ready')
}

export function reconcileRequests(index: DocumentIndex): void {
  for (const request of index.requests) {
    if (request.status === 'ready') continue
    const matches = index.documents.filter(
      (d) =>
        documentType(d.title) === request.type &&
        d.sentDate >= israelDate(request.requestedAt) &&
        !request.baselineHashes.includes(d.sha256),
    )
    if (matches.length) {
      request.documents = matches.map((d) => d.sha256)
      request.status = 'ready'
    }
  }
}

export async function readDocumentIndex(
  directory: string,
): Promise<DocumentIndex> {
  try {
    return indexSchema.parse(
      JSON.parse(await readFile(path.join(directory, 'index.json'), 'utf8')),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, documents: [], requests: [] }
    throw new Error('Document index is invalid; existing files were preserved')
  }
}

export async function writeDocumentIndex(
  directory: string,
  index: DocumentIndex,
) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = path.join(directory, `.index-${randomUUID()}.tmp`)
  await writeFile(
    temporary,
    JSON.stringify(indexSchema.parse(index), null, 2) + '\n',
    { mode: 0o600 },
  )
  await rename(temporary, path.join(directory, 'index.json'))
}

export async function saveBankPdf(
  directory: string,
  index: DocumentIndex,
  data: Buffer,
  metadata: { title: string; sentDate: string; fetchedAt: string },
) {
  if (
    data.length < 100 ||
    !data.subarray(0, 8).toString().startsWith('%PDF-') ||
    !data.subarray(-1024).toString().includes('%%EOF')
  ) {
    throw new Error(
      'Bank returned an invalid or incomplete PDF; previous documents were preserved',
    )
  }
  const sha256 = createHash('sha256').update(data).digest('hex')
  const existing = index.documents.find((d) => d.sha256 === sha256)
  if (existing) return { document: existing, added: false }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const filename = `${sha256}.pdf`
  const temporary = path.join(directory, `.${randomUUID()}.tmp`)
  await writeFile(temporary, data, { mode: 0o600 })
  await rename(temporary, path.join(directory, filename))
  const document = { ...metadata, sha256, filename, bytes: data.length }
  index.documents.push(document)
  await writeDocumentIndex(directory, index)
  return { document, added: true }
}
