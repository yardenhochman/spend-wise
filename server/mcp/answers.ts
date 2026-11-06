/** Read-only answers to household money questions. See specs/SPEC-020-agent-access.md. */
import {
  addDays,
  dueDate,
  median,
  monthOffset,
  round,
} from '../lib/home/dates.js'
import { isChecking } from '../lib/home/household.js'
import {
  cardIssuer,
  formatMoney,
  transactionLabel,
} from '../lib/home/labels.js'
import { matchesObligation } from '../lib/home/obligations.js'
import {
  homeBrief,
  homeCommitments,
  homeContext,
  homeRunway,
  type HomeContext,
  type HomeDeps,
} from '../lib/home/service.js'
import { dataFreshness } from '../lib/home/signals.js'
import type { HomeTransaction } from '../lib/home/types.js'
import { merchantKey } from '../lib/merchant-labels.js'
import { isGenericTransfer, transferPayee } from '../lib/payees.js'

export const UNCATEGORIZED = 'Uncategorized'
export const HANDLING_RULES =
  'Private household financial data. Do not save any of it to agent memory, notes or shared context. Do not publish, share or upload it, including as an artifact, page, gist, document or message, unless the user confirms that specific action first. The server cannot enforce this: it depends on you and your client.'

const IMPORT_DUPLICATES =
  'Two spellings of one card purchase can be imported twice, so spending figures can run slightly high. Repeated rows with different merchant spellings are the sign.'

export type Bucket = 'routine' | 'outside_routine' | 'all'
export type Direction = 'out' | 'in' | 'both'
export interface FigureQuery {
  month: string
  bucket: Bucket
  direction: Direction
  category?: string
  merchant?: string
  through?: string
}

type SpreadTransaction = HomeTransaction & { spread_months?: number | null }
interface Entry {
  tx: SpreadTransaction
  counted: number
}

const maskDigits = (text: string) =>
  text.replace(/\d{6,}/g, (run) => `•••${run.slice(-4)}`)
/** Direction marks help screens, not agents, and break text matching. */
const plain = (text: string) => maskDigits(text.replace(/[⁦-⁩]/g, ''))
const categoryOf = (tx: HomeTransaction) => tx.category_name ?? UNCATEGORIZED
const monthEnd = (month: string) => dueDate(month, 31)

export class AnswerError extends Error {}

export function assertMonth(month: string, today: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new AnswerError('month must look like 2026-03')
  if (month > today.slice(0, 7))
    throw new AnswerError('month cannot be in the future')
}

function merchantOf(tx: HomeTransaction): string {
  const payee = isGenericTransfer(tx.merchant) ? transferPayee(tx.notes) : null
  return plain(payee ?? transactionLabel(tx))
}

function evidenceRow(entry: Entry, estimated: Set<string>) {
  const { tx, counted } = entry
  return {
    id: tx.id,
    date: tx.date,
    merchant: merchantOf(tx),
    amount: tx.amount,
    countedInFigure: round(counted),
    category: categoryOf(tx),
    account: tx.account_label,
    ...(tx.spread_months ? { spreadMonths: tx.spread_months } : {}),
    ...(estimated.has(tx.id) ? { valuation: 'estimated' as const } : {}),
  }
}
export type EvidenceRow = ReturnType<typeof evidenceRow>

const biggest = (a: Entry, b: Entry) =>
  Math.abs(b.counted) - Math.abs(a.counted) ||
  b.tx.date.localeCompare(a.tx.date)

class Ledger {
  readonly ctx: HomeContext
  readonly today: string
  readonly outsideRoutine: SpreadTransaction[]
  readonly estimated: Set<string>
  readonly categories: string[]

  constructor(readonly deps: HomeDeps) {
    this.ctx = homeContext(deps)
    this.today = this.ctx.today
    const routineIds = new Set(this.ctx.rows.map((t) => t.id))
    // Same exclusions as routine: internal moves and card settlement debits would double count.
    this.outsideRoutine = this.ctx.all.filter(
      (t) =>
        !t.is_internal &&
        !routineIds.has(t.id) &&
        !(isChecking(t) && cardIssuer(t.merchant)),
    )
    this.estimated = new Set(
      (
        deps.db
          .prepare(
            "SELECT transaction_id AS id FROM transaction_valuations WHERE valuation_status='estimated'",
          )
          .all() as { id: string }[]
      ).map((r) => r.id),
    )
    this.categories = categoryNames(deps)
  }

