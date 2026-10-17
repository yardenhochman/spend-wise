import { migrateObligations } from '../lib/home/migration.js'
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
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const rule = z
  .object({
    pattern: z.string().trim().min(1).max(200),
    payee: z.string().trim().min(1).max(160).nullable().optional(),
    expectedAmount: z.number().finite().positive().nullable().optional(),
    effectiveFrom: month.nullable().optional(),
    tolerance: z.number().min(0).max(1).optional(),
  })
  .strict()
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
    matchingRules: z.array(rule).min(1).max(30),
    paidFrom: z.enum(['tracked', 'untracked']),
    paidFromLabel: z.string().trim().min(1).max(160).nullable(),
    paidFromSince: month.nullable(),
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
  migrateObligations(deps.db)
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
        return res.status(400).json({
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
        return res.status(400).json({
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
          'INSERT INTO obligations (id,name,kind,expected_amount,cadence,due_day,anchor_month,confirmed,created_at,updated_at,deleted,name_is_user,paid_from,paid_from_label,paid_from_since) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,expected_amount=excluded.expected_amount,cadence=excluded.cadence,due_day=excluded.due_day,confirmed=excluded.confirmed,updated_at=excluded.updated_at,deleted=excluded.deleted,name_is_user=excluded.name_is_user,paid_from=excluded.paid_from,paid_from_label=excluded.paid_from_label,paid_from_since=excluded.paid_from_since',
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
          o.paidFrom ?? 'tracked',
          o.paidFromLabel ?? null,
          o.paidFromSince ?? null,
        )
      const rules = o.matchingRules ?? [
        { pattern: o.matchPattern, tolerance: o.tolerance },
      ]
      const [first, ...rest] = rules
      deps.db
        .prepare(`INSERT INTO obligation_matching_rules (obligation_id,pattern,tolerance,payee,expected_amount,effective_from,additional_rules) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(obligation_id) DO UPDATE SET pattern=excluded.pattern,tolerance=excluded.tolerance,payee=excluded.payee,expected_amount=excluded.expected_amount,effective_from=excluded.effective_from,additional_rules=excluded.additional_rules`)
        .run(
          o.id,
          first.pattern,
          first.tolerance ?? o.tolerance,
          first.payee ?? null,
          first.expectedAmount ?? null,
          first.effectiveFrom ?? null,
          JSON.stringify(rest),
        )
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
        matchPattern: b.matchPattern ?? b.matchingRules?.[0].pattern ?? b.name,
        confirmed: b.confirmed ?? true,
        anchorMonth: deps.today().slice(0, 7),
        tolerance: 0.15,
        matchingRules: b.matchingRules,
        paidFrom: b.paidFrom ?? 'tracked',
        paidFromLabel: b.paidFromLabel,
        paidFromSince: b.paidFromSince,
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
        matchPattern:
          parsed.data.matchingRules?.[0].pattern ??
          parsed.data.matchPattern ??
          existing.matchPattern,
        matchingRules:
          parsed.data.matchingRules ??
          (parsed.data.matchPattern
            ? [
                {
                  pattern: parsed.data.matchPattern,
                  tolerance: existing.tolerance,
                },
              ]
            : existing.matchingRules),
        userNamed: parsed.data.name !== undefined || existing.userNamed,
        confirmed:
          parsed.data.name !== undefined
            ? true
            : (parsed.data.confirmed ?? existing.confirmed),
      }
      save(o)
      const {
        paymentIds: _paymentIds,
        paymentAmounts: _paymentAmounts,
        ...entity
      } = o
      res.json(entity)
    }),
  )
  app.put(
    '/api/obligations/:id/months/:month',
    handler((req, res) => {
      const parsed = z
        .object({
          status: z.enum(['paid', 'clear']),
          note: z.string().trim().max(500).optional(),
        })
        .strict()
        .safeParse(req.body)
      if (!month.safeParse(req.params.month).success || !parsed.success)
        return res
          .status(400)
          .json({
            error: {
              code: 'invalid_month_mark',
              message: 'Invalid month or mark',
            },
          })
      const o = homeContext(deps).obligations.find(
        (o) => o.id === req.params.id,
      )
      if (!o)
        return res
          .status(404)
          .json({
            error: { code: 'not_found', message: 'Obligation not found' },
          })
      deps.db.transaction(() => {
        save(o)
        if (parsed.data.status === 'clear')
          deps.db
            .prepare(
              'DELETE FROM obligation_month_marks WHERE obligation_id=? AND month=?',
            )
            .run(o.id, req.params.month)
        else
          deps.db
            .prepare(
              'INSERT INTO obligation_month_marks (obligation_id,month,note) VALUES (?,?,?) ON CONFLICT(obligation_id,month) DO UPDATE SET note=excluded.note',
            )
            .run(o.id, req.params.month, parsed.data.note ?? null)
      })()
      res.json({ month: req.params.month, ...parsed.data })
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
