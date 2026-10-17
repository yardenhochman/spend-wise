# SPEC-002: Data Import & Parsing

- **Spec ID**: SPEC-002
- **Version**: 5
- **Status**: current
- **Last Updated**: 2026-09-29

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

## Leumi Mortgage Refresh

The existing authenticated mortgage refresh also retrieves each mortgage's loan
tracks for refinancing analysis. Each track retains its source identity and,
where supplied by Leumi, balance, contractual interest rate, anchor and margin,
indexation, monthly payment, maturity date, next rate reset, and early repayment
fee breakdown. Missing information remains explicitly unavailable rather than
being inferred from mortgage-level forecast rates.

The snapshot reports track coverage and leaves unavailable fields empty. If a
track request fails or expected tracks are missing, the refresh fails and keeps
the previous snapshot. Refresh status distinguishes that retained data from a
successful new collection. Differences between overview and summed track
payments are exposed without changing either source value.
Account access is read-only. Snapshots and raw responses remain in local private
storage; CLI summaries contain counts, freshness, and coverage only.

## Official Leumi Documents

An authenticated document command discovers available mortgage documents and
retrieves an official current balance/early repayment report on request.
Original bank PDFs are saved in local private storage with document type,
retrieval time, source date when available, and a content hash. A document index
allows subsequent requests to find previously downloaded reports and assess freshness.
A fresh-download request must not silently return a stale report or replace a
previous valid document when retrieval fails. Repeated identical PDFs are deduplicated.
The command reports whether the bank supplies an immediate download or requires
an asynchronous request. Financial transactions and mortgage repayment are outside
this flow. A locally generated summary is not an official bank document.

The first implementation discovers Leumi's self-service mortgage catalogue and
supports ordering the detailed early-repayment report and the shorter clearing
balance certificate. It collects mortgage PDFs from the last 30 days of bank
mail, preserving their original bytes. Mailbox sent dates are recorded separately
from retrieval timestamps, without asserting the balance effective date.
Optional watching checks every five minutes for two hours; it reports a timeout
if the bank has not delivered. Pending or uncertain orders are not resubmitted.
Opening documents may mark bank mail as read. Other bank document families are
not yet supported for ordering.

## Tagged expense review

Live card imports preserve refund direction and original/billing currencies. Only posted rows enter expenses; authorizations remain excluded. Foreign-billed transactions require an explicit ILS valuation, labelled estimated until actual conversion is known. Stable source references prevent duplicate imports when valuation changes. Selected card identity must match the source response; no copying one card’s activity onto another.

### Legacy foreign rows and settlements

Foreign rows resembling unvalued legacy entries are deferred and counted as `legacyForeignNeedsReview`; reconcile against original source records before updating them. Source-key-linked valuations survive replay unchanged. Known bank card-settlement and currency-conversion descriptions are internal regardless of category, including on bank import. Fees remain expenses unless an audited reconciliation already includes them in purchase valuations.
