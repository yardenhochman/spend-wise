import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'

import {
  spendWiseConfig,
  type SubSegmentTagDefinition,
} from './lib/private-config.js'
import type { CountRow } from './types.js'

const dataDir =
  process.env.SPENDWISE_DATA_DIR ?? path.resolve(process.cwd(), 'data')
fs.mkdirSync(dataDir, { recursive: true })

const dbPath =
  process.env.SPENDWISE_DB_PATH ?? path.join(dataDir, 'spend-wise.sqlite')
const schemaPath =
  process.env.SPENDWISE_SCHEMA_PATH ??
  path.resolve(process.cwd(), '../docs/db/sqlite-schema.sql')

if (!fs.existsSync(schemaPath)) {
  throw new Error(`Schema file not found at ${schemaPath}`)
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

db.exec(fs.readFileSync(schemaPath, 'utf8'))

const nowIso = (): string => new Date().toISOString()
const toBool = (value: unknown): boolean => Boolean(value)

const DEFAULT_CATEGORIES = [
  'Groceries',
  'Dining',
  'Transport',
  'Housing',
  'Utilities',
  'Healthcare',
  'Insurance',
  'Education',
  'Entertainment',
  'Shopping',
  'Subscriptions',
  'Salary',
  'Transfer',
  'Cash Withdrawal',
  'Bank Fees',
  'Savings',
  'Other',
]

function seedCategories(): void {
  const existing = db
    .prepare('SELECT COUNT(*) as count FROM categories')
    .get() as CountRow
  if (existing.count > 0) return

  const insert = db.prepare(
    'INSERT INTO categories (id, name, parent_id) VALUES (?, ?, NULL)',
  )
  const insertMany = db.transaction((names: string[]) => {
    for (const name of names) {
      insert.run(randomUUID(), name)
    }
  })

  insertMany(DEFAULT_CATEGORIES)
  console.log(`[db] Seeded ${DEFAULT_CATEGORIES.length} default categories`)
}

function ensureAccount(
  bankName: string,
  accountLabel: string,
  currency: string = 'ILS',
): string {
  const existing = db
    .prepare(
      'SELECT id FROM accounts WHERE bank_name = ? AND account_label = ?',
    )
    .get(bankName, accountLabel) as { id: string } | undefined

  if (existing) return existing.id

  const id = randomUUID()
  db.prepare(
    'INSERT INTO accounts (id, bank_name, account_label, currency) VALUES (?, ?, ?, ?)',
  ).run(id, bankName, accountLabel, currency)

  console.log(`[db] Created account: ${bankName} - ${accountLabel}`)
  return id
}

// Ensure a category exists, return its ID
function ensureCategory(name: string): string {
  const existing = db
    .prepare('SELECT id FROM categories WHERE name = ?')
    .get(name) as { id: string } | undefined
  if (existing) return existing.id

  const id = randomUUID()
  db.prepare(
    'INSERT INTO categories (id, name, parent_id) VALUES (?, ?, NULL)',
  ).run(id, name)
  console.log(`[db] Created category: ${name}`)
  return id
}

// Get category ID by name (returns null if not found)
function getCategoryId(name: string): string | null {
  if (!name) return null
  const row = db
    .prepare('SELECT id FROM categories WHERE name = ?')
    .get(name) as { id: string } | undefined
  return row ? row.id : null
}

// ── Migrations ──────────────────────────────────────────────────────────────
try {
  db.exec(
    'ALTER TABLE transactions ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0',
  )
  console.log('[db] Added is_internal column')
} catch {
  // Column already exists — no-op
}

try {
  db.exec('ALTER TABLE categories ADD COLUMN spending_type TEXT')
  db.exec('ALTER TABLE categories ADD COLUMN category_group TEXT')
  console.log(
    '[db] Added spending_type and category_group columns to categories',
  )
} catch {
  // Columns already exist
}

try {
  db.exec(
    'ALTER TABLE transactions ADD COLUMN spread_months INTEGER DEFAULT NULL',
  )
  console.log('[db] Added spread_months column to transactions')
} catch {
  // Column already exists
}

// Seed categories on startup
seedCategories()

// Ensure Wedding category exists (added after initial seeding)
ensureCategory('Wedding')
ensureCategory('Mortgage')
ensureCategory('Sports & Fitness')
ensureCategory('Property Price')
ensureCategory('Purchase Tax')
ensureCategory('Closing Costs')
ensureCategory('Consulting')
ensureCategory('Home Loans')
ensureCategory('Venue & Catering')
ensureCategory('Music & Sound')
ensureCategory('Photography')
ensureCategory('Wedding Planning')
ensureCategory('Wedding Loan')
ensureCategory('Online Shopping')
ensureCategory('Home Setup')
ensureCategory('Pets')
ensureCategory('Home Maintenance')
ensureCategory('Workshops & Retreats')
ensureCategory('Taxes')

// ── Seed category metadata (spending_type and category_group) ────────────────
const CATEGORY_METADATA: Record<
  string,
  { spending_type: string; category_group: string }
> = {
  // NEEDS
  Housing: { spending_type: 'needs', category_group: 'Housing' },
  Mortgage: { spending_type: 'savings', category_group: 'Housing' },
  Utilities: { spending_type: 'needs', category_group: 'Utilities' },
  Insurance: { spending_type: 'needs', category_group: 'Insurance' },
  'Bank Fees': { spending_type: 'needs', category_group: 'Financial' },
  Healthcare: { spending_type: 'needs', category_group: 'Healthcare' },

  // WANTS
  Groceries: { spending_type: 'wants', category_group: 'Food & Drink' },
  Dining: { spending_type: 'wants', category_group: 'Food & Drink' },
  Transport: { spending_type: 'wants', category_group: 'Transport' },
  Shopping: { spending_type: 'wants', category_group: 'Shopping' },
  'Online Shopping': { spending_type: 'wants', category_group: 'Shopping' },
  Entertainment: { spending_type: 'wants', category_group: 'Lifestyle' },
  Subscriptions: { spending_type: 'wants', category_group: 'Lifestyle' },
  'Sports & Fitness': { spending_type: 'wants', category_group: 'Lifestyle' },
  Pets: { spending_type: 'wants', category_group: 'Lifestyle' },
  'Home Maintenance': { spending_type: 'needs', category_group: 'Housing' },
  'Workshops & Retreats': {
    spending_type: 'wants',
    category_group: 'Lifestyle',
  },
  Education: { spending_type: 'wants', category_group: 'Education' },
  'Home Setup': { spending_type: 'wants', category_group: 'Shopping' },
  'Trips Abroad': { spending_type: 'wants', category_group: 'Travel' },

  // SAVINGS
  Savings: { spending_type: 'savings', category_group: 'Financial' },

  // STRUCTURAL
  Salary: { spending_type: 'structural', category_group: 'Income' },
  Transfer: { spending_type: 'structural', category_group: 'Transfers' },
  'Cash Withdrawal': {
    spending_type: 'structural',
    category_group: 'Transfers',
  },
  Other: { spending_type: 'structural', category_group: 'Other' },

  // LIFECYCLE - Home (monthly mortgage/loan payments = building equity → savings)
  'Property Price': {
    spending_type: 'savings',
    category_group: 'Home Purchase',
  },
  'Purchase Tax': { spending_type: 'savings', category_group: 'Home Purchase' },
  'Closing Costs': {
    spending_type: 'savings',
    category_group: 'Home Purchase',
  },
  'Home Loans': { spending_type: 'savings', category_group: 'Home Purchase' },
  'Home Purchase': {
    spending_type: 'savings',
    category_group: 'Home Purchase',
  },

  // LIFECYCLE - Wedding
  Wedding: { spending_type: 'wants', category_group: 'Wedding' },
  'Venue & Catering': { spending_type: 'wants', category_group: 'Wedding' },
  'Music & Sound': { spending_type: 'wants', category_group: 'Wedding' },
  Photography: { spending_type: 'wants', category_group: 'Wedding' },
  'Wedding Planning': { spending_type: 'wants', category_group: 'Wedding' },
  'Wedding Loan': { spending_type: 'needs', category_group: 'Wedding' },
  Taxes: { spending_type: 'needs', category_group: 'Financial' },
}

function seedCategoryMetadata(): void {
  const update = db.prepare(
    'UPDATE categories SET spending_type = ?, category_group = ? WHERE name = ?',
  )
  const seed = db.transaction(() => {
    let updated = 0
    for (const [name, meta] of Object.entries(CATEGORY_METADATA)) {
      const r = update.run(meta.spending_type, meta.category_group, name)
      updated += r.changes
    }
    if (updated > 0) {
      console.log(
        `[db] Updated ${updated} categories with spending_type and category_group`,
      )
    }
  })
  seed()
}

seedCategoryMetadata()

// ── Flag internal transfers ─────────────────────────────────────────────────
// Patterns that represent internal/non-spending movements (CC payments, self-transfers, etc.)
const INTERNAL_PATTERNS = [
  // CC payments to bank
  'י)ל.מאסטרקרד (ש',
  // Self-transfers
  'העברה מהחשבון',
  'העברה עצמית',
  // Currency conversions
  'המרת קנ במטח',
  'המרת מט"ח',
  // Inter-bank
  'הבינלאומי כא-י',
  'רבית זכות',
  // Loan/CC ops
  'העמדת הלואה',
  'הלואה-תשלום 108',
  'הסדר חוב כאל',
  'לאומי בונוס',
]

const INTERNAL_LIKE_PATTERNS = [
  // Self-transfers (LIKE patterns with %)
  'העברה דיגי%',
  'העברה דיגיטל%',
  'הע. אינט%',
  'העברה מח.%',
  'העברה לח.%',
  'העברה לחשבון%',
  'הע.מטח%',
  // Inter-bank
  'מהבינלאומי%',
  'הבינ"ל ניוד%',
]

const PUBLIC_INTERNAL_EXACT_MERCHANTS = ['בנק מזרחי', 'בנק הפועלים']
const INTERNAL_EXACT_MERCHANTS = [
  ...PUBLIC_INTERNAL_EXACT_MERCHANTS,
  ...spendWiseConfig.internalTransfer.exactMerchants,
]

function flagInternalTransfers(): void {
  const transferCatId = getCategoryId('Transfer')
  if (!transferCatId) return

  // Build a single UPDATE with OR conditions for exact matches
  const exactConditions = INTERNAL_PATTERNS.map(() => 'merchant = ?').join(
    ' OR ',
  )
  const likeConditions = INTERNAL_LIKE_PATTERNS.map(
    () => 'merchant LIKE ?',
  ).join(' OR ')
  const exactMerchants = INTERNAL_EXACT_MERCHANTS.map(
    () => 'merchant = ?',
  ).join(' OR ')

  const allConditions = [exactConditions, likeConditions, exactMerchants]
    .filter(Boolean)
    .join(' OR ')
  const allParams: string[] = [
    ...INTERNAL_PATTERNS,
    ...INTERNAL_LIKE_PATTERNS,
    ...INTERNAL_EXACT_MERCHANTS,
  ]

  const result = db
    .prepare(
      `UPDATE transactions SET is_internal = 1
     WHERE category_id = ? AND (${allConditions})`,
    )
    .run(transferCatId, ...allParams)

  // Also re-categorize bank transfer fees to Bank Fees
  const bankFeesCatId = getCategoryId('Bank Fees')
  if (bankFeesCatId) {
    db.prepare(
      `UPDATE transactions SET category_id = ?
       WHERE merchant LIKE '%עמלת העברה לבנק אחר%' AND category_id = ?`,
    ).run(bankFeesCatId, transferCatId)
  }

  console.log(`[db] Flagged ${result.changes} transactions as internal`)
}

flagInternalTransfers()

// ── Merchant alias seeding ───────────────────────────────────────────────────
const MERCHANT_ALIASES: {
  raw_pattern: string
  canonical_name: string
  match_type: string
}[] = [
  // Scooters - BIRD variants
  {
    raw_pattern: 'BIRD RIDE',
    canonical_name: 'BIRD Scooter',
    match_type: 'contains',
  },
  {
    raw_pattern: 'BIRD RIDES',
    canonical_name: 'BIRD Scooter',
    match_type: 'contains',
  },
  {
    raw_pattern: 'Bird scooter',
    canonical_name: 'BIRD Scooter',
    match_type: 'contains',
  },
  {
    raw_pattern: 'BIRD scooter',
    canonical_name: 'BIRD Scooter',
    match_type: 'contains',
  },

  // Scooters - Dott variants
  {
    raw_pattern: 'DOTT SCOOTER RIDE',
    canonical_name: 'Dott Scooter',
    match_type: 'contains',
  },
  {
    raw_pattern: 'Dott scooter ride',
    canonical_name: 'Dott Scooter',
    match_type: 'contains',
  },
  {
    raw_pattern: 'Dott trip auth hold',
    canonical_name: 'Dott Scooter',
    match_type: 'contains',
  },

  // Scooters - TIER variants
  {
    raw_pattern: 'TIER_',
    canonical_name: 'TIER Scooter',
    match_type: 'contains',
  },
  {
    raw_pattern: 'TIER MOBILITY',
    canonical_name: 'TIER Scooter',
    match_type: 'contains',
  },
  {
    raw_pattern: 'Tier Mobility',
    canonical_name: 'TIER Scooter',
    match_type: 'contains',
  },

  // Scooters - WIND
  {
    raw_pattern: 'WIND.CO',
    canonical_name: 'WIND Scooter',
    match_type: 'contains',
  },
  {
    raw_pattern: 'Wind.co',
    canonical_name: 'WIND Scooter',
    match_type: 'contains',
  },

  // Online shopping
  {
    raw_pattern: 'ALIEXPRESS',
    canonical_name: 'AliExpress',
    match_type: 'contains',
  },
  {
    raw_pattern: 'aliexpress',
    canonical_name: 'AliExpress',
    match_type: 'contains',
  },

  // Streaming
  {
    raw_pattern: 'Google YouTubePremium',
    canonical_name: 'YouTube Premium',
    match_type: 'contains',
  },
  {
    raw_pattern: 'GOOGLE YOUTUBEPREMIUM',
    canonical_name: 'YouTube Premium',
    match_type: 'contains',
  },
  {
    raw_pattern: 'SpotifyIL',
    canonical_name: 'Spotify',
    match_type: 'contains',
  },
  {
    raw_pattern: 'SPOTIFYIL',
    canonical_name: 'Spotify',
    match_type: 'contains',
  },

  // Transit
  {
    raw_pattern: 'מ.תחבורה - רב-פס',
    canonical_name: 'Rav-Kav',
    match_type: 'contains',
  },
  {
    raw_pattern: 'מ.תחבורה ? רב-פס',
    canonical_name: 'Rav-Kav',
    match_type: 'contains',
  },

  // News
  {
    raw_pattern: 'גלובס און ליין',
    canonical_name: 'Globes Online',
    match_type: 'contains',
  },
  {
    raw_pattern: 'גלובס - און ליין',
    canonical_name: 'Globes Online',
    match_type: 'contains',
  },

  // BIT payment variants
  {
    raw_pattern: 'BIT ביט',
    canonical_name: 'BIT Transfer',
    match_type: 'contains',
  },
  {
    raw_pattern: 'העברת ביט',
    canonical_name: 'BIT Transfer',
    match_type: 'contains',
  },
  {
    raw_pattern: 'ביט BIT',
    canonical_name: 'BIT Transfer',
    match_type: 'contains',
  },

  // Paybox
  { raw_pattern: 'פייבוקס', canonical_name: 'Paybox', match_type: 'contains' },
  { raw_pattern: 'PAYBOX', canonical_name: 'Paybox', match_type: 'contains' },
]

function seedMerchantAliases(): void {
  // Ensure table exists (schema.sql handles this, but be safe)
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_aliases (
    id TEXT PRIMARY KEY,
    raw_pattern TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'contains'
  )`)
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_aliases_pattern ON merchant_aliases(raw_pattern)',
  )

  const existing = new Set(
    (
      db.prepare('SELECT raw_pattern FROM merchant_aliases').all() as {
        raw_pattern: string
      }[]
    ).map((r) => r.raw_pattern),
  )

  const insert = db.prepare(
    'INSERT INTO merchant_aliases (id, raw_pattern, canonical_name, match_type) VALUES (?, ?, ?, ?)',
  )

  let inserted = 0
  const seed = db.transaction(() => {
    for (const alias of MERCHANT_ALIASES) {
      if (!existing.has(alias.raw_pattern)) {
        insert.run(
          randomUUID(),
          alias.raw_pattern,
          alias.canonical_name,
          alias.match_type,
        )
        inserted++
      }
    }
  })
  seed()

  if (inserted > 0) {
    console.log(`[db] Seeded ${inserted} merchant aliases`)
  }
}

seedMerchantAliases()

// ── Transaction links table ──────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS transaction_links (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  linked_transaction_id TEXT NOT NULL REFERENCES transactions(id),
  link_type TEXT NOT NULL DEFAULT 'reimbursement',
  created_at TEXT NOT NULL,
  UNIQUE(transaction_id, linked_transaction_id)
)`)
db.exec(
  'CREATE INDEX IF NOT EXISTS idx_transaction_links_tx ON transaction_links(transaction_id)',
)
db.exec(
  'CREATE INDEX IF NOT EXISTS idx_transaction_links_linked ON transaction_links(linked_transaction_id)',
)

// ── Sub-segment tags + tag_rules table ──────────────────────────────────────
const PUBLIC_SUB_SEGMENT_TAGS: SubSegmentTagDefinition[] = [
  // Groceries sub-segments
  {
    tag_name: 'shuk',
    color: '#22c55e',
    icon: 'store',
    rules: [
      { pattern: 'פירות', match_type: 'contains', category_name: 'Groceries' },
      { pattern: 'ירקות', match_type: 'contains', category_name: 'Groceries' },
    ],
  },
  {
    tag_name: 'supermarket',
    color: '#3b82f6',
    icon: 'shopping-cart',
    rules: [
      { pattern: 'שופרסל', match_type: 'contains', category_name: 'Groceries' },
      {
        pattern: 'רמי לוי',
        match_type: 'contains',
        category_name: 'Groceries',
      },
      {
        pattern: 'יוחננוף',
        match_type: 'contains',
        category_name: 'Groceries',
      },
      { pattern: 'מגא', match_type: 'contains', category_name: 'Groceries' },
      {
        pattern: 'ויקטורי',
        match_type: 'contains',
        category_name: 'Groceries',
      },
      { pattern: 'AM:PM', match_type: 'contains', category_name: 'Groceries' },
      {
        pattern: 'אי אם פי אם',
        match_type: 'contains',
        category_name: 'Groceries',
      },
      {
        pattern: 'אי.אם.פי.אם',
        match_type: 'contains',
        category_name: 'Groceries',
      },
      {
        pattern: 'קוויק סופר',
        match_type: 'contains',
        category_name: 'Groceries',
      },
      { pattern: 'QUIK', match_type: 'contains', category_name: 'Groceries' },
    ],
  },
  {
    tag_name: 'convenience',
    color: '#a855f7',
    icon: 'package',
    rules: [
      { pattern: 'דיילי', match_type: 'contains', category_name: 'Groceries' },
      { pattern: 'DAILY', match_type: 'contains', category_name: 'Groceries' },
      { pattern: 'Daily', match_type: 'contains', category_name: 'Groceries' },
      { pattern: 'yellow', match_type: 'contains', category_name: 'Groceries' },
      { pattern: 'מכולת', match_type: 'contains', category_name: 'Groceries' },
    ],
  },
  {
    tag_name: 'specialty',
    color: '#f59e0b',
    icon: 'chef-hat',
    rules: [
      { pattern: 'דגים', match_type: 'contains', category_name: 'Groceries' },
      { pattern: 'קצב', match_type: 'contains', category_name: 'Groceries' },
      { pattern: 'גבינ', match_type: 'contains', category_name: 'Groceries' },
      { pattern: 'עוף', match_type: 'contains', category_name: 'Groceries' },
      { pattern: 'אטליז', match_type: 'contains', category_name: 'Groceries' },
    ],
  },

  // Dining sub-segments
  {
    tag_name: 'delivery',
    color: '#ef4444',
    icon: 'bike',
    rules: [
      { pattern: 'wolt', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'WOLT', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'תן ביס', match_type: 'contains', category_name: 'Dining' },
    ],
  },
  {
    tag_name: 'bakery',
    color: '#f97316',
    icon: 'croissant',
    rules: [
      { pattern: 'מאפי', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'בורקס', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'לחם', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'פיצה', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'קונדטוריי', match_type: 'contains', category_name: 'Dining' },
    ],
  },
  {
    tag_name: 'bar',
    color: '#8b5cf6',
    icon: 'wine',
    rules: [
      { pattern: 'בר ', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'משקאות', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'vintage', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'וינטאג', match_type: 'contains', category_name: 'Dining' },
    ],
  },
  {
    tag_name: 'cafe',
    color: '#06b6d4',
    icon: 'coffee',
    rules: [
      { pattern: 'קפה', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'cafe', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'coffee', match_type: 'contains', category_name: 'Dining' },
    ],
  },

  // Transport sub-segments
  {
    tag_name: 'scooter',
    color: '#10b981',
    icon: 'zap',
    rules: [
      { pattern: 'BIRD', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'bird', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'Dott', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'DOTT', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'TIER', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'WIND', match_type: 'contains', category_name: 'Transport' },
      {
        pattern: 'wind.co',
        match_type: 'contains',
        category_name: 'Transport',
      },
      { pattern: 'LIM', match_type: 'contains', category_name: 'Transport' },
    ],
  },
  {
    tag_name: 'car-share',
    color: '#6366f1',
    icon: 'car',
    rules: [
      {
        pattern: 'אוטו-תל',
        match_type: 'contains',
        category_name: 'Transport',
      },
      {
        pattern: 'autotel',
        match_type: 'contains',
        category_name: 'Transport',
      },
    ],
  },
  {
    tag_name: 'taxi',
    color: '#eab308',
    icon: 'navigation',
    rules: [
      { pattern: 'gett', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'GETT', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'מונית', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'yango', match_type: 'contains', category_name: 'Transport' },
    ],
  },
  {
    tag_name: 'public-transit',
    color: '#14b8a6',
    icon: 'train-front',
    rules: [
      { pattern: 'רב-פס', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'רב-קו', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'תחבורה', match_type: 'contains', category_name: 'Transport' },
    ],
  },

  // Gaming
  {
    tag_name: 'gaming',
    color: '#7c3aed',
    icon: 'gamepad-2',
    rules: [
      {
        pattern: 'STEAM',
        match_type: 'contains',
        category_name: 'Entertainment',
      },
      {
        pattern: 'Steam',
        match_type: 'contains',
        category_name: 'Entertainment',
      },
    ],
  },

  // Parking
  {
    tag_name: 'parking',
    color: '#64748b',
    icon: 'circle-parking',
    rules: [
      { pattern: 'חנייה', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'פנגו', match_type: 'contains', category_name: 'Transport' },
      { pattern: 'Pango', match_type: 'contains', category_name: 'Transport' },
    ],
  },

  // Car / driving fines
  {
    tag_name: 'car',
    color: '#475569',
    icon: 'car',
    rules: [
      {
        pattern: 'בררת משפט',
        match_type: 'contains',
        category_name: 'Transport',
      },
    ],
  },

  // Clothing
  {
    tag_name: 'clothing',
    color: '#e879f9',
    icon: 'shirt',
    rules: [
      { pattern: 'zara', match_type: 'contains', category_name: 'Shopping' },
      { pattern: 'ZARA', match_type: 'contains', category_name: 'Shopping' },
      { pattern: 'fox', match_type: 'contains', category_name: 'Shopping' },
      { pattern: 'FOX', match_type: 'contains', category_name: 'Shopping' },
      { pattern: 'H&M', match_type: 'contains', category_name: 'Shopping' },
      { pattern: 'castro', match_type: 'contains', category_name: 'Shopping' },
      { pattern: 'CASTRO', match_type: 'contains', category_name: 'Shopping' },
    ],
  },

  // Pharmacy
  {
    tag_name: 'pharmacy',
    color: '#22d3ee',
    icon: 'pill',
    rules: [
      {
        pattern: 'סופר פארם',
        match_type: 'contains',
        category_name: 'Healthcare',
      },
      {
        pattern: 'Super-Pharm',
        match_type: 'contains',
        category_name: 'Healthcare',
      },
      { pattern: 'פארם', match_type: 'contains', category_name: 'Healthcare' },
    ],
  },

  // Cafeteria (meal card / Cibus)
  {
    tag_name: 'cafeteria',
    color: '#64748b',
    icon: 'utensils-crossed',
    rules: [
      { pattern: 'סיבוס', match_type: 'contains', category_name: 'Dining' },
    ],
  },

  // Street food
  {
    tag_name: 'street-food',
    color: '#f97316',
    icon: 'flame',
    rules: [
      { pattern: 'שווארמה', match_type: 'contains', category_name: 'Dining' },
      { pattern: 'פלאפל', match_type: 'contains', category_name: 'Dining' },
    ],
  },

  // Restaurant
  {
    tag_name: 'restaurant',
    color: '#dc2626',
    icon: 'utensils',
    rules: [
      { pattern: 'מסעדת', match_type: 'contains', category_name: 'Dining' },
    ],
  },

  // Gym / fitness
  {
    tag_name: 'gym',
    color: '#8b5cf6',
    icon: 'dumbbell',
    rules: [
      {
        pattern: 'קאנטרי',
        match_type: 'contains',
        category_name: 'Sports & Fitness',
      },
      {
        pattern: 'יוגה',
        match_type: 'contains',
        category_name: 'Sports & Fitness',
      },
    ],
  },

  // Context tags (no category restriction)
  { tag_name: 'tax-deductible', color: '#64748b', icon: 'receipt', rules: [] },
  {
    tag_name: 'reimbursable',
    color: '#84cc16',
    icon: 'arrow-left-right',
    rules: [],
  },
  { tag_name: 'one-time', color: '#f43f5e', icon: 'sparkles', rules: [] },
]

const SUB_SEGMENT_TAGS: SubSegmentTagDefinition[] = [
  ...PUBLIC_SUB_SEGMENT_TAGS,
  ...spendWiseConfig.subSegmentTags,
]

function seedSubSegmentTags(): void {
  // Create tag_rules table
  db.exec(`CREATE TABLE IF NOT EXISTS tag_rules (
    id TEXT PRIMARY KEY,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    match_type TEXT NOT NULL DEFAULT 'contains',
    pattern TEXT NOT NULL,
    category_name TEXT,
    created_at TEXT NOT NULL
  )`)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_tag_rules_tag_id ON tag_rules(tag_id)',
  )

  // Add icon column if missing
  const hasIcon = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('tags') WHERE name = 'icon'",
    )
    .get() as { cnt: number }
  if (hasIcon.cnt === 0) {
    db.exec('ALTER TABLE tags ADD COLUMN icon TEXT')
    console.log('[db] Added icon column to tags table')
  }

  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?')
  const insertTag = db.prepare(
    'INSERT INTO tags (id, name, color, icon) VALUES (?, ?, ?, ?)',
  )
  const updateTagIcon = db.prepare(
    'UPDATE tags SET icon = ? WHERE id = ? AND (icon IS NULL OR icon != ?)',
  )
  const getRule = db.prepare(
    'SELECT id FROM tag_rules WHERE tag_id = ? AND pattern = ?',
  )
  const insertRule = db.prepare(
    'INSERT INTO tag_rules (id, tag_id, match_type, pattern, category_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )

  let tagsCreated = 0
  let rulesCreated = 0

  const seed = db.transaction(() => {
    for (const def of SUB_SEGMENT_TAGS) {
      // Ensure tag exists
      let tagRow = getTag.get(def.tag_name) as { id: string } | undefined
      if (!tagRow) {
        const tagId = randomUUID()
        insertTag.run(tagId, def.tag_name, def.color, def.icon || null)
        tagRow = { id: tagId }
        tagsCreated++
      } else if (def.icon) {
        updateTagIcon.run(def.icon, tagRow.id, def.icon)
      }

      // Ensure rules exist
      for (const rule of def.rules) {
        const existing = getRule.get(tagRow.id, rule.pattern)
        if (!existing) {
          insertRule.run(
            randomUUID(),
            tagRow.id,
            rule.match_type,
            rule.pattern,
            rule.category_name || null,
            new Date().toISOString(),
          )
          rulesCreated++
        }
      }
    }
  })
  seed()

  if (tagsCreated > 0 || rulesCreated > 0) {
    console.log(
      `[db] Seeded ${tagsCreated} sub-segment tags, ${rulesCreated} tag rules`,
    )
  }
}

