// @vitest-environment jsdom
import { errAsync, okAsync } from 'neverthrow'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewQueueResponse } from '@/lib/types'

// Synthetic merchants and amounts.
const item = (key: string, over = {}) => ({
  key,
  name: key,
  bankNames: [key],
  count: 2,
  total: 200,
  olderCount: 0,
  examples: [{ id: `${key}1`, date: '2026-10-01', amount: -100, label: key }],
  suggestion: {
    categoryId: 'g',
    categoryName: 'Groceries',
    reason: 'You filed 2 earlier charges here as Groceries.',
  },
  setsRule: true,
  ...over,
})
const queue: ReviewQueueResponse = {
  uncategorizedShare: 0.5,
  categories: [
    { id: 'g', name: 'Groceries' },
    { id: 'd', name: 'Dining' },
  ],
  items: [item('first'), item('second', { suggestion: null })],
}
const applied = (key: string, categoryId: string) => ({
  applied: {
    key,
    categoryId,
    transactionIds: ['a', 'b'],
    createdRuleIds: ['r'],
    changedRules: [],
  },
  uncategorizedShare: 0.25,
})
const api = vi.hoisted(() => ({
  applyReviewAnswer: vi.fn(),
  undoReviewAnswer: vi.fn(),
  getHomeReviewQueue: vi.fn(),
}))
vi.mock('@/lib/api', () => api)
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to: _to,
    search: _s,
    ...props
  }: Record<string, never>) => (
    <a href="/" {...props}>
      {children}
    </a>
  ),
  useSearch: () => ({}),
}))
import CategorizeQueue from './CategorizeQueue'

const data = (value: ReviewQueueResponse) =>
  api.getHomeReviewQueue.mockReturnValue(
    okAsync({ data: value, source: 'api' }),
  )
const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('button', { name }))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  data(queue)
})
afterEach(cleanup)

describe('CategorizeQueue', () => {
  it('shows position and a suggestion with its reason, and applies nothing unasked', async () => {
    render(<CategorizeQueue />)
    expect(await screen.findByText('1 of 2')).toBeTruthy()
    expect(screen.getByText(/You filed 2 earlier charges/)).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('first')
    expect(api.applyReviewAnswer).not.toHaveBeenCalled()
  })
  it('accepts in one tap, moves on, and undo brings the merchant back', async () => {
    api.applyReviewAnswer.mockReturnValue(okAsync(applied('first', 'g')))
    api.undoReviewAnswer.mockReturnValue(okAsync({ uncategorizedShare: 0.5 }))
    render(<CategorizeQueue />)
    await screen.findByText('1 of 2')
    click(/File as Groceries/)
    expect(await screen.findByText('2 of 2')).toBeTruthy()
    expect(api.applyReviewAnswer).toHaveBeenCalledWith('first', 'g')
    expect(document.activeElement?.textContent).toBe('second')
    click(/Undo/)
    expect(await screen.findByText('1 of 2')).toBeTruthy()
    expect(api.undoReviewAnswer).toHaveBeenCalledOnce()
  })
  it('keeps the answer after a failed save and retries it', async () => {
    api.applyReviewAnswer.mockReturnValueOnce(
      errAsync({ type: 'network', message: 'down' }),
    )
    render(<CategorizeQueue />)
    await screen.findByText('1 of 2')
    click(/File as Groceries/)
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Groceries was not saved',
    )
    expect(screen.getByText('1 of 2')).toBeTruthy()
    api.applyReviewAnswer.mockReturnValueOnce(okAsync(applied('first', 'g')))
    click(/Try Groceries again/)
    expect(await screen.findByText('2 of 2')).toBeTruthy()
    expect(api.applyReviewAnswer).toHaveBeenCalledTimes(2)
  })
  it('says when there is no suggestion and still offers the picker', async () => {
    data({ ...queue, items: [queue.items[1]] })
    render(<CategorizeQueue />)
    expect(await screen.findByText(/No suggestion/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dining' })).toBeTruthy()
  })
  it('remembers skips, puts them last next visit, and offers them at the end', async () => {
    const view = render(<CategorizeQueue />)
    await screen.findByText('1 of 2')
    click(/Skip for now/)
    expect(await screen.findByText('2 of 2')).toBeTruthy()
    click(/Skip for now/)
    expect(await screen.findByText('2 merchants skipped')).toBeTruthy()
    click(/Review the skipped/)
    expect(await screen.findByText('1 of 2')).toBeTruthy()
    view.unmount()
    localStorage.setItem('spendwise:review-skipped', '["first"]')
    render(<CategorizeQueue />)
    await screen.findByText('1 of 2')
    expect(document.activeElement?.textContent).toBe('second')
  })
  it('finishes with the new share and a way back to Brief', async () => {
    data({ ...queue, items: [queue.items[0]] })
    api.applyReviewAnswer.mockReturnValue(okAsync(applied('first', 'g')))
    render(<CategorizeQueue />)
    await screen.findByText('1 of 1')
    click(/File as Groceries/)
    await waitFor(() => screen.getByText('All reviewed'))
    expect(screen.getByText(/now 25%, down from 50%/)).toBeTruthy()
    expect(screen.getByText('Back to Brief')).toBeTruthy()
  })
  it('has an empty state', async () => {
    data({ ...queue, items: [] })
    render(<CategorizeQueue />)
    expect(await screen.findByText('Nothing to review')).toBeTruthy()
  })
})
