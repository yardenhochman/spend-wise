import { describe, expect, it } from 'vitest'
import { collectLeumiMortgageTracks } from './leumi-mortgage-fetch.js'
const overview = {
  loanMortgageItems: [
    {
      MortgageDetail: {
        mortgageKey: 'fixture-a',
        loanItems: [{ loanID: '1' }],
      },
    },
    {
      MortgageDetail: {
        mortgageKey: 'fixture-b',
        loanItems: [{ loanID: '1' }],
      },
    },
  ],
}
const response = (key: string) => ({
  MortgageDetails: { mortgageKey: key, loansItems: [{ loanId: '01' }] },
})

describe('collectLeumiMortgageTracks', () => {
  it('collects every mortgage using its identity and preserves the overview', async () => {
    const requested: string[] = []
    const result = await collectLeumiMortgageTracks(overview, async (key) => {
      requested.push(key)
      return response(key)
    })
    expect(requested).toEqual(['fixture-a', 'fixture-b'])
    expect(result).toEqual({
      ...overview,
      loanInfoResponses: [response('fixture-a'), response('fixture-b')],
    })
  })
  it('fails instead of replacing a complete snapshot with missing tracks', async () => {
    await expect(
      collectLeumiMortgageTracks(overview, async (key) =>
        key === 'fixture-a' ? response(key) : {},
      ),
    ).rejects.toThrow('Mortgage track coverage incomplete: 1/2')
  })
  it('does not propagate request errors containing private response data', async () => {
    await expect(
      collectLeumiMortgageTracks(overview, async () => {
        throw new Error('secret private response')
      }),
    ).rejects.toThrow('Mortgage track request failed')
  })
  it('rejects malformed or empty overview responses', async () => {
    await expect(
      collectLeumiMortgageTracks({}, async (key) => response(key)),
    ).rejects.toThrow('Mortgage overview has no loan tracks')
  })
})
