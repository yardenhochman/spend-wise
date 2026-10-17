import { spawn } from 'node:child_process'

import path from 'node:path'
import { stat } from 'node:fs/promises'
import './lib/import-env.js'
import { readBrokerInput } from './lib/broker-input.js'

import {
  buildRefreshPlan,
  DEFAULT_REFRESH_SOURCES,
  DEFAULT_REFRESH_STATE_PATH,
  parseRefreshSourceId,
  readRefreshState,
  recordRefreshResult,
  type RefreshSourceDefinition,
  type RefreshSourceId,
  writeRefreshState,
} from './lib/financial-refresh.js'

type CliOptions = {
  input?: string
  statePath: string
  staleOnly: boolean
  sourceIds: RefreshSourceId[]
  showBrowser: boolean
}

type CommandResult = {
  success: boolean
  output: string
  summary: unknown
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    statePath: DEFAULT_REFRESH_STATE_PATH,
    staleOnly: true,
    sourceIds: [],
    showBrowser: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--input' || arg.startsWith('--input=')) {
      options.input = readValue(
        arg === '--input' ? argv[++i] : arg.slice('--input='.length),
        '--input',
      )
    } else if (arg === '--force' || arg === '--all') {
      options.staleOnly = false
    } else if (arg === '--stale-only') {
      options.staleOnly = true
    } else if (arg === '--show-browser') {
      options.showBrowser = true
    } else if (arg === '--source') {
      options.sourceIds.push(parseRefreshSourceId(readValue(argv[++i], arg)))
    } else if (arg.startsWith('--source=')) {
      options.sourceIds.push(
        parseRefreshSourceId(arg.slice('--source='.length)),
      )
    } else if (arg === '--state') {
      options.statePath = readValue(argv[++i], arg)
    } else if (arg.startsWith('--state=')) {
      options.statePath = readValue(arg.slice('--state='.length), '--state')
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function readValue(value: string | undefined, flag: string): string {
  if (!value?.trim()) throw new Error(`${flag} requires a value`)
  return value.trim()
}

function commandForSource(
  source: RefreshSourceDefinition,
  options: CliOptions,
  inputFile?: string,
): string[] {
  if (inputFile) return [...source.command, '--input', inputFile]
  return options.showBrowser
    ? [...source.command, '--show-browser']
    : source.command
}

async function runCommand(command: string[]): Promise<CommandResult> {
  const [bin, ...args] = command
  if (!bin) throw new Error('Cannot run an empty command')

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []

    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.on('error', (error) => {
      resolve({ success: false, output: error.message, summary: null })
    })
    child.on('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf8').trim()
      resolve({
        success: code === 0,
        output,
        summary: parseLastJsonObject(output),
      })
    })
  })
}

function parseLastJsonObject(output: string): unknown {
  const start = output.lastIndexOf('\n{')
  const candidate = start >= 0 ? output.slice(start + 1) : output
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2))
    const inputIsDirectory = options.input
      ? (await stat(options.input)).isDirectory()
      : false
    if (options.input && !inputIsDirectory) {
      const matched: RefreshSourceId[] = []
      for (const source of DEFAULT_REFRESH_SOURCES) {
        try {
          await readBrokerInput(options.input, source.id)
          matched.push(source.id)
        } catch {}
      }
      if (matched.length === 0)
        throw new Error('Invalid or stale broker input file')
      if (options.sourceIds.some((id) => !matched.includes(id)))
        throw new Error('Broker input source mismatch')
      if (!options.sourceIds.length) options.sourceIds = matched
    }
    let state = await readRefreshState(options.statePath)
    const now = new Date().toISOString()
    const plan = buildRefreshPlan({
      now,
      state,
      sources: DEFAULT_REFRESH_SOURCES,
      staleOnly: options.staleOnly,
      requestedSourceIds: options.sourceIds,
    })
    const results: Array<{
      source: RefreshSourceId
      status: 'success' | 'failed'
      summary: unknown
    }> = []

    for (const source of plan) {
      const startedAt = new Date().toISOString()
      const inputFile = options.input
        ? inputIsDirectory
          ? path.join(options.input, 'leumi.json')
          : options.input
        : undefined
      const input = inputFile
        ? await readBrokerInput(inputFile, source.id)
        : undefined
      const result = await runCommand(
        commandForSource(source, options, inputFile),
      )
      const finishedAt = new Date().toISOString()
      state = recordRefreshResult({
        state,
        sourceId: source.id,
        startedAt,
        finishedAt,
        success: result.success,
        summary: result.summary,
        error: result.output,
      })
      if (input && result.success)
        state.sources[source.id]!.lastSuccessAt = input.fetched_at
      await writeRefreshState(state, options.statePath)
      results.push({
        source: source.id,
        status: result.success ? 'success' : 'failed',
        summary: result.summary,
      })
    }

    console.log(
      JSON.stringify(
        {
          status: results.some((result) => result.status === 'failed')
            ? 'failed'
            : 'completed',
          mode: options.staleOnly ? 'stale-only' : 'force',
          planned: plan.map((source) => source.id),
          skipped: DEFAULT_REFRESH_SOURCES.filter(
            (source) => !plan.some((planned) => planned.id === source.id),
          ).map((source) => source.id),
          results,
          statePath: options.statePath,
        },
        null,
        2,
      ),
    )

    if (results.some((result) => result.status === 'failed')) {
      process.exit(1)
    }
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    )
    process.exit(1)
  }
}

void main()
