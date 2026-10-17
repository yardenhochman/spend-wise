// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { errAsync, okAsync } from 'neverthrow'
import { createHomeFixtures } from '../../../lib/home-fixtures'
import {
  confirmHomeObligation,
  dismissHomeObligation,
  getHomeCommitments,
  safeFetchJson,
} from '../../../lib/api'
import CommitmentsMode from './CommitmentsMode'

vi.mock('../../../lib/api', async (original) => ({
  ...(await original<typeof import('../../../lib/api')>()),
  getHomeCommitments: vi.fn(),
  confirmHomeObligation: vi.fn(),
  dismissHomeObligation: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function setup(two = false) {
  const data = createHomeFixtures(new Date('2030-06-18T12:00:00Z')).commitments
  const base = data.obligations[0]
  data.obligations = [
    {
      ...base,
      id: 'synthetic',
      name: 'ועד לדוגמה',
      confirmed: false,
      trail: [{ month: '2030-06', status: 'paid', amount: 100 }],
    },
  ]
  if (two)
    data.obligations.push({
      ...data.obligations[0],
      id: 'second',
      name: 'Synthetic second obligation',
    })
  vi.mocked(getHomeCommitments).mockReturnValue(
    okAsync({ data, source: 'api' }),
  )
  return render(<CommitmentsMode />)
}
describe('suggestion controls', () => {
  it('shows a single banner and paid count, and dismisses with a recoverable error', async () => {
    setup()
    await screen.findByText('1 paid')
    expect(
      screen.getAllByText(
        'These were detected automatically — confirm the ones that are real',
      ),
    ).toHaveLength(1)
    expect(screen.queryByText('Suggested')).toBeNull()
    expect(screen.getByText('ועד לדוגמה').tagName).toBe('BDI')
    vi.mocked(dismissHomeObligation).mockReturnValueOnce(
      errAsync({ type: 'network', message: 'Synthetic failure' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss ועד לדוגמה' }))
    await screen.findByRole('alert')
    expect(screen.getByText('ועד לדוגמה')).toBeTruthy()
    vi.mocked(dismissHomeObligation).mockReturnValueOnce(okAsync(undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss ועד לדוגמה' }))
    await waitFor(() => expect(screen.queryByText('ועד לדוגמה')).toBeNull())
    expect(screen.getByText('0 paid')).toBeTruthy()
    expect(dismissHomeObligation).toHaveBeenCalledWith('synthetic', false)
  })
  it('confirms suggestions and removes their controls', async () => {
    setup()
    vi.mocked(confirmHomeObligation).mockReturnValueOnce(
      okAsync({ confirmed: true }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm ועד לדוגמה' }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Confirm ועד לדוגמה' }),
      ).toBeNull(),
    )
    expect(screen.getByText('1 paid')).toBeTruthy()
    expect(confirmHomeObligation).toHaveBeenCalledWith('synthetic', false)
  })
  it('accepts the API no-content deletion response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    )
    const result = await safeFetchJson('/obligations/synthetic', {
      method: 'DELETE',
    })
    expect(result.isOk()).toBe(true)
  })
})

it('confirms all, retains successful confirmations and retries only failures', async () => {
  setup(true)
  vi.mocked(confirmHomeObligation)
    .mockReturnValueOnce(okAsync({}))
    .mockReturnValueOnce(
      errAsync({ type: 'network', message: 'Synthetic failure' }),
    )
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm all' }))
  await screen.findByRole('alert')
  expect(
    screen.queryByRole('button', { name: 'Confirm ועד לדוגמה' }),
  ).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Confirm Synthetic second obligation' }),
  ).toBeTruthy()
  vi.mocked(confirmHomeObligation).mockClear().mockReturnValueOnce(okAsync({}))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm all' }))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Confirm all' })).toBeNull(),
  )
  expect(confirmHomeObligation).toHaveBeenCalledTimes(1)
  expect(confirmHomeObligation).toHaveBeenCalledWith('second', false)
})