seedSubSegmentTags()

// ── Bulk-apply tag rules to existing transactions ────────────────────────────
function applyTagRules(): void {
  const rules = db
    .prepare(`
    SELECT tr.tag_id, tr.pattern, tr.category_name
    FROM tag_rules tr
  `)
    .all() as {
    tag_id: string
    pattern: string
    category_name: string | null
  }[]

  let totalApplied = 0

  const apply = db.transaction(() => {
    for (const rule of rules) {
      let sql: string
      let params: (string | null)[]

      if (rule.category_name) {
        sql = `
          INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
          SELECT t.id, ?
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id
          WHERE INSTR(LOWER(t.merchant), LOWER(?)) > 0
            AND c.name = ?
            AND t.is_internal = 0
        `
        params = [rule.tag_id, rule.pattern, rule.category_name]
      } else {
        sql = `
          INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
          SELECT t.id, ?
          FROM transactions t
          WHERE INSTR(LOWER(t.merchant), LOWER(?)) > 0
            AND t.is_internal = 0
        `
        params = [rule.tag_id, rule.pattern]
      }

      const result = db.prepare(sql).run(...params)
      totalApplied += result.changes
    }
  })

  apply()

  if (totalApplied > 0) {
    console.log(
      `[db] Auto-applied ${totalApplied} tag assignments from ${rules.length} rules`,
    )
  }
}

