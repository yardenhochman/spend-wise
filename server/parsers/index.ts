import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse')
import { parseLeumiBank } from './leumi-bank.js'
import { parseLeumiCredit } from './leumi-credit.js'
import type { ParseResult, PdfParseResult } from '../types.js'

const parsers: Record<string, (text: string) => ParseResult> = {
  'leumi-bank': parseLeumiBank,
  'leumi-credit': parseLeumiCredit,
}

// Auto-detect whether a PDF is a bank statement or credit card statement
function detectParserType(text: string): string {
  const lower = text.toLowerCase()

  // Credit card indicators (Hebrew and English)
  const creditIndicators = [
    'כרטיס', // card
    'אשראי', // credit
    'credit card',
    'visa',
    'mastercard',
    'isracard',
    'max',
    'cal',
    'פירוט עסקאות', // transaction details (credit card style)
  ]

  // Bank statement indicators
  const bankIndicators = [
    'עו"ש', // checking account
    'חשבון עובר ושב', // checking account (full)
    'תנועות בחשבון', // account movements
    'יתרה', // balance
    'bank statement',
  ]

  let creditScore = 0
  let bankScore = 0

  for (const indicator of creditIndicators) {
    if (lower.includes(indicator)) creditScore++
  }

  for (const indicator of bankIndicators) {
    if (lower.includes(indicator) || text.includes(indicator)) bankScore++
  }

  if (creditScore > bankScore) return 'leumi-credit'
  return 'leumi-bank' // default
}

export async function parsePdf(
  buffer: Buffer,
  parserId: string = 'auto',
): Promise<PdfParseResult> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  const pdf = await parser.getText()
  const text: string = pdf.text

  const resolvedParserId =
    parserId === 'auto' ? detectParserType(text) : parserId

  const parserFn = parsers[resolvedParserId]
  if (!parserFn) {
    throw new Error(`Unknown parser: ${resolvedParserId}`)
  }

  console.log(`[parser] Using parser: ${resolvedParserId}`)
  console.log(`[parser] Extracted ${text.length} chars from PDF`)

  const result = parserFn(text)

  console.log(
    `[parser] Parsed ${result.transactions.length} transactions, ${result.unparsed.length} unparsed lines`,
  )

  // Debug: dump raw text and unparsed lines for parser tuning
  const debugDir = path.resolve(process.cwd(), 'data')
  fs.mkdirSync(debugDir, { recursive: true })
  fs.writeFileSync(path.join(debugDir, 'debug-raw-text.txt'), text, 'utf8')
  fs.writeFileSync(
    path.join(debugDir, 'debug-unparsed.txt'),
    result.unparsed.join('\n'),
    'utf8',
  )

  return {
    parserId: resolvedParserId,
    transactions: result.transactions,
    unparsed: result.unparsed,
    rawText: text,
  }
}
