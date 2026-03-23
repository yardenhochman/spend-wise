# SPEC-004: Categorization & Rules

- **Spec ID**: SPEC-004
- **Version**: 1
- **Status**: current
- **Last Updated**: 2026-02-28

---

## Overview

Every transaction in SpendWise can be assigned a category. Categories are the primary dimension for spending analysis. Assignment happens automatically via rules or manually by the user.

## Category Taxonomy

### Routine Categories

Groceries, Dining, Transport, Housing, Utilities, Healthcare, Insurance, Education, Entertainment, Shopping, Subscriptions, Sports & Fitness, Online Shopping, Pets, Home Maintenance, Workshops & Retreats, Trips Abroad, Taxes, Salary, Transfer, Cash Withdrawal, Bank Fees, Savings, Other

### Home Mode Categories

Property Price, Purchase Tax, Closing Costs, Home Loans, Mortgage, Home Purchase

### Wedding Mode Categories

Wedding, Venue & Catering, Music & Sound, Photography, Wedding Planning, Wedding Loan

## Category Metadata

Each category has two metadata fields:

### Spending Type

Classifies the nature of the expense for needs/wants analysis:

- **Needs**: Essential expenses (Housing, Utilities, Insurance, Healthcare, Taxes, etc.)
- **Wants**: Discretionary spending (Dining, Entertainment, Shopping, Travel, etc.)
- **Savings**: Capital building (Savings, Mortgage, Property purchases)
- **Structural**: Non-spending money movements (Salary, Transfers, Cash Withdrawal)

### Category Group

Groups categories for dashboard organization (e.g., Food & Drink, Transport, Lifestyle, Financial, etc.)

## Auto-Categorization Rules

Rules assign categories automatically during import based on merchant name matching.

### Rule Properties

- **Pattern**: The text to match against the merchant name
- **Match type**: `exact`, `contains`, or `regex`
- **Category**: The category to assign on match
- **Priority**: Higher-priority rules take precedence when multiple rules match
- **Enabled**: Rules can be disabled without deleting

### Rule Evaluation

Rules are evaluated in priority order (highest first). The first matching rule wins.

## Manual Categorization

Users can reassign any transaction's category via:

- Inline category dropdown on the Transactions page
- Inline category dropdown on the Review page

## Uncategorized Transactions

Transactions that don't match any rule remain uncategorized (null category). They appear in insights as "Uncategorized" and can be filtered in the transactions view.

## AI-Assisted Bulk Categorization

A subagent workflow exists for batch-categorizing merchants:

- Groups uncategorized transactions by merchant
- Classifies merchants in bulk using merchant name, average amount, and frequency as signals
- Only assigns when confidence exceeds 70%
- Ambiguous merchants are left for manual review
