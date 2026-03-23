import { generateDedupHash } from '../lib/dedup.js'
import type {
  ParseResult,
  ParsedTransaction,
  LeumiBlockResult,
} from '../types.js'

// Leumi bank statement format (tab-separated, newest-first):
//   תאריך | תאריך ערך | תיאור | אסמכתא | בחובה | בזכות | היתרה בש"ח
//
// Multi-line transactions: when the description is long, it wraps:
//   15/02/2026	15/02/2026	הבינלאומי כא-
//   י
//   38638	261.79	5,185.74
//
// We merge continuation lines, then use consecutive balances to determine sign.

const DATE_LINE = /^(\d{2}\/\d{2}\/\d{4})\t(\d{2}\/\d{2}\/\d{4})\t(.*)$/
const PAGE_BREAK = /^-- \d+ of \d+ --$/
const NUM = /-?[\d,]+\.\d{2}/g

export function parseLeumiBank(text: string): ParseResult {
  const lines = text.split('\n')
  const rawBlocks = groupTransactionBlocks(lines)
  const parsed = rawBlocks
    .map(parseBlock)
    .filter((b): b is LeumiBlockResult => b !== null)

  // Determine debit/credit using consecutive balances (entries are newest-first)
  for (let i = 0; i < parsed.length; i++) {
    if (i < parsed.length - 1) {
      const prevBalance = parsed[i + 1].balance
      const curBalance = parsed[i].balance
      const amount = parsed[i].rawAmount

      // If prevBalance + amount ≈ curBalance → credit (income)
      // If prevBalance - amount ≈ curBalance → debit (expense)
      const asCredit = Math.abs(prevBalance + amount - curBalance)
      const asDebit = Math.abs(prevBalance - amount - curBalance)

      if (asCredit < 0.02) {
        parsed[i].amount = Math.abs(amount) // income = positive
      } else if (asDebit < 0.02) {
        parsed[i].amount = -Math.abs(amount) // expense = negative
      } else {
        // Can't determine from balance, guess from description
        parsed[i].amount = guessSign(parsed[i].merchant) * Math.abs(amount)
      }
    } else {
      // Last entry (oldest) — guess from description
      parsed[i].amount =
        guessSign(parsed[i].merchant) * Math.abs(parsed[i].rawAmount)
    }
  }

  const transactions: ParsedTransaction[] = []
  const unparsed: string[] = []

  for (const p of parsed) {
    const rawHash = generateDedupHash(p.date, p.amount, p.merchant)

    transactions.push({
      date: p.date,
      merchant: p.merchant,
      amount: p.amount,
      currency: 'ILS',
      ref: p.ref,
      raw_hash: rawHash,
    })
  }

  return { transactions, unparsed }
}

// Group raw lines into transaction blocks.
// A block starts with a date-line and includes all continuation lines until the next date-line or page break.
function groupTransactionBlocks(lines: string[]): string[][] {
  const blocks: string[][] = []
  let current: string[] | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || PAGE_BREAK.test(line)) continue

    if (DATE_LINE.test(line)) {
      if (current) blocks.push(current)
      current = [line]
    } else if (current) {
      current.push(line)
    }
  }

  if (current) blocks.push(current)
  return blocks
}

// Parse a block of lines into a transaction object
function parseBlock(lines: string[]): LeumiBlockResult | null {
  const merged = lines.join(' ')

  const dateMatch = merged.match(DATE_LINE)
  if (!dateMatch) {
    // Try matching just the start for merged multi-line
    const firstLine = lines[0]
    const dm = firstLine.match(DATE_LINE)
    if (!dm) return null
  }

  // Re-parse: first line has dates + start of description
  const firstMatch = lines[0].match(DATE_LINE)
  if (!firstMatch) return null

  const dateStr = firstMatch[1] // DD/MM/YYYY
  let descAndNumbers = firstMatch[3] // everything after value_date

  // Append continuation lines
  for (let i = 1; i < lines.length; i++) {
    descAndNumbers += ' ' + lines[i]
  }

  // Extract all numbers from the combined text
  const numbers: { value: string; index: number; end: number }[] = []
  let m: RegExpExecArray | null
  const numPattern = new RegExp(NUM.source, 'g')
  while ((m = numPattern.exec(descAndNumbers)) !== null) {
    numbers.push({ value: m[0], index: m.index, end: m.index + m[0].length })
  }

  if (numbers.length < 2) return null // need at least amount + balance

  // Balance is the last number, amount is second-to-last
  const balance = parseNum(numbers[numbers.length - 1].value)
  const rawAmount = parseNum(numbers[numbers.length - 2].value)

  // Reference: look for a standalone number sequence (4+ digits) before the amount
  let ref = ''
  if (numbers.length >= 3) {
    ref = numbers[numbers.length - 3].value.replace(/[.,]/g, '')
  } else {
    // Try to find ref in the text before the amount
    const textBefore = descAndNumbers.slice(
      0,
      numbers[numbers.length - 2].index,
    )
    const refMatch = textBefore.match(/\b(\d{1,})\s*$/)
    if (refMatch) ref = refMatch[1]
  }

  // Merchant: text before the reference number
  // The ref is a standalone integer sequence before the decimal amounts
  const merchantEnd =
    numbers.length >= 3
      ? numbers[numbers.length - 3].index
      : numbers[numbers.length - 2].index
  let merchant = descAndNumbers.slice(0, merchantEnd).trim()

  // Remove the reference number from the end of the merchant string if it leaked in
  if (ref) {
    merchant = merchant.replace(new RegExp(`\\s*${ref}\\s*$`), '').trim()
  }

  // Clean up merchant text
  merchant = merchant
    .replace(/\s+/g, ' ')
    .replace(/[-]\s+/, '-')
    .trim()
  merchant = merchant.replace(/\t/g, ' ').trim()

  const date = parseDateDDMMYYYY(dateStr)
  if (!date) return null

  return {
    date,
    merchant: merchant || 'Unknown',
    rawAmount,
    balance,
    ref,
    amount: 0, // filled in later by balance comparison
  }
}

function guessSign(merchant: string): number {
  const incomePatterns = [
    'משכורת',
    'שכר',
    'העמדת',
    'מענק',
    'רבית זכות',
    'החזר',
    'מהבינלאומי',
    'מבנק',
    'הפקדה',
  ]
  const lower = merchant
  for (const pat of incomePatterns) {
    if (lower.includes(pat)) return 1
  }
  return -1
}

function parseNum(str: string): number {
  return parseFloat(str.replace(/,/g, ''))
}

function parseDateDDMMYYYY(dateStr: string): string | null {
  const parts = dateStr.split('/')
  if (parts.length !== 3) return null
  const [day, month, year] = parts
  return `${year}-${month}-${day}`
}
