# SPEC-015: Cash Allocations & Budgeting

- **Spec ID**: SPEC-015
- **Version**: 1
- **Status**: current
- **Last Updated**: 2026-02-28

---

## Overview

Cash allocations represent regular cash-based spending that doesn't appear in bank statements. They allow users to track budgeted or allocated cash amounts alongside their electronic transactions.

## Allocation Properties

| Field       | Description                                          |
| ----------- | ---------------------------------------------------- |
| Description | What the cash is allocated for                       |
| Amount      | Amount per occurrence                                |
| Frequency   | weekly, biweekly, or monthly                         |
| Category    | Optional category assignment                         |
| Start date  | Optional — when the allocation begins                |
| End date    | Optional — when the allocation ends (null = ongoing) |

## Display

Cash allocations appear on the Recurring page in a dedicated "Cash Allocations" section:

- Shows description, frequency, and monthly equivalent amount
- Active allocations (no end date or end date in the future) are shown under Active tab
- Ended allocations (end date in the past) appear under Past tab

## Management

Users can:

- Create new cash allocations
- Edit any field of an existing allocation
- Delete allocations

## Monthly Equivalent

All allocations are normalized to a monthly amount for comparison:

- Weekly: amount x 4.33
- Biweekly: amount x 2.17
- Monthly: amount as-is
