# SPEC-006: View Modes

- **Spec ID**: SPEC-006
- **Version**: 2
- **Status**: current
- **Last Updated**: 2026-03-24

---

## Overview

SpendWise supports three mutually exclusive view modes that filter all data across every page. View modes represent distinct financial contexts in the user's life.

## Modes

### Routine (Default)

- **Purpose**: Day-to-day household expense tracking
- **Includes**: All transactions except those belonging to Home or Wedding categories
- **Excludes**: All Home Mode categories, all Wedding Mode categories, mortgage payments, home/wedding loan disbursements and repayments
- Internal transactions are always hidden

### Home

- **Purpose**: Tracking the full cost of an apartment purchase
- **Includes**: Property Price, Purchase Tax, Closing Costs, Home Loans, Mortgage, Home Purchase
- **Also includes**: Mortgage payment transactions, home loan disbursements, loan repayments (before a specific date), loan closure transactions, principal/interest payments
- Internal transactions are always hidden

### Wedding

- **Purpose**: Tracking wedding planning expenses
- **Includes**: Wedding, Venue & Catering, Music & Sound, Photography, Wedding Planning, Wedding Loan
- **Also includes**: Wedding loan repayments (monthly installments), wedding loan disbursement
- Internal transactions are always hidden

## Behavior

- Mode is selected via the toggle in the header
- Mode persists across page navigation within a session
- All API calls include the active view mode
- Filtering happens server-side — only relevant transactions are returned
- Some transactions match by category, others match by specific merchant/amount patterns (e.g., loan payments identified by Hebrew merchant patterns)
- The Investments page is mode-aware:
  - In `Routine` and `Wedding`, it shows brokerage investment data imported from Interactive Brokers
  - In `Home`, it switches to a derived home-investment model built from apartment-purchase and mortgage transactions

## Cross-Mode Rules

- A single transaction can only appear in one mode
- Internal transactions (inter-account transfers, CC payments) are excluded from all modes' insights
- Uncategorized transactions only appear in Routine mode
- The Investments page keeps the same route and navigation item across all modes, but its content adapts to the active mode
