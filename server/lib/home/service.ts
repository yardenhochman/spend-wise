import { readMerchantAliases } from '../merchant-labels.js'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { ViewModeFilter } from '../../types.js'
import type { HouseholdConfig } from '../private-config.js'
import { queryCategoryTrend, queryRecurring } from '../analytics.js'
import { summarizeTaggedAmounts, type TaggedAmount } from '../tag-summary.js'
import { latestBalances } from './balances.js'
import { buildBrief, recurringItems } from './brief.js'
import { addDays, monthsThrough, monthOffset, round } from './dates.js'
import { householdTransaction, isChecking } from './household.js'
import {
  assignPayments,
  detectObligations,
  mortgageObligation,
  mortgageRepayments,
  obligationEvents,
  obligationTrail,
  matchesObligation,
} from './obligations.js'
import { buildRunway } from './runway.js'
import { cardIssuer, displayName, serviceKey } from './labels.js'
import { cardSettlementEvents, salaryEvents } from './settlements.js'
import type {
  Balance,
  HomeTransaction,
  MortgageSnapshot,
  Obligation,
  ProjectsResponse,
} from './types.js'
export interface HomeDeps {
  db: Database.Database
  routineFilter: () => ViewModeFilter
  config?: HouseholdConfig
  today: () => string
  mortgage: () => MortgageSnapshot | null
}
export function readMortgageSnapshot(): MortgageSnapshot | null {
  const file = path.resolve('private/leumi-mortgages.latest.json')
  if (!fs.existsSync(file)) return null
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (
    !value ||
    typeof value !== 'object' ||
    !('source' in value) ||
    value.source !== 'leumi-mortgages' ||
    !('mortgages' in value) ||
    !Array.isArray(value.mortgages)
  )
    throw new Error('Invalid private mortgage snapshot')
  return value as MortgageSnapshot
}
export interface StoredObligation {
  name_is_user: number
  id: string
  name: string
  kind: Obligation['kind']
  expected_amount: number | null
  cadence: Obligation['cadence']
  due_day: number
  anchor_month: string
  confirmed: number
  pattern: string | null
  tolerance: number | null
  deleted: number
}
export function storedObligations(db: Database.Database): {
  obligations: Obligation[]
  deleted: string[]
} {
  const rows = db
    .prepare(
      'SELECT o.*,r.pattern,r.tolerance FROM obligations o LEFT JOIN obligation_matching_rules r ON r.obligation_id=o.id ORDER BY o.id',
    )
    .all() as StoredObligation[]
  return {
    obligations: rows
      .filter((r) => !r.deleted)
      .map((r) => ({
        id: r.id,
        name: r.name,
        userNamed: !!r.name_is_user,
        kind: r.kind,
        expectedAmount: r.expected_amount,
        cadence: r.cadence,
        dueDay: r.due_day,
        anchorMonth: r.anchor_month,
        confirmed: !!r.confirmed,
        matchPattern: r.pattern ?? r.name,
        tolerance: r.tolerance ?? 0.15,
      })),
    deleted: rows.filter((r) => r.deleted).map((r) => r.id),
  }
}
export function homeContext(deps: HomeDeps) {
  const { db, config } = deps
  const today = deps.today()
  const aliases = readMerchantAliases(db)
  const all = (
    db
      .prepare(
        'SELECT t.*,a.account_label,a.bank_name,c.name AS category_name FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id WHERE t.date<=? ORDER BY t.date,t.id',
      )
      .all(today) as HomeTransaction[]
  )
    .filter((t) => householdTransaction(t, config))
    .map((t) => ({ ...t, display_name: displayName(t.merchant, aliases) }))
  const routine = deps.routineFilter()
  const allowedIds = new Set(
    (
      db
        .prepare(
          `SELECT t.id FROM transactions t WHERE t.is_internal=0 ${routine.sql}`,
        )
        .all(...routine.params) as { id: string }[]
    ).map((t) => t.id),
  )
  const rows = all.filter(
    (t) => allowedIds.has(t.id) && !(isChecking(t) && cardIssuer(t.merchant)),
  )
  const ids = all.map((t) => t.id)
  const scope: ViewModeFilter = {
    sql: `${routine.sql} AND t.id IN (SELECT value FROM json_each(?))`,
    params: [...routine.params, JSON.stringify(rows.map((t) => t.id))],
    includeInternal: false,
  }
  const mortgage = deps.mortgage()
  const stored = storedObligations(db)
  const mortgages = assignPayments(mortgageObligation(mortgage, today), all)
  const mortgagePayments = new Set(mortgages.flatMap((o) => o.paymentIds ?? []))
  const candidates = [
    ...detectObligations(
      rows.filter((t) => !mortgagePayments.has(t.id)),
      today,
      config?.obligationMinimum ?? 100,
    ),
    ...mortgages,
  ]
  const obligations = assignPayments(
    [
      ...stored.obligations,
      ...candidates.filter(
        (o) =>
          !stored.deleted.includes(o.id) &&
          !stored.obligations.some(
            (s) =>
              s.id === o.id ||
              (o.kind !== 'mortgage' && s.matchPattern === o.matchPattern),
          ),
      ),
    ].filter((o) => !cardIssuer(o.matchPattern)),
    all,
  )
  // Only explicitly renamed obligations override the current merchant label.
  for (const o of obligations) {
    const payment = all.find((t) => matchesObligation(o, t))
    o.rawMerchant = payment?.merchant
    if (
      !o.userNamed &&
      payment &&
      (o.kind !== 'mortgage' || payment.display_name !== payment.merchant)
    )
      o.name = payment.display_name ?? payment.merchant
  }
  const importRow = db
    .prepare(
      `SELECT MAX(f.imported_at) AS date FROM statement_files f JOIN transactions t ON t.source_file_id=f.id WHERE f.status='completed' AND t.id IN (SELECT value FROM json_each(?))`,
    )
    .get(JSON.stringify(ids)) as { date: string | null }
  return {
    today,
    all,
    rows,
    scope,
    mortgage,
    obligations,
    lastImportAt: importRow.date,
  }
}
export type HomeContext = ReturnType<typeof homeContext>
export function homeRunway(deps: HomeDeps, ctx: HomeContext, count: number) {
  const balances = latestBalances(
    deps.db.prepare('SELECT * FROM account_balances').all() as Balance[],
    ctx.today,
    deps.config,
  )
  const end = addDays(ctx.today, count - 1)
  const events = [
    ...salaryEvents(ctx.rows, ctx.today, end),
    ...cardSettlementEvents(ctx.all, ctx.today, end),
    ...obligationEvents(ctx.obligations, ctx.all, ctx.today, end),
  ]
  const warnings: string[] = []
  if (!deps.config?.accountNumbers.length)
    warnings.push('Household account allowlist is not configured')
  if (
    !ctx.all.some(
      (t) => isChecking(t) && t.amount < 0 && !!cardIssuer(t.merchant),
    )
  )
    warnings.push(
      'Card billing dates unavailable; settlement forecast may be incomplete',
    )
  if (
    ctx.obligations.some(
      (o) => o.expectedAmount === null || o.cadence === 'irregular',
    )
  )
    warnings.push(
      'Some obligations cannot be projected without an amount or regular cadence',
    )
  return buildRunway(ctx.today, count, balances, events, warnings)
}
export function homeCommitments(
  deps: HomeDeps,
  ctx: HomeContext,
  count: number,
) {
  const months = monthsThrough(ctx.today, count)
  const obligationKeys = new Set(
    ctx.obligations.map((o) => serviceKey({ merchant: o.name })),
  )
  const items = recurringItems(
    queryRecurring(deps.db, ctx.scope, new Date(ctx.today + 'T12:00:00Z')),
    ctx.rows.filter(
      (t) =>
        !obligationKeys.has(serviceKey(t)) &&
        !ctx.obligations.some((o) =>
          matchesObligation({ ...o, paymentIds: undefined }, t),
        ),
    ),
    ctx.today,
  )
  return {
    months,
    obligations: ctx.obligations.map((o) =>
      obligationTrail(
        o,
        ctx.all,
        months,
        ctx.today,
        deps.config?.graceDays ?? 5,
      ),
    ),
    repayments: mortgageRepayments(ctx.mortgage).map((r) => ({
      ...r,
      name: ctx.obligations.find((o) => o.id === r.id)?.name ?? r.name,
    })),
    recurring: {
      annualTotal: round(items.reduce((s, i) => s + i.annualized, 0)),
      items,
    },
  }
}
export function homeProjects(
  deps: HomeDeps,
  ctx: HomeContext,
): ProjectsResponse {
  const tags = deps.db
    .prepare(
      "SELECT tags.id,tags.name,p.start_date,p.end_date FROM tags LEFT JOIN tag_profiles p ON p.tag_id=tags.id WHERE p.start_date IS NOT NULL OR p.end_date IS NOT NULL OR lower(tags.name) IN ('wedding','home','apartment','honeymoon','חתונה','דירה','ירח דבש') ORDER BY tags.name",
    )
    .all() as {
    id: string
    name: string
    start_date: string | null
    end_date: string | null
  }[]
  // Project costs deliberately include project categories; household and internal scope remain enforced.
  const ids = new Set(ctx.all.filter((t) => !t.is_internal).map((t) => t.id))
  return {
    projects: tags.map((tag) => {
      const tagged = deps.db
        .prepare(
          'SELECT t.id,t.amount,t.date,c.name AS category_name,v.valuation_status FROM transactions t JOIN transaction_tags tt ON tt.transaction_id=t.id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN transaction_valuations v ON v.transaction_id=t.id WHERE tt.tag_id=? ORDER BY t.date',
        )
        .all(tag.id) as (TaggedAmount & { id: string; date: string })[]
      const rows = tagged.filter((t) => ids.has(t.id))
      return {
        tag: tag.name,
        label: tag.name,
        net: round(
          summarizeTaggedAmounts(rows, tag.start_date, tag.end_date).net,
        ),
        status:
          tag.end_date && tag.end_date < ctx.today
            ? ('ended' as const)
            : ('open' as const),
        lastActivity: rows.at(-1)?.date ?? null,
      }
    }),
  }
}
export function homeBrief(deps: HomeDeps, ctx: HomeContext) {
  const commitments = homeCommitments(deps, ctx, 6)
  const months = Array.from({ length: 6 }, (_, i) =>
    monthOffset(ctx.today, i - 6),
  )
  const categories = deps.db
    .prepare('SELECT id,name FROM categories ORDER BY id')
    .all() as { id: string; name: string }[]
  const series = categories.map((c) => {
    const trend = queryCategoryTrend(
      deps.db,
      ctx.scope,
      c.id,
      months[0] + '-01',
      addDays(ctx.today.slice(0, 7) + '-01', -1),
    )
    return {
      ...c,
      points: months.map(
        (m) => trend.points.find((p) => p.period === m)?.total ?? 0,
      ),
    }
  })
  const brief = buildBrief(
    ctx.today,
    ctx.rows,
    commitments.obligations,
    commitments.recurring.items,
    series,
    homeProjects(deps, ctx).projects,
    homeRunway(deps, ctx, 56),
    ctx.lastImportAt,
    deps.config?.runwayFloor ?? 0,
  )
  return {
    ...brief,
    notices: brief.notices.map((n) => ({
      ...n,
      rawMerchants: [
        ...new Set(
          ctx.rows
            .filter(
              (t) =>
                t.display_name &&
                t.display_name !== t.merchant &&
                `${n.title} ${n.body}`.includes(t.display_name),
            )
            .map((t) => t.merchant),
        ),
      ],
    })),
  }
}