  rows(bucket: Bucket): SpreadTransaction[] {
    if (bucket === 'routine') return this.ctx.rows
    if (bucket === 'outside_routine') return this.outsideRoutine
    return [...this.ctx.rows, ...this.outsideRoutine]
  }

  /** A spread payment counts evenly over the months ending at its payment month. */
  entries(bucket: Bucket, month: string): Entry[] {
    return this.rows(bucket).flatMap((tx) => {
      const paid = tx.date.slice(0, 7)
      const n = tx.spread_months
      if (!n) return paid === month ? [{ tx, counted: tx.amount }] : []
      return month <= paid && month >= monthOffset(paid, 1 - n)
        ? [{ tx, counted: tx.amount / n }]
        : []
    })
  }

  select(query: FigureQuery): Entry[] {
    const key = query.merchant ? merchantKey(query.merchant) : null
    return this.entries(query.bucket, query.month).filter(({ tx, counted }) => {
      if (query.direction === 'out' && counted >= 0) return false
      if (query.direction === 'in' && counted < 0) return false
      if (query.category && categoryOf(tx) !== query.category) return false
      // A spread allocation belongs to the month as a whole, not to a day in it.
      if (query.through && !tx.spread_months && tx.date > query.through)
        return false
      return (
        !key || merchantKey(`${tx.merchant} ${merchantOf(tx)}`).includes(key)
      )
    })
  }

  rowsOf(entries: Entry[]) {
    return entries.map((e) => evidenceRow(e, this.estimated))
  }

  envelope<T extends object>(
    question: string,
    summary: string,
    answer: T,
    warnings: string[] = [],
  ) {
    const dataThrough = this.dataThrough()
    const stale = dataThrough.freshness
      .filter((f) => f.stale)
      .map(
        (f) =>
          `${f.label} data ends ${f.through}; recent activity may be missing.`,
      )
    if (!dataThrough.lastImportAt) stale.push('No completed import is known.')
    return {
      question,
      summary,
      asOf: this.today,
      dataThrough,
      warnings: [...new Set([...stale, ...warnings])].map(plain),
      scope:
        'Household accounts only. Committee account, internal transfers and card settlement debits are excluded.',
      ...answer,
      handling: HANDLING_RULES,
    }
  }

  private dataThrough() {
    const latest = new Map<string, string>()
    for (const t of this.ctx.all)
      if (t.date > (latest.get(t.account_label) ?? ''))
        latest.set(t.account_label, t.date)
    const dates = [...latest.values()].sort()
    return {
      latestTransaction: dates.at(-1) ?? null,
      byAccount: [...latest]
        .map(([account, latestTransaction]) => ({ account, latestTransaction }))
        .sort((a, b) => a.account.localeCompare(b.account)),
      freshness: dataFreshness(this.ctx.all, this.today),
      lastImportAt: this.ctx.lastImportAt,
    }
  }
}

function assertCategory(ledger: Ledger, category?: string) {
  if (category && !ledger.categories.includes(category))
    throw new AnswerError(
      `Unknown category. Use one of: ${ledger.categories.join(', ')}`,
    )
}

const sumCounted = (entries: Entry[]) =>
  entries.reduce((sum, e) => sum + e.counted, 0)
const outflow = (entries: Entry[]) => round(-sumCounted(entries)) + 0

function groupByCategory(entries: Entry[]): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>()
  for (const entry of entries) {
    const name = categoryOf(entry.tx)
    groups.set(name, [...(groups.get(name) ?? []), entry])
  }
  return groups
}

/** The request that lists a figure's rows, for the caller to repeat as is. */
function figureRequest(query: Partial<FigureQuery> & { month: string }) {
  return {
    tool: 'transactions_for_figure',
    arguments: Object.fromEntries(
      Object.entries(query).filter(([, value]) => value !== undefined),
    ),
  }
}

