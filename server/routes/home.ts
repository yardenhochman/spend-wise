import { merchantKey, merchantFields } from '../lib/merchant-labels.js'
import type { Express, Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  homeBrief,
  homeCommitments,
  homeContext,
  homeProjects,
  homeRunway,
  type HomeDeps,
} from '../lib/home/service.js'
import type { Obligation } from '../lib/home/types.js'
const fields = z
  .object({
    name: z.string().trim().min(1).max(160),
    kind: z.enum([
      'mortgage',
      'tuition',
      'tax',
      'hoa',
      'loan',
      'utility',
      'other',
    ]),
    expectedAmount: z.number().finite().positive().nullable(),
    cadence: z.enum(['monthly', 'bimonthly', 'yearly', 'irregular']),
    dueDay: z.number().int().min(1).max(31),
    matchPattern: z.string().trim().min(1).max(200),
    confirmed: z.boolean(),
  })
  .strict()
const create = fields.partial().extend({ name: fields.shape.name })
function handler(fn: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      fn(req, res)
    } catch (error) {
      next(error)
    }
  }
}
function count(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const n = Number(value)
  return n >= 1 && n <= max ? n : null
}
export function mountHomeRoutes(app: Express, deps: HomeDeps): void {
  const rawField = z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((v) => merchantKey(v).length > 0)
  app.put(
    '/api/merchant-labels',
    handler((req, res) => {
      const parsed = z
        .object({
          rawMerchant: rawField,
          label: z.string().trim().min(1).max(160),
        })
        .strict()
        .safeParse(req.body)
      if (!parsed.success)
        return res
          .status(400)
          .json({
            error: {
              code: 'invalid_label',
              message: 'Enter a bank name and a label (1–160 characters).',
            },
          })
      const { rawMerchant, label } = parsed.data
      const key = merchantKey(rawMerchant)
      deps.db
        .prepare(`INSERT INTO merchant_aliases (id,raw_pattern,canonical_name,match_type,source)
      VALUES (?,?,?,'exact','user') ON CONFLICT(raw_pattern,source) DO UPDATE SET canonical_name=excluded.canonical_name,match_type='exact'`)
        .run(randomUUID(), key, label)
      res.json(merchantFields(deps.db, rawMerchant))
    }),
  )
  app.delete(
    '/api/merchant-labels',
    handler((req, res) => {
      const parsed = z
        .object({ rawMerchant: rawField })
        .strict()
        .safeParse(req.body)
      if (!parsed.success)
        return res
          .status(400)
          .json({
            error: { code: 'invalid_label', message: 'Bank name is required.' },
          })
      deps.db
        .prepare(
          "DELETE FROM merchant_aliases WHERE raw_pattern=? AND source='user'",
        )
        .run(merchantKey(parsed.data.rawMerchant))
      res.json(merchantFields(deps.db, parsed.data.rawMerchant))
    }),
  )
  for (const route of ['runway', 'commitments', 'brief', 'projects'] as const)
    app.get(
      `/api/home/${route}`,
      handler((req, res) => {
        const n = count(
          route === 'runway'
            ? req.query.days
            : route === 'commitments'
              ? req.query.months
              : undefined,
          route === 'runway' ? 56 : 6,
          route === 'runway' ? 366 : 36,
        )
        if (n === null)
          return res.status(400).json({
            error: { code: 'invalid_window', message: 'Invalid window size' },
          })
        const ctx = homeContext(deps)
        res.json(
          route === 'runway'
            ? homeRunway(deps, ctx, n)
            : route === 'commitments'
              ? homeCommitments(deps, ctx, n)
              : route === 'projects'
                ? homeProjects(deps, ctx)
                : homeBrief(deps, ctx),
        )
      }),
    )
  function save(o: Obligation, deleted = false) {
    const now = new Date().toISOString()
    deps.db.transaction(() => {
      deps.db
        .prepare(
          'INSERT INTO obligations (id,name,kind,expected_amount,cadence,due_day,anchor_month,confirmed,created_at,updated_at,deleted,name_is_user) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,expected_amount=excluded.expected_amount,cadence=excluded.cadence,due_day=excluded.due_day,confirmed=excluded.confirmed,updated_at=excluded.updated_at,deleted=excluded.deleted,name_is_user=excluded.name_is_user',
        )
        .run(
          o.id,
          o.name,
          o.kind,
          o.expectedAmount,
          o.cadence,
          o.dueDay,
          o.anchorMonth,
          +o.confirmed,
          now,
          now,
          +deleted,
          +(o.userNamed ?? false),
        )
      deps.db
        .prepare(
          'INSERT INTO obligation_matching_rules (obligation_id,pattern,tolerance) VALUES (?,?,?) ON CONFLICT(obligation_id) DO UPDATE SET pattern=excluded.pattern,tolerance=excluded.tolerance',
        )
        .run(o.id, o.matchPattern, o.tolerance)
    })()
  }
  app.post(
    '/api/obligations',
    handler((req, res) => {
      const parsed = create.safeParse(req.body)
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: 'invalid_obligation',
            message: 'Invalid obligation fields',
          },
        })
      const b = parsed.data
      const o: Obligation = {
        id: randomUUID(),
        name: b.name,
        userNamed: true,
        kind: b.kind ?? 'other',
        expectedAmount: b.expectedAmount ?? null,
        cadence: b.cadence ?? 'monthly',
        dueDay: b.dueDay ?? 1,
        matchPattern: b.matchPattern ?? b.name,
        confirmed: b.confirmed ?? true,
        anchorMonth: deps.today().slice(0, 7),
        tolerance: 0.15,
      }
      save(o)
      res.status(201).json(o)
    }),
  )
  app.put(
    '/api/obligations/:id',
    handler((req, res) => {
      const parsed = fields.partial().safeParse(req.body)
      if (!parsed.success || !Object.keys(parsed.data).length)
        return res.status(400).json({
          error: {
            code: 'invalid_obligation',
            message: 'Invalid obligation fields',
          },
        })
      const existing = homeContext(deps).obligations.find(
        (o) => o.id === req.params.id,
      )
      if (!existing)
        return res.status(404).json({
          error: { code: 'not_found', message: 'Obligation not found' },
        })
      const o = {
        ...existing,
        ...parsed.data,
        userNamed: parsed.data.name !== undefined || existing.userNamed,
        confirmed:
          parsed.data.name !== undefined
            ? true
            : (parsed.data.confirmed ?? existing.confirmed),
      }
      save(o)
      const { paymentIds: _paymentIds, ...entity } = o
      res.json(entity)
    }),
  )
  app.delete(
    '/api/obligations/:id',
    handler((req, res) => {
      const o = homeContext(deps).obligations.find(
        (o) => o.id === req.params.id,
      )
      if (!o)
        return res.status(404).json({
          error: { code: 'not_found', message: 'Obligation not found' },
        })
      // Keep a tombstone so a deleted computed suggestion stays removed.
      save(o, true)
      res.status(204).end()
    }),
  )
}
