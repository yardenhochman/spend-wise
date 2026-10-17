import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  flagOwnAccountTransfers,
  ownAccountTransfer,
  transferPayee,
} from '../payees.js'
import {
  detectObligations,
  assignPayments,
  obligationTrail,
  obligationEvents,
} from './obligations.js'
import { migrateObligations } from './migration.js'
import { tx, obligation } from './test-fixtures.js'

describe('transfer payees and payment history', () => {
  it('extracts destination names without account numbers or source accounts', () => {
    for (const prefix of ['העברה אל:', 'העברה ל:', 'transfer to:']) {
      expect(
        transferPayee(
          `scraper account 99-000; ${prefix} Example Recipient 88-222-00099 memo 123`,
        ),
      ).toBe('Example Recipient')
    }
    expect(transferPayee('העברה אל: ועד בית לדוגמה 88-222-00099')).toBe(
      'ועד בית לדוגמה',
    )
    expect(transferPayee('העברה ל: Example Recipient')).toBe(
      'Example Recipient',
    )
    expect(transferPayee('scraper account 99-000')).toBeNull()
    expect(transferPayee(null)).toBeNull()
    expect(transferPayee('העברה לזכות: Example Committee 88-222-00099')).toBe(
      'Example Committee',
    )
  })
  it('groups generic merchants by payee across merchant spellings, allowing a missing month', () => {
    const rows = ['03', '04', '06'].flatMap((month, i) =>
      ['Example A', 'Example B'].map((payee, j) =>
        tx({
          id: `${i}-${j}`,
          date: `2030-${month}-10`,
          merchant: i === 1 ? 'הוראת קבע' : 'הע. אינטרנט',
          notes: `העברה אל: ${payee} 88-222-00099`,
          amount: j ? -200 : -500,
        }),
      ),
    )
    const detected = detectObligations(rows, '2030-06-18')
    expect(detected.map((o) => o.name).sort()).toEqual([
      'Example A',
      'Example B',
    ])
    expect(detected.every((o) => o.cadence === 'monthly')).toBe(true)
    const assigned = assignPayments(detected, rows)
    expect(assigned.map((o) => o.paymentIds?.length)).toEqual([3, 3])
    expect(new Set(assigned.flatMap((o) => o.paymentIds!)).size).toBe(6)
  })
  it('matches old card and new bank rules with independent effective amounts', () => {
    const o = obligation({
      kind: 'hoa',
      confirmed: true,
      expectedAmount: 250,
      matchingRules: [
        { pattern: 'Example Management', expectedAmount: 100 },
        {
          pattern: 'הע. אינטרנט',
          payee: 'Example Committee',
          expectedAmount: 200,
          effectiveFrom: '2030-05',
        },
        {
          pattern: 'הע. אינטרנט',
          payee: 'Example Committee',
          expectedAmount: 250,
          effectiveFrom: '2030-06',
        },
      ],
    })
    const rows = [
      tx({
        id: 'old',
        date: '2030-04-10',
        account_label: 'Credit Card',
        merchant: 'Example Management',
        amount: -100,
      }),
      tx({
        id: 'may',
        date: '2030-05-10',
        merchant: 'הע. אינטרנט',
        notes: 'העברה אל: Example Committee 88-222-00099',
        amount: -200,
      }),
      tx({
        id: 'june',
        merchant: 'הע. אינטרנט',
        notes: 'העברה ל: Example Committee 88-222-00099',
        amount: -250,
      }),
      tx({
        id: 'wrong',
        merchant: 'הע. אינטרנט',
        notes: 'העברה ל: Another Committee 88-222-00099',
        amount: -250,
      }),
      tx({
        id: 'stale-amount',
        merchant: 'הע. אינטרנט',
        notes: 'העברה ל: Example Committee 88-222-00099',
        amount: -200,
      }),
    ]
    const assigned = assignPayments([o], rows)[0]
    expect(assigned.paymentIds).toEqual(['old', 'may', 'june'])
    const trail = obligationTrail(
      assigned,
      rows,
      ['2030-04', '2030-05', '2030-06'],
      '2030-06-18',
    )
    expect(trail.trail.map((t) => t.amount)).toEqual([100, 200, 250])
    expect(trail.trail.every((t) => t.status === 'paid')).toBe(true)
    expect(trail.note).toBeNull()
  })
  it('manual marks preserve evidence and suppress projected outflows', () => {
    const o = obligation({
      confirmed: true,
      monthMarks: { '2030-06': 'Settled separately' },
    })
    expect(
      obligationTrail(o, [], ['2030-06'], '2030-06-18').trail[0],
    ).toMatchObject({
      status: 'paid',
      markedByYou: true,
      manualNote: 'Settled separately',
      amount: null,
    })
    expect(
      obligationTrail(o, [tx()], ['2030-06'], '2030-06-18').trail[0],
    ).toMatchObject({
      status: 'paid',
      markedByYou: true,
      amount: 100,
      payments: [{ payee: 'Synthetic standing order', amount: 100 }],
    })
    expect(obligationEvents([o], [], '2030-06-01', '2030-06-30')).toEqual([])
    expect(
      obligationTrail({ ...o, monthMarks: {} }, [], ['2030-06'], '2030-06-18')
        .trail[0].status,
    ).toBe('late')
  })
  it('keeps tracked-era evidence while untracked payments are neutral and not projected', () => {
    const o = obligation({
      paidFrom: 'untracked',
      paidFromLabel: 'Other account',
      paidFromSince: '2030-05',
      confirmed: true,
    })
    const history = [tx({ date: '2030-04-10' })]
    const trail = obligationTrail(
      o,
      history,
      ['2030-03', '2030-04', '2030-05', '2030-06'],
      '2030-06-18',
    )
    expect(trail.trail.map((t) => t.status)).toEqual([
      'late',
      'paid',
      'external',
      'external',
    ])
    expect(obligationEvents([o], history, '2030-06-01', '2030-07-31')).toEqual(
      [],
    )
  })
  it('flags own destination transfers regardless of category and removes generic non-own flags', () => {
    const config = {
      accountNumbers: [],
      ownAccounts: [
        {
          match: '99-222-000',
          payeePattern: 'Example Owner',
          label: 'Other account',
          tracked: false,
        },
      ],
    }
    expect(
      ownAccountTransfer(
        'scraper account 99-222-000; העברה ל: Example Vendor 88-000-000',
        config,
      ),
    ).toBe(false)
    expect(
      ownAccountTransfer('העברה אל: Example Owner 99-222-00012', config),
    ).toBe(true)
    expect(
      ownAccountTransfer('העברה אל: Example Owner 88-000-000', config),
    ).toBe(false)
    expect(ownAccountTransfer('העברה אל: Example Owner', config)).toBe(true)
    expect(
      ownAccountTransfer('העברה מאת: Example Owner 99-222-00012', config),
    ).toBe(true)
    expect(
      ownAccountTransfer(
        'העברה אל: Example Vendor 88-000-000 memo 99-222-00012',
        config,
      ),
    ).toBe(false)
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE transactions(id TEXT,merchant TEXT,notes TEXT,is_internal INTEGER); INSERT INTO transactions VALUES
      ('own','העברה דיגיטל','העברה אל: Example Owner 99-222-00012',0),
      ('other','הע. אינטרנט','העברה אל: Example Vendor 88-000-000',1),
      ('unknown','העברה דיגיטל',NULL,1)`)
    flagOwnAccountTransfers(db, config)
    flagOwnAccountTransfers(db, config)
    expect(
      db.prepare('SELECT id,is_internal FROM transactions ORDER BY id').all(),
    ).toEqual([
      { id: 'other', is_internal: 0 },
      { id: 'own', is_internal: 1 },
      { id: 'unknown', is_internal: 1 },
    ])
    db.close()
  })
  it('migrates existing obligations additively and idempotently', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE obligations(id TEXT PRIMARY KEY);CREATE TABLE obligation_matching_rules(obligation_id TEXT PRIMARY KEY,pattern TEXT,tolerance REAL);
      INSERT INTO obligations VALUES ('example');INSERT INTO obligation_matching_rules VALUES ('example','Old merchant',0.15)`)
    migrateObligations(db)
    migrateObligations(db)
    expect(
      db
        .prepare(
          'SELECT pattern,payee,additional_rules FROM obligation_matching_rules',
        )
        .get(),
    ).toEqual({ pattern: 'Old merchant', payee: null, additional_rules: '[]' })
    db.close()
  })
})