export function whereMoneyWent(deps: HomeDeps, input: { month?: string }) {
  const ledger = new Ledger(deps)
  const month = input.month ?? ledger.today.slice(0, 7)
  assertMonth(month, ledger.today)
  const breakdown = (bucket: 'routine' | 'outside_routine') => {
    const entries = ledger.select({ month, bucket, direction: 'out' })
    const total = outflow(entries)
    return {
      total,
      transactions: entries.length,
      figure: figureRequest({ month, bucket, direction: 'out' }),
      categories: [...groupByCategory(entries)]
        .map(([category, rows]) => ({
          category,
          spent: outflow(rows),
          share: total ? round(outflow(rows) / total) : 0,
          transactions: rows.length,
          figure: figureRequest({ month, bucket, direction: 'out', category }),
        }))
        .sort((a, b) => b.spent - a.spent),
      entries,
    }
  }
  const { entries: routineEntries, ...routine } = breakdown('routine')
  const { entries: outsideEntries, ...outsideRoutine } =
    breakdown('outside_routine')
  const moneyIn = ledger.select({ month, bucket: 'all', direction: 'in' })
  const unknown = routineEntries.filter((e) => !e.tx.category_name).length
  const top = routine.categories.slice(0, 3)
  return ledger.envelope(
    `Where did the money go in ${month}?`,
    `${formatMoney(routine.total)} of everyday spending in ${month}` +
      (top.length
        ? `, mostly ${top.map((c) => `${c.category} ${formatMoney(c.spent)}`).join(', ')}`
        : '') +
      `. ${formatMoney(outsideRoutine.total)} more left outside everyday spending, such as mortgage, loans and projects.`,
    {
      month,
      partialMonth: month === ledger.today.slice(0, 7),
      routine,
      outsideRoutine,
      moneyIn: {
        total: round(sumCounted(moneyIn)),
        transactions: moneyIn.length,
        figure: figureRequest({ month, bucket: 'all', direction: 'in' }),
      },
      evidence: ledger.rowsOf(
        [...routineEntries, ...outsideEntries].sort(biggest).slice(0, 15),
      ),
    },
    [
      IMPORT_DUPLICATES,
      ...(unknown && routineEntries.length
        ? [
            `${Math.round((unknown / routineEntries.length) * 100)}% of this month's everyday transactions are uncategorized.`,
          ]
        : []),
    ],
  )
}

export function compareToUsual(
  deps: HomeDeps,
  input: { month?: string; category?: string },
) {
  const ledger = new Ledger(deps)
  const month = input.month ?? ledger.today.slice(0, 7)
  assertMonth(month, ledger.today)
  assertCategory(ledger, input.category)
  const bucket = 'routine' as const
  const current = month === ledger.today.slice(0, 7)
  const dated = ledger
    .entries(bucket, month)
    .filter((e) => !e.tx.spread_months && e.tx.date <= ledger.today)
    .map((e) => e.tx.date)
    .sort()
  // Slow card imports must not read as lower spending: stop at the latest day with data.
  const through = current ? (dated.at(-1) ?? ledger.today) : monthEnd(month)
  const day = Number(through.slice(8))
  const firstMonth = ledger.ctx.rows.map((t) => t.date.slice(0, 7)).sort()[0]
  const baseline = Array.from({ length: 6 }, (_, i) =>
    monthOffset(month, i - 6),
  ).filter((m) => firstMonth && m >= firstMonth)
  const enough = baseline.length >= 3
  const select = (m: string, upTo?: string) =>
    ledger
      .select({ month: m, bucket, direction: 'out', through: upTo })
      .filter((e) => !input.category || categoryOf(e.tx) === input.category)
  const selected = select(month, through)
  const baseEntries = baseline.map((m) => ({
    month: m,
    sameDay: select(m, dueDate(m, day)),
    full: select(m),
  }))
  const compare = (name: string | null) => {
    const only = (entries: Entry[]) =>
      name === null ? entries : entries.filter((e) => categoryOf(e.tx) === name)
    const amount = outflow(only(selected))
    const usual = round(
      median(baseEntries.map((b) => outflow(only(b.sameDay)))),
    )
    const difference = round(amount - usual)
    const status = !enough
      ? ('not_enough_history' as const)
      : usual > 0 && Math.abs(difference) / usual < 0.25
        ? ('about_usual' as const)
        : Math.abs(difference) < 100
          ? ('about_usual' as const)
          : difference > 0
            ? ('above_usual' as const)
            : ('below_usual' as const)
    return { amount, usual, difference, status }
  }
  const overall = compare(null)
  const compared = baseEntries.flatMap((b) => b.full)
  const reliable =
    !compared.length ||
    compared.filter((e) => !e.tx.category_name).length / compared.length <= 0.3
  const names = [
    ...new Set([...selected, ...compared].map((e) => categoryOf(e.tx))),
  ]
  const categories = input.category
    ? []
    : names
        .map((category) => ({
          category,
          ...compare(category),
          figure: figureRequest({
            month,
            bucket,
            direction: 'out',
            category,
            through,
          }),
        }))
        .sort(
          (a, b) =>
            Math.abs(b.difference) - Math.abs(a.difference) ||
            a.category.localeCompare(b.category),
        )
  const above = new Set(
    categories.filter((c) => c.status === 'above_usual').map((c) => c.category),
  )
  const label = input.category ?? 'Everyday spending'
  const statusText = {
    above_usual: 'above usual',
    below_usual: 'below usual',
    about_usual: 'about usual',
    not_enough_history: 'not comparable yet, with under three earlier months',
  }[overall.status]
  return ledger.envelope(
    `Is ${month} more than usual?`,
    `${label} through ${through} is ${formatMoney(overall.amount)}, ${statusText}. The median for the same point in the previous ${baseline.length} months is ${formatMoney(overall.usual)}.`,
    {
      month,
      comparedThrough: through,
      category: input.category ?? null,
      comparisonMethod: `Spending through day ${day} of each month, median of the ${baseline.length} preceding months.`,
      categoryComparisonReliable: reliable,
      total: {
        ...overall,
        usualFullMonth: round(median(baseEntries.map((b) => outflow(b.full)))),
        figure: figureRequest({
          month,
          bucket,
          direction: 'out',
          category: input.category,
          through,
        }),
      },
      history: baseEntries.map((b) => ({
        month: b.month,
        throughSameDay: outflow(b.sameDay),
        fullMonth: outflow(b.full),
      })),
      categories,
      evidence: ledger.rowsOf(
        (above.size
          ? selected.filter((e) => above.has(categoryOf(e.tx)))
          : selected
        )
          .sort(biggest)
          .slice(0, 15),
      ),
    },
    [
      IMPORT_DUPLICATES,
      ...(reliable
        ? []
        : [
            'Over 30% of comparison transactions are uncategorized, so category comparisons are unreliable.',
          ]),
      ...(current && through < ledger.today
        ? [`No everyday transactions after ${through} yet.`]
        : []),
    ],
  )
}

