# SPEC-010: Data Quality Review

- **Spec ID**: SPEC-010
- **Version**: 1
- **Status**: current
- **Last Updated**: 2026-02-28

---

## Overview

The Review page surfaces transactions with potential data quality issues. It helps users identify and fix miscategorized, unusual, or inconsistent transactions.

## Quality Flags

### Amount Outlier

- Transaction amount exceeds 2x the average for its category
- Displayed as "Nx avg" badge (e.g., "3.2x avg")
- Helps catch miscategorized large transactions or genuinely unusual expenses

### Merchant Mismatch

- The same merchant appears in 2 or more different categories across the dataset
- Displayed as "Multi-cat" badge
- Suggests inconsistent categorization that should be unified

### Singleton Category

- A merchant has only 1 transaction in one category but 3+ transactions in a different category
- Displayed as "Unusual cat" badge
- Suggests the lone transaction may be miscategorized

## Page Layout

### Filter Tabs

- **All**: Shows all flagged transactions with combined count
- **Outliers**: Only amount outlier flags
- **Mismatches**: Only merchant mismatch flags
- **Singletons**: Only singleton category flags

Each tab shows its flag count as a badge.

### Category Filter

Dropdown to narrow results to a specific category.

### Transaction Table

Each row shows: date, merchant, amount, category (editable), flags, notes (editable)

### Mark as Reviewed

- Checkmark button per transaction
- Clicking creates a "Reviewed" tag (if it doesn't exist) and adds it to the transaction
- Reviewed transactions appear at reduced opacity
- Provides a way to acknowledge and dismiss flags without changing the data

## Editing Capabilities

Same inline editing as the Transactions page:

- Category reassignment via dropdown
- Notes editing via inline input

## Pagination

50 transactions per page with Previous/Next navigation.

## Deep Link Support

- URL parameter `filter` pre-selects the flag tab
- URL parameter `category_id` pre-selects the category filter
