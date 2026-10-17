# SPEC-014: Internal Transaction Handling

- **Spec ID**: SPEC-014
- **Version**: 2
- **Status**: current
- **Last Updated**: 2026-10-17

---

## Overview

Internal transactions are money movements between the user's own accounts that don't represent actual spending or income. SpendWise identifies and flags these to prevent double-counting in analytics.

## What Counts as Internal

### Credit Card Payments

Payments from checking account to credit card (e.g., "מאסטרקרד")

### Self-Transfers

Transfers between own accounts (e.g., "העברה מהחשבון", "העברה עצמית")

### Digital Transfers (Account-to-Account)

Digital and internet banking transfers between own accounts

### Currency Conversions

Foreign currency exchange operations (e.g., "המרת קנ במטח")

### Inter-Bank Movements

Transfers between different banks owned by the same person

### Loan Operations

Loan disbursements and debt restructuring operations

## Flagging Behavior

- Internal transactions are flagged automatically on system startup
- The flag is based on pattern matching against merchant names (exact match and LIKE patterns)
- Flagged transactions have `is_internal = true`

## Display Behavior

- **Insights**: Internal transactions are always excluded from all analytics
- **View Modes**: All three modes exclude internal transactions
- **Transaction List**: Internal transactions are visible but displayed at reduced opacity with an "Internal" badge
- **Hide Internal checkbox**: Users can toggle internal transaction visibility on the Transactions page

## Edge Cases

Some transaction types that look like transfers are NOT flagged internal because they represent real payments:

- Standing orders (הוראת קבע) — these pay actual bills
- Person-to-person Bit/PayBox transfers — these are real expenses
- Bank transfer fees — these are real costs

## Own-account destinations

- Privately configured own accounts can be imported or untracked. Transfers to and from these accounts are internal even when no matching transaction is imported from the other side.
- Account prefixes and named counterparties identify ownership from bank transfer notes, independently of transaction category. The scraper's source account is never mistaken for the destination. A named fallback cannot override an explicit different numbered account.
- An identified payment to another person or organization remains spending even when its generic merchant text resembles an internal transfer. Destination evidence takes precedence over broad legacy generic-transfer flags.
- Internal funding transfers are excluded from spending, insights and tracked-cash outflow projections. A commitment paid from an untracked account is represented separately as “Paid elsewhere” (SPEC-019), preserving historical tracked payment evidence.
- Account identifiers and household ownership rules remain in the gitignored private overlay. Transfer payee labels shown in the UI contain names only, with bank account digits removed.
