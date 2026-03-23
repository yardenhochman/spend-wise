# SPEC-002: Data Import & Parsing

- **Spec ID**: SPEC-002
- **Version**: 2
- **Status**: current
- **Last Updated**: 2026-03-23

---

## Overview

SpendWise ingests financial data from multiple sources. The primary user-facing flow is PDF upload via the Import page. Additional sources are supported via CLI scripts for bulk/historical imports.

## Supported Sources

### 1. Leumi Bank Statements (PDF) — UI Upload

- **Input**: PDF file from Bank Leumi (checking account)
- **Auto-detected** from PDF content
- Extracts: date, merchant name, amount, reference number
- Handles multi-line merchant descriptions
- Infers debit/credit sign from balance progression

### 2. Leumi Credit Card Statements (PDF) — UI Upload

- **Input**: PDF file from Bank Leumi (credit card)
- **Auto-detected** from PDF content (keywords: credit, card, transactions)
- All extracted amounts are charges (negative)
- Handles 2-digit and 4-digit year formats

### 3. Interactive Brokers Flex Query (XML) — UI Upload

- **Input**: XML exported from Interactive Brokers Activity Flex Query
- Used for portfolio holdings and performance snapshots rather than expense transactions
- Extracts:
  - account metadata
  - open positions
  - unrealized and realized P&L summary rows
  - net share counts per security
- Re-importing the same report date is safe and replaces the prior snapshot for that account/date
- Empty sections in the XML (for example trades or cash transactions) are tolerated

## Upload Flow (UI)

1. User drags or clicks to select a supported file
2. System auto-detects the parser from file type/content
3. The relevant import pipeline runs:
   - Leumi PDFs become transactions
   - IBKR XML becomes investment snapshots
4. User sees an import summary:
   - Parser used
   - Rows or records parsed from file
   - New data inserted
   - Replaced or duplicate records skipped
   - Unparsed lines or sections (warning, if any)

## Upload Constraints

- `.pdf` and `.xml` files accepted via UI
- One file at a time
- Re-uploading the same file is safe (duplicates are skipped)

## Import Tracking

Each import session is recorded with:

- Filename and parser used
- Timestamp
- Status (completed/failed)
- Transaction count
- Snapshot count when the file is portfolio-oriented

## Post-Import Processing

After transactions are inserted:

- Categorization rules are applied to assign categories
- Tag rules are applied to assign sub-segment tags
- Internal transaction patterns are flagged
- Recurring candidate detection runs

For portfolio snapshot imports:

- Current holdings are updated for the imported report date
- Portfolio-level totals are recalculated from the imported snapshot
- Historical snapshots remain available for trend views
