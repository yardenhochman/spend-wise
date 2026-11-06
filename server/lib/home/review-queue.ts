import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

import { sameMerchant } from '../import-duplicates.js'
import { merchantKey } from '../merchant-labels.js'
import { isGenericTransfer, transferPayee } from '../payees.js'
import { uncategorizedCoverage } from './brief.js'
import { round } from './dates.js'
import { isolateName, transactionLabel } from './labels.js'
import type { HomeTransaction } from './types.js'

const CONFIDENT_SHARE = 0.7
const MIN_TAG_PATTERN = 4
const EXAMPLES = 3

type Category = { id: string; name: string }
type Rule = {
  id: string
  match_type: string
  pattern: string
  category_id: string
  enabled: number
}
type TagRule = { pattern: string; category_name: string | null }

export type ReviewItem = {
  key: string
  name: string
  bankNames: string[]
  count: number
  total: number
  olderCount: number
  examples: { id: string; date: string; amount: number; label: string }[]
  suggestion: {
    categoryId: string
    categoryName: string
    reason: string
  } | null
  setsRule: boolean
}

export type ReviewApplied = {
  key: string
  categoryId: string
  transactionIds: string[]
  createdRuleIds: string[]
  changedRules: { id: string; categoryId: string; enabled: number }[]
}

/** The same description pays different people, so one answer cannot cover them all. */
function paysPeople(merchant: string): boolean {
  return (
    isGenericTransfer(merchant) ||
    /\bbit\b|(^|\s)ביט(\s|$)|paybox|פייבוקס/i.test(merchant)
  )
}

function groupKey(t: HomeTransaction): string {
  const payee = paysPeople(t.merchant) ? transferPayee(t.notes) : null
  return payee
    ? `${merchantKey(t.merchant)}|${merchantKey(payee)}`
    : merchantKey(t.merchant)
}

function ruleMatches(rule: Rule, merchant: string): boolean {
  const name = merchant.toLowerCase()
  const pattern = rule.pattern.toLowerCase()
  if (rule.match_type === 'contains') return name.includes(pattern)
  if (rule.match_type === 'exact') return name === pattern
  if (rule.match_type !== 'regex') return false
  try {
    return new RegExp(rule.pattern, 'i').test(merchant)
  } catch {
    return false
  }
}

function charges(n: number): string {
  return n === 1 ? '1 earlier charge' : `${n} earlier charges`
}

function majority(rows: HomeTransaction[]) {
  const byCategory = new Map<string, number>()
  for (const t of rows)
    if (t.category_name)
      byCategory.set(
        t.category_name,
        (byCategory.get(t.category_name) ?? 0) + 1,
      )
  const total = [...byCategory.values()].reduce((a, b) => a + b, 0)
  const [top] = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
  return top && top[1] / total >= CONFIDENT_SHARE
    ? { name: top[0], count: top[1], total }
    : null
}

function suggest(
  key: string,
  rawNames: string[],
  setsRule: boolean,
  rows: HomeTransaction[],
  rules: Rule[],
  tagRules: TagRule[],
  categories: Category[],
): ReviewItem['suggestion'] {
  const byId = new Map(categories.map((c) => [c.id, c.name]))
  const idOf = (name: string) => categories.find((c) => c.name === name)?.id
  const known = rows.filter((t) => t.category_name)
  if (setsRule) {
    const rule = rules.find((r) =>
      rawNames.some((name) => ruleMatches(r, name)),
    )
    const name = rule && byId.get(rule.category_id)
    if (rule && name)
      return {
        categoryId: rule.category_id,
        categoryName: name,
        reason: `Your rule for ${isolateName(rule.pattern)} files this under ${name}.`,
      }
  }
  const own = majority(known.filter((t) => groupKey(t) === key))
  if (own && idOf(own.name))
    return {
      categoryId: idOf(own.name)!,
      categoryName: own.name,
      reason:
        own.count === own.total
          ? `You filed ${charges(own.total)} here as ${own.name}.`
          : `You filed ${own.count} of ${own.total} earlier charges here as ${own.name}.`,
    }
  if (!setsRule) return null
  const similar = known.filter(
    (t) =>
      !paysPeople(t.merchant) &&
      rawNames.some((name) => sameMerchant(name, t.merchant)),
  )
  const near = majority(similar)
  if (near && idOf(near.name)) {
    const example = similar.find((t) => t.category_name === near.name)!
    return {
      categoryId: idOf(near.name)!,
      categoryName: near.name,
      reason: `You filed ${isolateName(transactionLabel(example))}, a similar name, as ${near.name}.`,
    }
  }
  const tag = tagRules.find(
    (r) =>
      r.category_name &&
      r.pattern.trim().length >= MIN_TAG_PATTERN &&
      rawNames.some((name) =>
        name.toLowerCase().includes(r.pattern.toLowerCase()),
      ),
  )
  if (tag?.category_name && idOf(tag.category_name))
    return {
      categoryId: idOf(tag.category_name)!,
      categoryName: tag.category_name,
      reason: `Names containing ${isolateName(tag.pattern.trim())} usually go in ${tag.category_name}.`,
    }
  return null
}

function readRules(db: Database.Database): Rule[] {
  return db
    .prepare('SELECT * FROM rules WHERE enabled=1 ORDER BY priority DESC')
    .all() as Rule[]
}