applyTagRules()

// ── Recurring transaction detection ──────────────────────────────────────────
function detectRecurringTransactions(): void {
  console.log('[db] Detecting recurring transactions...')

  // Reset all recurring flags
  db.prepare('UPDATE transactions SET is_recurring_candidate = 0').run()

  // Detect recurring separately for expenses (amount < 0) and income (amount > 0).
  // Merchants like הוראת קבע have both +2000 and -3106 entries — grouping by sign
  // prevents mixed amounts from inflating CV.
  // Income gets a relaxed CV threshold (0.35) since salaries vary more than subscriptions.
  // SQLite doesn't have STDEV, so we compute CV manually:
  // CV = sqrt(avg(x^2) - avg(x)^2) / abs(avg(x))
  const signs = [
    { filter: 'amount < 0', cvThreshold: 0.15, label: 'expense' },
    { filter: 'amount > 0', cvThreshold: 0.35, label: 'income' },
  ]

  let totalFlagged = 0
  let totalMerchants = 0

  for (const { filter, cvThreshold, label } of signs) {
    const rows = db
      .prepare(`
      SELECT merchant, COUNT(DISTINCT substr(date, 1, 7)) AS month_count,
             AVG(amount) AS avg_amount,
             COUNT(*) AS tx_count,
             AVG(amount * amount) AS avg_sq,
             AVG(amount) * AVG(amount) AS sq_avg
      FROM transactions
      WHERE is_internal = 0 AND ${filter}
      GROUP BY merchant
      HAVING month_count >= 3
    `)
      .all() as {
      merchant: string
      month_count: number
      avg_amount: number
      tx_count: number
      avg_sq: number
      sq_avg: number
    }[]

    const merchants: string[] = []
    for (const row of rows) {
      const variance = row.avg_sq - row.sq_avg
      const stdev = Math.sqrt(Math.max(0, variance))
      const cv =
        Math.abs(row.avg_amount) > 0
          ? stdev / Math.abs(row.avg_amount)
          : Infinity
      if (cv <= cvThreshold) {
        merchants.push(row.merchant)
      }
    }

    if (merchants.length > 0) {
      const placeholders = merchants.map(() => '?').join(',')
      const result = db
        .prepare(
          `UPDATE transactions SET is_recurring_candidate = 1
           WHERE merchant IN (${placeholders}) AND ${filter}`,
        )
        .run(...merchants)
      console.log(
        `[db] Flagged ${result.changes} ${label} transactions from ${merchants.length} merchants`,
      )
      totalFlagged += result.changes
      totalMerchants += merchants.length
    }
  }

  if (totalMerchants === 0) {
    console.log('[db] No recurring merchants detected')
  } else {
    console.log(
      `[db] Total: ${totalFlagged} recurring transactions from ${totalMerchants} merchants`,
    )
  }
}

detectRecurringTransactions()

// ── Cash allocations table ───────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS cash_allocations (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  frequency TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  start_date TEXT,
  end_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`)

export {
  db,
  nowIso,
  toBool,
  dataDir,
  dbPath,
  schemaPath,
  ensureAccount,
  ensureCategory,
  getCategoryId,
}
