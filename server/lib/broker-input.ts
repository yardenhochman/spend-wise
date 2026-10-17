import { readFile, stat } from 'node:fs/promises'

export type BrokerSnapshot = {
  v: 1
  schema: 'broker.bank.snapshot'
  account_id: string
  source: string
  job_id: string
  fetched_at: string
  expires_at: string
  coverage: Record<string, unknown>
  payload: Record<string, any>
}

/** Consume only a successful broker projection. Retained stale data is explicit. */
export async function readBrokerInput(file: string, source: string): Promise<BrokerSnapshot> {
  if ((await stat(file)).size > 32 * 1024 * 1024) throw new Error('Broker snapshot too large')
  const text = await readFile(file, 'utf8')
  if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('Broker snapshot too large')
  const parsed = JSON.parse(text)
  const value = (parsed.schema === 'broker.bank.bundle' ? parsed.snapshots?.[source] : parsed) as BrokerSnapshot
  if (!value) throw new Error('Broker bundle does not contain source')
  if (parsed.schema === 'broker.bank.bundle' && (parsed.v !== 1 || parsed.account_id !== 'leumi' ||
      parsed.job_id !== value.job_id || parsed.fetched_at !== value.fetched_at)) throw new Error('Invalid broker bundle')
  if (value.v !== 1 || value.schema !== 'broker.bank.snapshot' || value.source !== source ||
      value.account_id !== 'leumi' || !/^[a-f0-9]{32}$/.test(value.job_id) ||
      !value.payload || typeof value.payload !== 'object' || !value.coverage ||
      typeof value.coverage.complete !== 'boolean') throw new Error('Invalid broker snapshot')
  const fetched = Date.parse(value.fetched_at)
  const expires = Date.parse(value.expires_at)
  if (!Number.isFinite(fetched) || !Number.isFinite(expires) || fetched > Date.now() + 60000 ||
      expires <= fetched || expires <= Date.now() ||
      expires - fetched > (source === 'leumi-mortgages' ? 7 : 1) * 86400000) throw new Error('Broker snapshot is stale or has invalid freshness')
  if (source !== 'leumi-mortgages' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value.coverage.requested_from)))
    throw new Error('Invalid broker requested coverage')
  if (source === 'leumi-bank' && (value.payload.success !== true || !Array.isArray(value.payload.accounts)))
    throw new Error('Invalid broker bank payload')
  if (source === 'leumi-cards' && (!Array.isArray(value.payload.accounts) || !value.payload.scrape))
    throw new Error('Invalid broker card payload')
  if (source === 'leumi-mortgages' && (value.payload.source !== source ||
      value.payload.trackCoverage?.status !== 'complete' || !Array.isArray(value.payload.mortgages)))
    throw new Error('Invalid broker mortgage payload')
  return value
}
