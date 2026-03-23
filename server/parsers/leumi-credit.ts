import { generateDedupHash } from '../lib/dedup.js'
import type { ParseResult, ParsedTransaction } from '../types.js'

// Parses Leumi credit card statement PDFs
// Credit card statements have a different format from bank statements
const DATE_PATTERN = /^(\d{2}\/\d{2}\/\d{2})/

export function parseLeumiCredit(text: string): ParseResult {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const transactions: ParsedTransaction[] = []
  const unparsed: string[] = []

  for (const line of lines) {
    const dateMatch = line.match(DATE_PATTERN)
    if (!dateMatch) continue

    try {
      const parsed = parseCreditLine(line, dateMatch[1])
      if (parsed) {
        transactions.push(parsed)
      } else {
        unparsed.push(line)
      }
    } catch {
      unparsed.push(line)
    }
  }

  if (unparsed.length > 0) {
    console.log(`[leumi-credit] ${unparsed.length} unparsed lines:`)
    unparsed.forEach((l) => console.log(`  > ${l}`))
  }

  return { transactions, unparsed }
}

function parseCreditLine(
  line: string,
  dateStr: string,
): ParsedTransaction | null {
  let rest = line.slice(dateStr.length).trim()

  // Credit card statements: date, sometimes a second date (transaction vs charge date),
  // merchant, amount. Amounts are typically all charges (negative).
  const numbers: { value: string; index: number }[] = []
  const numPattern = /-?[\d,]+\.\d{2}/g
  let match: RegExpExecArray | null
  while ((match = numPattern.exec(rest)) !== null) {
    numbers.push({ value: match[0], index: match.index })
  }

  if (numbers.length < 1) return null

  // On credit card statements, the last number is typically the charge amount
  const amount = -Math.abs(parseNumber(numbers[numbers.length - 1].value))

  // Check for a second date (charge date)
  let merchant = rest
  const secondDateMatch = rest.match(/^(\d{2}\/\d{2}\/\d{2})\s*/)
  if (secondDateMatch) {
    merchant = rest.slice(secondDateMatch[0].length)
  }

  // Extract merchant: everything before the first number
  const firstNumIndex = numbers[0].index
  merchant = rest.slice(0, firstNumIndex).trim()

  // Clean up - remove second date if present
  merchant = merchant.replace(/^\d{2}\/\d{2}\/\d{2}\s*/, '').trim()
  merchant = merchant.replace(/\s+/g, ' ').trim()

  const ref = ''
  const date = parseDate(dateStr)
  if (!date) return null

  const rawHash = generateDedupHash(date, amount, merchant)

  return {
    date,
    merchant: merchant || 'Unknown',
    amount,
    currency: 'ILS',
    ref,
    raw_hash: rawHash,
  }
}

function parseNumber(str: string): number {
  return parseFloat(str.replace(/,/g, ''))
}

function parseDate(dateStr: string): string | null {
  const parts = dateStr.split('/')
  if (parts.length !== 3) return null

  const day = parts[0]
  const month = parts[1]
  let year = parts[2]

  if (year.length === 2) {
    year = parseInt(year) > 50 ? `19${year}` : `20${year}`
  }

  return `${year}-${month}-${day}`
}
