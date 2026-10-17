import { describe, expect, it } from 'vitest'

import {
  DEFAULT_REFRESH_SOURCES,
  buildRefreshPlan,
  createInitialRefreshState,
  recordRefreshResult,
  type RefreshState,
} from './financial-refresh.js'

describe('financial refresh orchestration', () => {
  it('plans all default sources when no source has refreshed yet', () => {
    const plan = buildRefreshPlan({
      now: '2026-06-12T06:00:00.000Z',
      state: createInitialRefreshState(),
      sources: DEFAULT_REFRESH_SOURCES,
      staleOnly: true,
    })

    expect(plan.map((item) => item.id)).toEqual([
      'leumi-bank',
      'leumi-cards',
      'leumi-mortgages',
    ])
  })

  it('skips sources whose last successful refresh is inside their freshness window', () => {
    const state: RefreshState = {
      sources: {
        'leumi-bank': {
          lastSuccessAt: '2026-06-12T01:00:00.000Z',
          lastAttemptAt: '2026-06-12T01:00:00.000Z',
          status: 'success',
          summary: { inserted: 2 },
        },
      },
    }

    const plan = buildRefreshPlan({
      now: '2026-06-12T06:00:00.000Z',
      state,
      sources: DEFAULT_REFRESH_SOURCES,
      staleOnly: true,
    })

    expect(plan.map((item) => item.id)).not.toContain('leumi-bank')
    expect(plan.map((item) => item.id)).toContain('leumi-cards')
  })

  it('records success and sanitized failure results back into refresh state', () => {
    const state = createInitialRefreshState()
    const afterSuccess = recordRefreshResult({
      state,
      sourceId: 'leumi-bank',
      startedAt: '2026-06-12T06:00:00.000Z',
      finishedAt: '2026-06-12T06:02:00.000Z',
      success: true,
      summary: { inserted: 3 },
    })
    const afterFailure = recordRefreshResult({
      state: afterSuccess,
      sourceId: 'leumi-cards',
      startedAt: '2026-06-12T06:03:00.000Z',
      finishedAt: '2026-06-12T06:04:00.000Z',
      success: false,
      error: 'password=secret id=123456789 failed',
    })

    expect(afterFailure.sources['leumi-bank']).toMatchObject({
      lastSuccessAt: '2026-06-12T06:02:00.000Z',
      status: 'success',
      summary: { inserted: 3 },
    })
    expect(afterFailure.sources['leumi-cards']).toMatchObject({
      lastSuccessAt: null,
      lastAttemptAt: '2026-06-12T06:04:00.000Z',
      status: 'failed',
      error: 'password=[REDACTED] id=[REDACTED] failed',
    })
  })
})
