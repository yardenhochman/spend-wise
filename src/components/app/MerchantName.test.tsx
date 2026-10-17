// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { errAsync, okAsync } from 'neverthrow'
import {
  clearMerchantLabel,
  renameObligation,
  saveMerchantLabel,
} from '@/lib/api'
import MerchantName from './MerchantName'
vi.mock('@/lib/api', () => ({
  clearMerchantLabel: vi.fn(),
  renameObligation: vi.fn(),
  saveMerchantLabel: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
async function edit() {
  render(
    <MerchantName
      name="Friendly bill"
      rawMerchant="בנק לדוגמה"
      obligationId="synthetic"
    />,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Rename obligation Friendly bill' }),
  )
  const input = await screen.findByRole('textbox', { name: 'Label' })
  expect((input as HTMLInputElement).value).toBe('Friendly bill')
  expect(screen.getByText('Bank name:')).toBeTruthy()
  fireEvent.change(input, { target: { value: 'Our bill' } })
}
it('defaults to renaming the obligation and all merchant transactions', async () => {
  vi.mocked(renameObligation).mockReturnValue(okAsync({}))
  vi.mocked(saveMerchantLabel).mockReturnValue(okAsync({}))
  await edit()
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
  await waitFor(() =>
    expect(saveMerchantLabel).toHaveBeenCalledWith(
      'בנק לדוגמה',
      'Our bill',
      false,
    ),
  )
  expect(renameObligation).toHaveBeenCalledWith('synthetic', 'Our bill', false)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
it('supports obligation-only names and retains a failed edit for retry', async () => {
  vi.mocked(renameObligation)
    .mockReturnValueOnce(errAsync({ type: 'network', message: 'Synthetic' }))
    .mockReturnValueOnce(okAsync({}))
  await edit()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
  await screen.findByRole('alert')
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'Our bill',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(saveMerchantLabel).not.toHaveBeenCalled()
})
it('clears only the merchant override', async () => {
  vi.mocked(clearMerchantLabel).mockReturnValue(okAsync({}))
  await edit()
  fireEvent.click(screen.getByRole('button', { name: 'Clear merchant label' }))
  await waitFor(() =>
    expect(clearMerchantLabel).toHaveBeenCalledWith('בנק לדוגמה', false),
  )
  expect(renameObligation).not.toHaveBeenCalled()
})
