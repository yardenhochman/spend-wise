// ── Drizzle ORM schema for SpendWise SQLite database ─────────────────────────
import {
  sqliteTable,
  text,
  real,
  integer,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core'

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  bank_name: text('bank_name').notNull(),
  account_label: text('account_label').notNull(),
  currency: text('currency').notNull(),
})

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parent_id: text('parent_id').references((): any => categories.id, {
    onDelete: 'set null',
  }),
  spending_type: text('spending_type'),
  category_group: text('category_group'),
})

export const statementFiles = sqliteTable('statement_files', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  type: text('type').notNull(),
  imported_at: text('imported_at').notNull(),
  parser_id: text('parser_id').notNull(),
  status: text('status').notNull(),
})

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    merchant: text('merchant').notNull(),
    amount: real('amount').notNull(),
    currency: text('currency').notNull(),
    account_id: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    category_id: text('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    confidence: real('confidence').notNull().default(0),
    is_recurring_candidate: integer('is_recurring_candidate')
      .notNull()
      .default(0),
    is_internal: integer('is_internal').notNull().default(0),
    notes: text('notes'),
    source_file_id: text('source_file_id')
      .notNull()
      .references(() => statementFiles.id, { onDelete: 'cascade' }),
    raw_hash: text('raw_hash').notNull(),
    spread_months: integer('spread_months'),
  },
  (table) => [
    uniqueIndex('idx_transactions_raw_hash').on(table.raw_hash),
    index('idx_transactions_date').on(table.date),
    index('idx_transactions_merchant').on(table.merchant),
    index('idx_transactions_category_id').on(table.category_id),
    index('idx_transactions_account_id').on(table.account_id),
  ],
)

export const investmentReports = sqliteTable(
  'investment_reports',
  {
    id: text('id').primaryKey(),
    statement_file_id: text('statement_file_id')
      .notNull()
      .references(() => statementFiles.id, { onDelete: 'cascade' }),
    account_number: text('account_number').notNull(),
    account_name: text('account_name'),
    base_currency: text('base_currency').notNull(),
    from_date: text('from_date'),
    to_date: text('to_date'),
    report_date: text('report_date').notNull(),
    period: text('period'),
    portfolio_value_base: real('portfolio_value_base').notNull().default(0),
    unrealized_pnl_base: real('unrealized_pnl_base').notNull().default(0),
    imported_at: text('imported_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_investment_reports_account_report_date').on(
      table.account_number,
      table.report_date,
    ),
    index('idx_investment_reports_report_date').on(table.report_date),
  ],
)

export const investmentPositions = sqliteTable(
  'investment_positions',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => investmentReports.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    description: text('description').notNull(),
    asset_category: text('asset_category'),
    sub_category: text('sub_category'),
    listing_exchange: text('listing_exchange'),
    currency: text('currency').notNull(),
    fx_rate_to_base: real('fx_rate_to_base').notNull().default(1),
    quantity: real('quantity').notNull(),
    market_price: real('market_price').notNull().default(0),
    market_value: real('market_value').notNull().default(0),
    market_value_base: real('market_value_base').notNull().default(0),
    cost_basis: real('cost_basis').notNull().default(0),
    cost_basis_base: real('cost_basis_base').notNull().default(0),
    avg_open_price: real('avg_open_price').notNull().default(0),
    unrealized_pnl: real('unrealized_pnl').notNull().default(0),
    unrealized_pnl_base: real('unrealized_pnl_base').notNull().default(0),
    portfolio_weight: real('portfolio_weight').notNull().default(0),
    side: text('side'),
    isin: text('isin'),
  },
  (table) => [
    index('idx_investment_positions_report_id').on(table.report_id),
    index('idx_investment_positions_symbol').on(table.symbol),
  ],
)

export const rules = sqliteTable(
  'rules',
  {
    id: text('id').primaryKey(),
    match_type: text('match_type').notNull(),
    pattern: text('pattern').notNull(),
    category_id: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    priority: integer('priority').notNull().default(0),
    enabled: integer('enabled').notNull().default(1),
    created_at: text('created_at').notNull(),
  },
  (table) => [index('idx_rules_priority').on(table.priority)],
)

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),
  icon: text('icon'),
})

export const transactionTags = sqliteTable(
  'transaction_tags',
  {
    transaction_id: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    tag_id: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.transaction_id, table.tag_id] })],
)

export const merchantAliases = sqliteTable(
  'merchant_aliases',
  {
    id: text('id').primaryKey(),
    raw_pattern: text('raw_pattern').notNull(),
    canonical_name: text('canonical_name').notNull(),
    source: text('source').notNull().default('seed'),
    match_type: text('match_type').notNull().default('contains'),
  },
  (table) => [
    uniqueIndex('idx_merchant_aliases_pattern').on(
      table.raw_pattern,
      table.source,
    ),
  ],
)

export const cashAllocations = sqliteTable('cash_allocations', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
  amount: real('amount').notNull(),
  frequency: text('frequency').notNull(),
  category_id: text('category_id').references(() => categories.id),
  start_date: text('start_date'),
  end_date: text('end_date'),
  created_at: text('created_at'),
})

export const tagRules = sqliteTable(
  'tag_rules',
  {
    id: text('id').primaryKey(),
    tag_id: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    match_type: text('match_type').notNull().default('contains'),
    pattern: text('pattern').notNull(),
    category_name: text('category_name'),
    created_at: text('created_at').notNull(),
  },
  (table) => [index('idx_tag_rules_tag_id').on(table.tag_id)],
)
