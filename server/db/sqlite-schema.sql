-- SQLite schema (MVP). IDs are UUID strings.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  bank_name TEXT NOT NULL,
  account_label TEXT NOT NULL,
  currency TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  spending_type TEXT,  -- 'needs', 'wants', 'savings', 'structural'
  category_group TEXT, -- e.g., 'Housing', 'Food & Drink', 'Transport', etc.
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS statement_files (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  type TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  parser_id TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  merchant TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  account_id TEXT NOT NULL,
  category_id TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  is_recurring_candidate INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  source_file_id TEXT NOT NULL,
  raw_hash TEXT NOT NULL,
  spread_months INTEGER DEFAULT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (source_file_id) REFERENCES statement_files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  match_type TEXT NOT NULL,
  pattern TEXT NOT NULL,
  category_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (transaction_id, tag_id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS investment_reports (
  id TEXT PRIMARY KEY,
  statement_file_id TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT,
  base_currency TEXT NOT NULL,
  from_date TEXT,
  to_date TEXT,
  report_date TEXT NOT NULL,
  period TEXT,
  portfolio_value_base REAL NOT NULL DEFAULT 0,
  unrealized_pnl_base REAL NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL,
  FOREIGN KEY (statement_file_id) REFERENCES statement_files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS investment_positions (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  description TEXT NOT NULL,
  asset_category TEXT,
  sub_category TEXT,
  listing_exchange TEXT,
  currency TEXT NOT NULL,
  fx_rate_to_base REAL NOT NULL DEFAULT 1,
  quantity REAL NOT NULL,
  market_price REAL NOT NULL DEFAULT 0,
  market_value REAL NOT NULL DEFAULT 0,
  market_value_base REAL NOT NULL DEFAULT 0,
  cost_basis REAL NOT NULL DEFAULT 0,
  cost_basis_base REAL NOT NULL DEFAULT 0,
  avg_open_price REAL NOT NULL DEFAULT 0,
  unrealized_pnl REAL NOT NULL DEFAULT 0,
  unrealized_pnl_base REAL NOT NULL DEFAULT 0,
  portfolio_weight REAL NOT NULL DEFAULT 0,
  side TEXT,
  isin TEXT,
  FOREIGN KEY (report_id) REFERENCES investment_reports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS merchant_aliases (
  id TEXT PRIMARY KEY,
  raw_pattern TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'contains'  -- 'exact', 'contains', 'regex'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_aliases_pattern ON merchant_aliases(raw_pattern);

CREATE TABLE IF NOT EXISTS tag_rules (
  id TEXT PRIMARY KEY,
  tag_id TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'contains',  -- 'contains', 'exact', 'regex'
  pattern TEXT NOT NULL,
  category_name TEXT,  -- optional: only apply if tx is in this category
  created_at TEXT NOT NULL,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_raw_hash ON transactions(raw_hash);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_reports_account_report_date ON investment_reports(account_number, report_date);
CREATE INDEX IF NOT EXISTS idx_investment_reports_report_date ON investment_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_investment_positions_report_id ON investment_positions(report_id);
CREATE INDEX IF NOT EXISTS idx_investment_positions_symbol ON investment_positions(symbol);
CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority);
CREATE INDEX IF NOT EXISTS idx_tag_rules_tag_id ON tag_rules(tag_id);

-- Financial amount provenance; transactions.amount remains the ILS valuation.
CREATE TABLE IF NOT EXISTS transaction_valuations (
  transaction_id TEXT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  source_key TEXT UNIQUE NOT NULL,
  original_amount REAL NOT NULL,
  original_currency TEXT NOT NULL,
  billing_currency TEXT NOT NULL,
  valuation_status TEXT NOT NULL CHECK(valuation_status IN ('actual','estimated','allocated')),
  valuation_note TEXT,
  updated_at TEXT NOT NULL
);
