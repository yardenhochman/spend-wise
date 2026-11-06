import { timingSafeEqual, createHash } from 'node:crypto'
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { HomeDeps } from '../lib/home/service.js'
import {
  anythingOff,
  AnswerError,
  categoryNames,
  compareToUsual,
  HANDLING_RULES,
  leftBeforePayday,
  transactionsForFigure,
  whereMoneyWent,
} from './answers.js'

export type Log = (line: string) => void

const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe('Calendar month as YYYY-MM. Defaults to the current month.')
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

export function createMcpServer(deps: HomeDeps, log: Log): McpServer {
  const server = new McpServer(
    { name: 'spendwise', version: '1.0.0' },
    {
      instructions: `Read-only answers about one household's money. Lead with money lost for no gain before suggesting restraint: the household wants more income outside career and lower expenses without losing quality of life. Quote the data-through dates and warnings when they matter, and use evidence rows rather than guessing. ${HANDLING_RULES}`,
    },
  )
  const categories = categoryNames(deps).join(', ')
  const category = z
    .string()
    .describe(`Category name, exactly one of: ${categories}`)
  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: Shape,
    run: (input: z.infer<z.ZodObject<Shape>>) => object,
  ) => {
    server.registerTool(
      name,
      { description, inputSchema: shape, annotations: readOnly },
      ((input: z.infer<z.ZodObject<Shape>>) => {
        // Argument names only: values can contain search text and months of interest.
        log(`tool=${name} args=${Object.keys(input).sort().join(',') || '-'}`)
        try {
          return {
            content: [{ type: 'text', text: JSON.stringify(run(input)) }],
          }
        } catch (error) {
          const known = error instanceof AnswerError
          log(
            `tool=${name} error=${known ? 'invalid_request' : error instanceof Error ? error.name : 'unknown'}`,
          )
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: known
                  ? (error as Error).message
                  : 'SpendWise could not compute this answer.',
              },
            ],
          }
        }
      }) as never,
    )
  }
  tool(
    'where_money_went',
    'Where did the money go in a month? Everyday spending by category, other outflows such as mortgage and loans, money in, the largest transactions and how current the data is.',
    { month: month.optional() },
    (input) => whereMoneyWent(deps, input),
  )
  tool(
    'compare_to_usual',
    'Is a month more than usual? Compares everyday spending through the same day of the month with the median of the six preceding months, overall and per category, with the rows behind any increase.',
    { month: month.optional(), category: category.optional() },
    (input) => compareToUsual(deps, input),
  )
  tool(
    'left_before_payday',
    "What's left before payday? Current balance, next salary, expected payments before it, projected and lowest balance. Forecast rows are marked estimated. Takes no arguments.",
    {},
    () => leftBeforePayday(deps),
  )
  tool(
    'anything_off',
    'Does anything look off? The home screen Brief notices plus late commitments, possible double charges and fees or interest, each with its evidence. Takes no arguments.',
    {},
    () => anythingOff(deps),
  )
  tool(
    'transactions_for_figure',
    'Which transactions support a figure? Lists rows and their total. Other tools return the exact arguments to pass as `figure`; the total matches that figure.',
    {
      month: month.describe('Calendar month as YYYY-MM.'),
      bucket: z
        .enum(['routine', 'outside_routine', 'all'])
        .default('routine')
        .describe(
          'routine: everyday spending. outside_routine: other real outflows such as mortgage, loans and projects. all: both.',
        ),
      direction: z
        .enum(['out', 'in', 'both'])
        .default('out')
        .describe(
          'out: money leaving. in: money arriving, including refunds. both: all.',
        ),
      category: category.optional(),
      merchant: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Part of a merchant or payee name, in any language.'),
      through: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('Only rows up to this date within month, as YYYY-MM-DD.'),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    },
    (input) => transactionsForFigure(deps, input),
  )
  return server
}

const digest = (value: string) => createHash('sha256').update(value).digest()

export function createApp(options: {
  deps: HomeDeps
  token: string
  allowedHosts: string[]
  log: Log
}): Express {
  const { deps, token, log } = options
  const hosts = new Set(options.allowedHosts)
  const expected = digest(`Bearer ${token}`)
  const app = express()
  const refuse = (res: Response, status: number, code: string) => {
    log(`refused status=${status} reason=${code}`)
    res.status(status).json({ error: code })
  }
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Set by Tailscale if this is ever fronted by Funnel: the data stays on the tailnet.
    if (req.headers['tailscale-funnel-request'])
      return refuse(res, 403, 'funnel_refused')
    // By name, so a rebinding DNS record cannot reach this from a browser.
    if (!hosts.has((req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '')))
      return refuse(res, 403, 'host_refused')
    if (req.headers.origin) return refuse(res, 403, 'origin_refused')
    if (!timingSafeEqual(digest(req.headers.authorization ?? ''), expected))
      return refuse(res, 401, 'unauthorized')
    next()
  })
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  app.post('/mcp', express.json({ limit: '256kb' }), async (req, res, next) => {
    try {
      const server = createMcpServer(deps, log)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      next(error)
    }
  })
  app.all('/mcp', (_req, res) => {
    res.status(405).set('Allow', 'POST').json({ error: 'method_not_allowed' })
  })
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      log(`error=${error instanceof Error ? error.name : 'unknown'}`)
      res.status(500).json({ error: 'internal_error' })
    },
  )
  return app
}
