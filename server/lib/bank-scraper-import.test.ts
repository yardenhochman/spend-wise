import { describe, expect, it } from 'vitest'

import {
  mapScrapedAccountTransactions,
  normalizeScraperDate,
  resolveCredentialsFromEnv,
} from './bank-scraper-import.js'

describe('bank scraper import helpers', () => {
  it('maps completed scraped transactions to SpendWise transactions', () => {
    const transactions = mapScrapedAccountTransactions([
      {
        accountNumber: '123456',
        txns: [
          {
            date: new Date('2026-06-01T12:00:00.000Z'),
            processedDate: new Date('2026-06-02T12:00:00.000Z'),
            chargedAmount: -42.5,
            chargedCurrency: 'ILS',
            description: 'Synthetic Subscription',
            memo: 'monthly',
            identifier: 'abc123',
            status: 'completed',
          },
          {
            date: new Date('2026-06-03T12:00:00.000Z'),
            processedDate: new Date('2026-06-03T12:00:00.000Z'),
            chargedAmount: -100,
            chargedCurrency: 'ILS',
            description: 'Pending Merchant',
            status: 'pending',
          },
        ],
      },
    ])

    expect(transactions).toHaveLength(1)
    expect(transactions[0]).toMatchObject({
      accountNumber: '123456',
      date: '2026-06-01',
      merchant: 'Synthetic Subscription',
      amount: -42.5,
      currency: 'ILS',
      ref: 'abc123',
      notes: 'monthly',
    })
    expect(transactions[0]?.raw_hash).toHaveLength(64)
  })

  it('normalizes scraper date shapes to YYYY-MM-DD', () => {
    expect(normalizeScraperDate('2026-06-07T20:30:00.000Z')).toBe('2026-06-07')
    expect(normalizeScraperDate('2026-05-31T21:00:00.000Z')).toBe('2026-06-01')
    expect(normalizeScraperDate(new Date('2026-06-08T00:00:00.000Z'))).toBe(
      '2026-06-08',
    )
  })

  it('resolves Leumi credentials from environment variables without values in code', () => {
    const credentials = resolveCredentialsFromEnv('leumi', {
      LEUMI_USERNAME: 'user',
      LEUMI_PASSWORD: 'pass',
    })

    expect(credentials).toEqual({ username: 'user', password: 'pass' })
  })
})
