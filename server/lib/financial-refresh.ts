import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type RefreshStatus = 'success' | 'failed' | 'skipped'

export type RefreshSourceId = 'leumi-bank' | 'leumi-cards' | 'leumi-mortgages'

export type RefreshSourceDefinition = {
  id: RefreshSourceId
  label: string
  maxAgeHours: number
  command: string[]
}

export type RefreshSourceState = {
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  status: RefreshStatus
  error?: string
  summary?: unknown
}

export type RefreshState = {
  sources: Partial<Record<RefreshSourceId, RefreshSourceState>>
}

export type RefreshPlanOptions = {
  now: string
  state: RefreshState
  sources: RefreshSourceDefinition[]
  staleOnly: boolean
  requestedSourceIds?: RefreshSourceId[]
}

export type RefreshResultInput = {
  state: RefreshState
  sourceId: RefreshSourceId
  startedAt: string
  finishedAt: string
  success: boolean
  summary?: unknown
  error?: string
}

export const DEFAULT_REFRESH_STATE_PATH = path.resolve(
  process.cwd(),
  'private/financial-refresh-state.json',
)

export const DEFAULT_REFRESH_SOURCES: RefreshSourceDefinition[] = [
  {
    id: 'leumi-bank',
    label: 'Leumi bank accounts',
    maxAgeHours: 24,
    command: ['tsx', 'server/import-bank-scraper.ts', '--write'],
  },
  {
    id: 'leumi-cards',
    label: 'Leumi credit cards',
    maxAgeHours: 24,
    command: [
      'tsx',
      'server/import-leumi-cards.ts',
      '--from',
      '2025-06-01',
      '--write',
    ],
  },
  {
    id: 'leumi-mortgages',
    label: 'Leumi mortgages',
    maxAgeHours: 24 * 7,
    command: ['tsx', 'server/import-leumi-mortgages.ts', '--write'],
  },
]

export function createInitialRefreshState(): RefreshState {
  return { sources: {} }
}

export function buildRefreshPlan(
  options: RefreshPlanOptions,
): RefreshSourceDefinition[] {
  const requested = new Set(options.requestedSourceIds ?? [])
  const sources =
    requested.size > 0
      ? options.sources.filter((source) => requested.has(source.id))
      : options.sources

  if (!options.staleOnly) return sources

  return sources.filter((source) =>
    isSourceStale(
      options.state.sources[source.id],
      source.maxAgeHours,
      options.now,
    ),
  )
}

export function isSourceStale(
  sourceState: RefreshSourceState | undefined,
  maxAgeHours: number,
  nowIso: string,
): boolean {
  if (!sourceState?.lastSuccessAt) return true

  const lastSuccess = Date.parse(sourceState.lastSuccessAt)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(lastSuccess) || !Number.isFinite(now)) return true

  return now - lastSuccess >= maxAgeHours * 60 * 60 * 1000
}

export function recordRefreshResult(input: RefreshResultInput): RefreshState {
  return {
    ...input.state,
    sources: {
      ...input.state.sources,
      [input.sourceId]: {
        lastSuccessAt: input.success
          ? input.finishedAt
          : (input.state.sources[input.sourceId]?.lastSuccessAt ?? null),
        lastAttemptAt: input.finishedAt,
        status: input.success ? 'success' : 'failed',
        summary: input.summary,
        error: input.success
          ? undefined
          : sanitizeRefreshError(input.error ?? ''),
      },
    },
  }
}

export async function readRefreshState(
  filePath = DEFAULT_REFRESH_STATE_PATH,
): Promise<RefreshState> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as RefreshState
    return {
      sources: parsed.sources ?? {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createInitialRefreshState()
    }
    throw error
  }
}

export async function writeRefreshState(
  state: RefreshState,
  filePath = DEFAULT_REFRESH_STATE_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`)
}

export function parseRefreshSourceId(value: string): RefreshSourceId {
  if (
    value === 'leumi-bank' ||
    value === 'leumi-cards' ||
    value === 'leumi-mortgages'
  ) {
    return value
  }

  throw new Error(`Unknown refresh source: ${value}`)
}

export function sanitizeRefreshError(message: string): string {
  return message
    .replace(/\b\d{5,}\b/g, '[REDACTED]')
    .replace(
      /"(password|username|userCode|id|card6Digits|cardSuffix|mortgageKey)"\s*:\s*"[^"]*"/gi,
      '"$1":"[REDACTED]"',
    )
    .replace(
      /\b(password|username|userCode|id|card6Digits|cardSuffix|mortgageKey)\s*=\s*\S+/gi,
      '$1=[REDACTED]',
    )
}
