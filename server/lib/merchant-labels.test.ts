import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  displayName,
  merchantKey,
  migrateMerchantLabels,
  readMerchantAliases,
} from './merchant-labels.js'

describe('merchant label migration and precedence', () => {
  it('migrates legacy aliases idempotently and lets a user override an identical seed key without losing it', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`CREATE TABLE merchant_aliases (id TEXT PRIMARY KEY,raw_pattern TEXT,canonical_name TEXT,match_type TEXT);
        CREATE UNIQUE INDEX idx_merchant_aliases_pattern ON merchant_aliases(raw_pattern);
        CREATE TABLE obligations (id TEXT PRIMARY KEY,name TEXT);
        INSERT INTO merchant_aliases VALUES ('seed','synthetic service','Seed service','exact');`)
      migrateMerchantLabels(db)
      migrateMerchantLabels(db)
      db.prepare(
        "INSERT INTO merchant_aliases VALUES ('user','synthetic service','My service','exact','user')",
      ).run()
      expect(
        displayName(' SYNTHETIC   SERVICE כרטיס 123 ', readMerchantAliases(db)),
      ).toBe('My service')
      db.prepare("DELETE FROM merchant_aliases WHERE source='user'").run()
      expect(displayName('Synthetic service', readMerchantAliases(db))).toBe(
        'Seed service',
      )
      expect(displayName('Another service', readMerchantAliases(db))).toBe(
        'Another service',
      )
    } finally {
      db.close()
    }
  })
  it('resolves user exact labels ahead of longer seeded matches and normalizes bank suffixes', () => {
    expect(merchantKey('  Example\n SERVICE חשבון 123-45 ')).toBe(
      'example service',
    )
    expect(
      displayName('Synthetic service', [
        {
          raw_pattern: 'Synthetic service',
          canonical_name: 'Seed',
          match_type: 'exact',
        },
        {
          raw_pattern: 'synthetic service',
          canonical_name: 'User',
          match_type: 'exact',
          source: 'user',
        },
      ]),
    ).toBe('User')
  })
})
