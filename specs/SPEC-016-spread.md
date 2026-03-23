# SPEC-016: Billing Spread / Amortization

- **Spec ID**: SPEC-016
- **Version**: 1
- **Status**: current
- **Last Updated**: 2026-02-28

---

## Overview

Some expenses are paid as a lump sum but represent costs spread over multiple months (e.g., annual insurance, bimonthly utility bills). The billing spread feature distributes these amounts across months for more accurate monthly spending analysis.

## How It Works

When a transaction has a spread period set (e.g., 12 months):

1. The full amount is **removed** from the month it was charged
2. The amount is **divided equally** across the spread period
3. The monthly portions are distributed **backward** from the charge date

Example: A 12,000 ILS annual insurance payment on January 15, 2026:

- Removes 12,000 from January 2026
- Adds 1,000 to each month from February 2025 through January 2026

## Setting Spread

Users can set the spread period per transaction from the Transactions page:

- Click the calendar icon on any transaction row
- Choose: 2 months, 3 months, 6 months, or 12 months
- "Clear" removes the spread

## Impact on Analytics

Spread adjustments are applied at query time across:

- Summary insights (total spend, category totals)
- Monthly breakdown
- Category trend charts

The original transaction remains unchanged in the database — spread is a display-level adjustment.

## Common Use Cases

- **12-month spread**: Annual insurance premiums, tax payments, Bituach Leumi
- **6-month spread**: Semi-annual fees
- **2-month spread**: Bimonthly utility bills (electricity, arnona)
