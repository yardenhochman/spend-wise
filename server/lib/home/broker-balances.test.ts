import { it, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readBrokerInput } from '../broker-input.js'
import { extractBalances } from './balances.js'
import { config } from './test-fixtures.js'
it('reads a successful synthetic broker envelope and extracts only allowlisted balances', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sw-home-broker-'))
  try {
    const fetched = new Date().toISOString()
    const envelope = {
      v: 1,
      schema: 'broker.bank.snapshot',
      account_id: 'leumi',
      source: 'leumi-bank',
      job_id: 'a'.repeat(32),
      fetched_at: fetched,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      coverage: { complete: true, requested_from: '2030-01-01' },
      payload: {
        success: true,
        accounts: [
          {
            accountNumber: '111-22222_33',
            balance: -123,
            currency: 'ILS',
            txns: [],
          },
          {
            accountNumber: '999-00000_11',
            balance: 999,
            currency: 'ILS',
            txns: [],
          },
        ],
      },
    }
    const file = path.join(dir, 'snapshot.json')
    await writeFile(file, JSON.stringify(envelope))
    const read = await readBrokerInput(file, 'leumi-bank')
    expect(
      extractBalances(read.payload, read.fetched_at, config),
    ).toMatchObject([{ balance: -123, label: 'Checking 1', as_of: fetched }])
    await writeFile(
      file,
      JSON.stringify({
        v: 1,
        schema: 'broker.bank.bundle',
        account_id: 'leumi',
        job_id: envelope.job_id,
        fetched_at: fetched,
        snapshots: { 'leumi-bank': envelope },
      }),
    )
    expect(
      extractBalances(
        (await readBrokerInput(file, 'leumi-bank')).payload,
        fetched,
        config,
      ),
    ).toHaveLength(1)
    await writeFile(
      file,
      JSON.stringify({ ...envelope, expires_at: '2000-01-01T00:00:00Z' }),
    )
    await expect(readBrokerInput(file, 'leumi-bank')).rejects.toThrow('stale')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