export function leftBeforePayday(deps: HomeDeps) {
  const ledger = new Ledger(deps)
  const runway = homeRunway(deps, ledger.ctx, 56)
  const salary = runway.nextSalary
  const horizon = salary?.date ?? addDays(ledger.today, 14)
  const days = runway.days.filter((d) =>
    salary ? d.date < salary.date : d.date <= horizon,
  )
  const unknownBalance = runway.openingBalance === null
  const projected = unknownBalance
    ? null
    : (days.at(-1)?.balance ?? runway.openingBalance)
  const lowest = days.reduce<(typeof days)[number] | null>(
    (low, d) => (!low || d.balance < low.balance ? d : low),
    null,
  )
  const events = runway.events.filter((e) => e.date <= horizon)
  const lastPosted = (merchant?: string) =>
    merchant
      ? ledger.ctx.all.filter((t) => t.merchant === merchant).at(-1)
      : undefined
  const eventRows = events.map((e) => {
    const basis = lastPosted(e.rawMerchant)
    return {
      date: e.date,
      label: plain(e.label),
      amount: e.amount,
      kind: e.kind,
      estimated: e.estimated,
      mostRecentTransaction: basis
        ? ledger.rowsOf([{ tx: basis, counted: basis.amount }])[0]
        : null,
    }
  })
  const until = salary
    ? `the next salary on ${salary.date}`
    : `${horizon}; the next salary date is unknown`
  const outgoing = events.filter((e) => e.amount < 0 && e.kind !== 'salary')
  return ledger.envelope(
    "What's left before payday?",
    projected === null
      ? `Balance not available yet, so what's left is unknown. ${formatMoney(-outgoing.reduce((s, e) => s + e.amount, 0))} of payments are expected through ${until}.`
      : `About ${formatMoney(projected)} left before ${until}, from ${formatMoney(runway.openingBalance!)} now, after ${formatMoney(-outgoing.reduce((s, e) => s + e.amount, 0))} of expected payments. Everyday spending not yet posted is not included.`,
    {
      balance: runway.openingBalance,
      balanceAsOf: runway.balanceAsOf,
      nextSalary: salary,
      projectedBeforePayday: projected,
      lowestBeforePayday: lowest,
      forecastMethod:
        'Latest balances plus forecast salary, card settlement and commitment events. Future everyday spending is not forecast.',
      evidence: {
        balances: runway.accounts,
        events: eventRows,
      },
    },
    runway.warnings,
  )
}

const EVIDENCE_LIMIT = 12

