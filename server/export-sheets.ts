#!/usr/bin/env node
/**
 * Export SpendWise transactions to Google Sheets.
 *
 * Usage:
 *   tsx server/export-sheets.ts [options]
 *
 * Options:
 *   --from YYYY-MM      Start month (inclusive)
 *   --to YYYY-MM        End month (inclusive)
 *   --mode routine|home|wedding   View mode filter
 *   --sheet-id ID       Update existing spreadsheet (otherwise creates new)
 *
 * Requires Application Default Credentials:
 *   gcloud auth application-default login --scopes=https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive
 */

import { execSync } from 'child_process'
import { google } from 'googleapis'
import { db } from './db.js'

interface TxRow {
  date: string
  merchant: string
  amount: number
  category: string | null
  tags: string | null
  notes: string | null
  source: string | null
  is_internal: number
}

function parseArgs() {
  const args = process.argv.slice(2)
  const opts: {
    from?: string
    to?: string
    mode?: string
    sheetId?: string
  } = {}

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) opts.from = args[++i]
    else if (args[i] === '--to' && args[i + 1]) opts.to = args[++i]
    else if (args[i] === '--mode' && args[i + 1]) opts.mode = args[++i]
    else if (args[i] === '--sheet-id' && args[i + 1]) opts.sheetId = args[++i]
    else if (args[i] === '--help') {
      console.log(`Usage: tsx server/export-sheets.ts [options]

Options:
  --from YYYY-MM      Start month (inclusive)
  --to YYYY-MM        End month (inclusive)
  --mode routine|home|wedding   View mode filter
  --sheet-id ID       Update existing spreadsheet (otherwise creates new)

Requires: gcloud auth application-default login --scopes=https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive`)
      process.exit(0)
    }
  }
  return opts
}

function queryTransactions(opts: {
  from?: string
  to?: string
  mode?: string
}): TxRow[] {
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.from) {
    conditions.push('t.date >= ?')
    params.push(`${opts.from}-01`)
  }
  if (opts.to) {
    conditions.push('t.date <= ?')
    // End of month: use last day
    const [y, m] = opts.to.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    params.push(`${opts.to}-${String(lastDay).padStart(2, '0')}`)
  }

  // Simple mode filter by category names (matches buildViewModeFilter logic)
  if (opts.mode === 'home') {
    conditions.push(
      "c.name IN ('Home Purchase', 'Mortgage', 'Property Price', 'Purchase Tax', 'Closing Costs', 'Home Loans', 'Consulting')",
    )
  } else if (opts.mode === 'wedding') {
    conditions.push(
      "c.name IN ('Wedding', 'Venue & Catering', 'Music & Sound', 'Photography', 'Wedding Planning', 'Wedding Loan')",
    )
  } else if (opts.mode === 'routine') {
    conditions.push(
      "COALESCE(c.name, '') NOT IN ('Home Purchase', 'Mortgage', 'Property Price', 'Purchase Tax', 'Closing Costs', 'Home Loans', 'Consulting', 'Wedding', 'Venue & Catering', 'Music & Sound', 'Photography', 'Wedding Planning', 'Wedding Loan')",
    )
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const sql = `
    SELECT
      t.date,
      t.merchant,
      t.amount,
      c.name as category,
      GROUP_CONCAT(tg.name, ', ') as tags,
      t.notes,
      sf.parser_id as source,
      t.is_internal
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN transaction_tags tt ON tt.transaction_id = t.id
    LEFT JOIN tags tg ON tg.id = tt.tag_id
    LEFT JOIN statement_files sf ON sf.id = t.source_file_id
    ${where}
    GROUP BY t.id
    ORDER BY t.date DESC, t.merchant
  `

  return db.prepare(sql).all(...params) as TxRow[]
}

async function main() {
  const opts = parseArgs()

  // Query transactions
  const rows = queryTransactions(opts)
  console.log(`Found ${rows.length} transactions to export`)

  if (rows.length === 0) {
    console.log('Nothing to export.')
    return
  }

  // Authenticate via gcloud CLI access token
  const token = execSync('gcloud auth print-access-token', {
    encoding: 'utf8',
  }).trim()
  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: token })

  const sheets = google.sheets({ version: 'v4', auth })

  // Build header + data rows
  const header = [
    'Date',
    'Merchant',
    'Amount (ILS)',
    'Category',
    'Tags',
    'Notes',
    'Source',
    'Internal',
  ]
  const data = rows.map((r) => [
    r.date,
    r.merchant,
    r.amount,
    r.category || '',
    r.tags || '',
    r.notes || '',
    r.source || '',
    r.is_internal ? 'Yes' : '',
  ])

  const allRows = [header, ...data]

  if (opts.sheetId) {
    // Update existing spreadsheet
    await sheets.spreadsheets.values.clear({
      spreadsheetId: opts.sheetId,
      range: 'Transactions!A:H',
    })
    await sheets.spreadsheets.values.update({
      spreadsheetId: opts.sheetId,
      range: 'Transactions!A1',
      valueInputOption: 'RAW',
      requestBody: { values: allRows },
    })
    console.log(
      `Updated spreadsheet: https://docs.google.com/spreadsheets/d/${opts.sheetId}`,
    )
  } else {
    // Create new spreadsheet
    const modeLabel = opts.mode ? ` (${opts.mode})` : ''
    const dateRange =
      opts.from || opts.to
        ? ` ${opts.from || '...'} to ${opts.to || '...'}`
        : ''
    const title = `SpendWise Export${modeLabel}${dateRange}`

    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: [{ properties: { title: 'Transactions' } }],
      },
    })

    const spreadsheetId = spreadsheet.data.spreadsheetId!
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Transactions!A1',
      valueInputOption: 'RAW',
      requestBody: { values: allRows },
    })

    console.log(
      `Created spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    )
  }

  console.log(`Exported ${rows.length} transactions.`)
}

main().catch((err) => {
  if (err.message?.includes('gcloud')) {
    console.error('gcloud CLI error. Make sure you are logged in:')
    console.error('  gcloud auth login')
    process.exit(1)
  }
  console.error(err)
  process.exit(1)
})
