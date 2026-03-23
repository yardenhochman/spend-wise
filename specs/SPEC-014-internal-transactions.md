# SPEC-014: Internal Transaction Handling

- **Spec ID**: SPEC-014
- **Version**: 1
- **Status**: current
- **Last Updated**: 2026-02-28

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