export function anythingOff(deps: HomeDeps) {
  const ledger = new Ledger(deps)
  const { ctx, today } = ledger
  const byId = new Map(ctx.all.map((t) => [t.id, t]))
  const toEntries = (txs: (HomeTransaction | undefined)[]) =>
    txs
      .filter((t): t is HomeTransaction => !!t)
      .map((tx) => ({ tx, counted: tx.amount }))
      .sort(biggest)
  const obligationRows = (id: string, since: string) => {
    const obligation = ctx.obligations.find((o) => o.id === id)
    return obligation
      ? ctx.all.filter(
          (t) => t.date >= since && matchesObligation(obligation, t),
        )
      : []
  }
  const finding = (
    source: 'brief' | 'commitment',
    severity: 'action' | 'watch' | 'info',
    title: string,
    body: string,
    entries: Entry[],
    noEvidenceReason: string,
    evidenceCount = entries.length,
  ) => ({
    source,
    severity,
    title: plain(title),
    body: plain(body),
    evidenceCount,
    evidence: ledger.rowsOf(entries.slice(0, EVIDENCE_LIMIT)),
    ...(entries.length ? {} : { noEvidenceReason }),
  })
  const brief = homeBrief(deps, ctx)
  const since = monthOffset(today, -6) + '-01'
  const findings = brief.notices.map((n) => {
    // Commitment notices name their obligations only in the prompt.
    const obligations =
      n.agentPrompt.match(/Obligation IDs: ([^.]*)\./)?.[1].split(', ') ?? []
    const owed = obligations.flatMap((id) => obligationRows(id, since))
    return finding(
      'brief',
      n.severity,
      n.title,
      n.body,
      toEntries([...n.evidence.map((e) => byId.get(e.id)), ...owed]),
      'This comes from the forecast or import status, not from specific transactions.',
      n.evidenceCount + owed.length,
    )
  })
  const commitments = homeCommitments(deps, ctx, 6).obligations
  for (const o of commitments)
    if (o.trail.at(-1)?.status === 'late')
      findings.push(
        finding(
          'commitment',
          'action',
          `${o.name}: payment looks late`,
          `No matching ${today.slice(0, 7)} payment was found${o.expectedAmount ? ` for the expected ${formatMoney(o.expectedAmount)}` : ''}. Earlier payments are shown as evidence.`,
          toEntries(obligationRows(o.id, since)),
          'No payment for this commitment has been seen in six months.',
        ),
      )
  const rank = { action: 0, watch: 1, info: 2 }
  findings.sort((a, b) => rank[a.severity] - rank[b.severity])
  const worth = findings.filter((f) => f.severity !== 'info').length
  return ledger.envelope(
    'Does anything look off?',
    worth
      ? `${worth} thing${worth === 1 ? '' : 's'} worth a look, out of ${findings.length} findings.`
      : findings.length
        ? `Nothing urgent. ${findings.length} informational finding${findings.length === 1 ? '' : 's'}.`
        : 'Nothing stands out.',
    {
      findings,
      coverage: brief.coverage,
      limits:
        'Brief shows at most five notices, so smaller ones can be crowded out. This cannot tell whether a subscription is actually used, or whether a recurring price is fair.',
    },
  )
}

export function transactionsForFigure(
  deps: HomeDeps,
  input: FigureQuery & { limit?: number; offset?: number },
) {
  const ledger = new Ledger(deps)
  assertMonth(input.month, ledger.today)
  assertCategory(ledger, input.category)
  if (input.through && input.through.slice(0, 7) !== input.month)
    throw new AnswerError('through must be a date within month')
  const { limit = 100, offset = 0, ...query } = input
  const entries = ledger
    .select(query)
    .sort(
      (a, b) =>
        b.tx.date.localeCompare(a.tx.date) || a.tx.id.localeCompare(b.tx.id),
    )
  const total = round(sumCounted(entries))
  return ledger.envelope(
    'Which transactions support this figure?',
    `${entries.length} transaction${entries.length === 1 ? '' : 's'} totalling ${formatMoney(total)} in ${input.month}.`,
    {
      query,
      total,
      transactions: entries.length,
      offset,
      hasMore: offset + limit < entries.length,
      evidence: ledger.rowsOf(entries.slice(offset, offset + limit)),
    },
  )
}

export function categoryNames(deps: HomeDeps): string[] {
  return [
    ...(
      deps.db.prepare('SELECT name FROM categories ORDER BY name').all() as {
        name: string
      }[]
    ).map((c) => c.name),
    UNCATEGORIZED,
  ]
}
