import { describe, expect, it } from 'vitest'

import {
  extractLeumiCardTransactions,
  parseLeumiWcfJsonResponse,
} from './leumi-card-import.js'

describe('parseLeumiWcfJsonResponse', () => {
  it('parses nested Leumi WCF jsonResp payloads', () => {
    expect(
      parseLeumiWcfJsonResponse({
        ProcessRequestResult: 0,
        jsonResp: '{"Activity":{"TabNisTransactionItems":[]}}',
      }),
    ).toEqual({ Activity: { TabNisTransactionItems: [] } })
  })
})

// Synthetic merchants, identifiers, dates and amounts.
describe('extractLeumiCardTransactions', () => {
  it('maps Leumi card activity rows to SpendWise transactions', () => {
    const transactions = extractLeumiCardTransactions(
      {
        Activity: {
          TabNisTransactionItems: [
            {
              NisTransactionItems: [
                {
                  DateDealUTC: '2030-06-28T21:00:00.003Z',
                  AmountDouble: 24,
                  DebitCardFirmName: 'SYNTHETIC TEA SHOP                    ',
                  NextPaymentAmountDouble: 24,
                  CardTransactionId: 'abc123',
                },
                {
                  DateDealUTC: '2030-07-06T21:00:00.003Z',
                  AmountDouble: 37.5,
                  DebitCardFirmName: 'חנות דוגמה                    ',
                  NextPaymentAmountDouble: 37.5,
                  CardTransactionId: 'def456',
                },
              ],
            },
          ],
        },
      },
      {
        accountNumber: '000-00000/00',
        cardLast4Digits: '0000',
        cycleLabel: 'יולי 2030',
      },
    )

    expect(transactions).toMatchObject([
      {
        date: '2030-06-29',
        merchant: 'SYNTHETIC TEA SHOP',
        amount: -24,
        currency: 'ILS',
        ref: 'abc123',
        cardLast4Digits: '0000',
        accountNumber: '000-00000/00',
      },
      {
        date: '2030-07-07',
        merchant: 'חנות דוגמה',
        amount: -37.5,
        currency: 'ILS',
        ref: 'def456',
      },
    ])

    expect(transactions[0].raw_hash).toBeTruthy()
    expect(transactions[0].notes).toContain('cycle יולי 2030')
  })
})

describe('currency and refund safety', () => {
  const context = {
    accountNumber: 'test',
    cardLast4Digits: '0000',
    cycleLabel: 'test',
  }
  const row = {
    DateDealUTC: '2026-09-19T21:00:00Z',
    DebitCardFirmName: 'Hotel',
    AmountDouble: 100,
    NextPaymentAmountDouble: 100,
    CardTransactionId: 'one',
    TransactionCurrency: '49',
    PaymentCurrency: '49',
  }
  it('never interprets EUR as ILS without a valuation', () => {
    expect(() =>
      extractLeumiCardTransactions(
        { Activity: { TabForeignTransactionItems: [row] } },
        context,
      ),
    ).toThrow('Missing ILS valuation')
  })
  it('preserves refunds and source identity when the valuation changes', () => {
    const response = {
      Activity: {
        TabForeignTransactionItems: [
          { ...row, AmountDouble: -100, NextPaymentAmountDouble: -100 },
        ],
      },
    }
    const a = extractLeumiCardTransactions(response, {
      ...context,
      valueInIls: (_, n) => n * 4,
    })[0]
    const b = extractLeumiCardTransactions(response, {
      ...context,
      valueInIls: (_, n) => n * 3.5,
    })[0]
    expect(a).toMatchObject({
      amount: 400,
      originalAmount: 100,
      originalCurrency: 'EUR',
      billingCurrency: 'EUR',
      valuationStatus: 'estimated',
      date: '2026-09-20',
    })
    expect(a.raw_hash).toBe(b.raw_hash)
  })
  it('uses ILS billing amount for converted EUR purchases and excludes holds', () => {
    const [tx] = extractLeumiCardTransactions(
      {
        Activity: {
          TabNisTransactionItems: [{ ...row, NextPaymentAmountDouble: 350 }],
          RealTimeTransItems: [row],
        },
      },
      context,
    )
    expect(tx).toMatchObject({
      amount: -350,
      originalAmount: -100,
      valuationStatus: 'actual',
    })
  })
  it('keeps distinct identical purchases with different bank references', () => {
    const txs = extractLeumiCardTransactions(
      {
        Activity: {
          TabNisTransactionItems: [row, { ...row, CardTransactionId: 'two' }],
        },
      },
      context,
    )
    expect(txs[0].raw_hash).not.toBe(txs[1].raw_hash)
  })
})