/** Uncategorized household spending by merchant, largest first. Reads only. */
export function buildReviewQueue(
  db: Database.Database,
  rows: HomeTransaction[],
  today: string,
) {
  const coverage = uncategorizedCoverage(rows, today)
  const categoryRows = db
    .prepare('SELECT id,name FROM categories')
    .all() as Category[]
  const usage = new Map<string, number>()
  for (const t of rows)
    if (t.category_name && t.date >= coverage.start)
      usage.set(t.category_name, (usage.get(t.category_name) ?? 0) + 1)
  const categories = [...categoryRows].sort(
    (a, b) =>
      (usage.get(b.name) ?? 0) - (usage.get(a.name) ?? 0) ||
      a.name.localeCompare(b.name),
  )
  const rules = readRules(db)
  const tagRules = db
    .prepare(
      'SELECT pattern,category_name FROM tag_rules WHERE category_name IS NOT NULL',
    )
    .all() as TagRule[]
  const groups = new Map<string, HomeTransaction[]>()
  for (const t of rows) {
    if (t.category_name || t.amount >= 0) continue
    const key = groupKey(t)
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const items: ReviewItem[] = []
  for (const [key, all] of groups) {
    const inWindow = all.filter((t) => t.date >= coverage.start)
    if (!inWindow.length) continue
    const newest = [...inWindow].sort((a, b) => b.date.localeCompare(a.date))
    const bankNames = [...new Set(all.map((t) => t.merchant))]
    const setsRule = !paysPeople(all[0].merchant)
    const payee = setsRule ? null : transferPayee(all[0].notes)
    items.push({
      key,
      name: payee ?? transactionLabel(newest[0]),
      bankNames,
      count: inWindow.length,
      total: round(inWindow.reduce((sum, t) => sum - t.amount, 0)),
      olderCount: all.length - inWindow.length,
      examples: newest.slice(0, EXAMPLES).map((t) => ({
        id: t.id,
        date: t.date,
        amount: t.amount,
        label: transactionLabel(t),
      })),
      suggestion: suggest(
        key,
        bankNames,
        setsRule,
        rows,
        rules,
        tagRules,
        categories,
      ),
      setsRule,
    })
  }
  items.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
  return {
    uncategorizedShare: round(coverage.uncategorizedShare),
    categories,
    items,
  }
}

/** One answer, in one transaction: the merchant's charges plus a rule for later imports. */
export function applyReviewAnswer(
  db: Database.Database,
  rows: HomeTransaction[],
  key: string,
  categoryId: string,
  now: string,
): ReviewApplied | null {
  const targets = rows.filter(
    (t) =>
      !t.category_name &&
      groupKey(t) === key &&
      (t.amount < 0 || !paysPeople(t.merchant)),
  )
  if (!targets.some((t) => t.amount < 0)) return null
  const setsRule = !paysPeople(targets[0].merchant)
  const applied: ReviewApplied = {
    key,
    categoryId,
    transactionIds: targets.map((t) => t.id),
    createdRuleIds: [],
    changedRules: [],
  }
  db.transaction(() => {
    const update = db.prepare(
      'UPDATE transactions SET category_id=?, confidence=1 WHERE id=? AND category_id IS NULL',
    )
    for (const t of targets) update.run(categoryId, t.id)
    if (!setsRule) return
    const existing = db.prepare(
      "SELECT * FROM rules WHERE match_type='exact' AND LOWER(pattern)=LOWER(?)",
    )
    for (const merchant of new Set(targets.map((t) => t.merchant))) {
      const rule = existing.get(merchant) as Rule | undefined
      if (rule) {
        applied.changedRules.push({
          id: rule.id,
          categoryId: rule.category_id,
          enabled: rule.enabled,
        })
        db.prepare('UPDATE rules SET category_id=?, enabled=1 WHERE id=?').run(
          categoryId,
          rule.id,
        )
        continue
      }
      const id = randomUUID()
      // Above the generic contains rules, as other merchant rules are.
      const priority = Math.max(
        2,
        targets.filter((t) => t.merchant === merchant).length,
      )
      db.prepare(
        "INSERT INTO rules (id,match_type,pattern,category_id,priority,enabled,created_at) VALUES (?,'exact',?,?,?,1,?)",
      ).run(id, merchant, categoryId, priority, now)
      applied.createdRuleIds.push(id)
    }
  })()
  return applied
}

/** Charges recategorized since the answer keep their newer category. */
export function undoReviewAnswer(
  db: Database.Database,
  applied: ReviewApplied,
): void {
  db.transaction(() => {
    const clear = db.prepare(
      'UPDATE transactions SET category_id=NULL, confidence=0 WHERE id=? AND category_id=?',
    )
    for (const id of applied.transactionIds) clear.run(id, applied.categoryId)
    const drop = db.prepare('DELETE FROM rules WHERE id=?')
    for (const id of applied.createdRuleIds) drop.run(id)
    const restore = db.prepare(
      'UPDATE rules SET category_id=?, enabled=? WHERE id=?',
    )
    for (const rule of applied.changedRules)
      restore.run(rule.categoryId, rule.enabled, rule.id)
  })()
}
