# SPEC-009: Recurring & Subscriptions

- **Spec ID**: SPEC-009
- **Version**: 2
- **Status**: current
- **Last Updated**: 2026-02-28

---

## Overview

The Recurring page identifies and displays subscription-like spending patterns — merchants that charge consistently month over month. It also tracks cash allocations (budgeted items not tied to bank transactions).

## Detection Criteria

A merchant is flagged as recurring when:

- It has transactions in at least 3 distinct months
- The amount's coefficient of variation (CV) is below a threshold:
  - Expenses: CV <= 0.15 (stable subscriptions, utilities)
  - Income: CV <= 0.35 (salary with allowable variation)

## Summary Cards

Four headline metrics:

- **Monthly/Annual Burn**: Total recurring expense amount (toggleable period)
- **Monthly/Annual Income**: Total recurring income (toggleable period)
- **Active Count**: Number of currently active recurring merchants
- **Past Count**: Number of inactive/ended recurring merchants

Amounts respect the monthly/annual toggle.

## Monthly / Annual Toggle

A toggle next to the Active/Past tabs switches all displayed amounts between monthly and annual (x12) view. Affects summary cards, category subtotals, and individual merchant amounts. Suffixed with "/mo" or "/yr" accordingly.

## Active vs. Past Tabs

- **Active**: Merchant's last transaction was within the last 2 months
- **Past**: Merchant's last transaction was more than 2 months ago

## Category Donut Chart

Shown above the expense accordion (active tab only):

- Donut chart showing each category's share of total recurring burn
- Each slice colored by category color
- Clicking a slice filters the accordion to that category only
- Clicking again or clicking the center deselects (shows all)
- Selected slice is visually expanded
- Center text shows total burn, or the selected category name + amount

## Recurring Items Display

Grouped by category, each group shows:

- Category name with colored dot and item count badge
- Category subtotal (respects monthly/annual toggle)

Each merchant within a group shows:

- **Merchant name** — clickable, navigates to the transactions page filtered by that merchant
- **"New" badge** — shown for merchants first detected within the last 3 months
- Duration active (e.g., "12 months, Jan 2024 – Jan 2025")
- **Sparkline** — mini trend line showing the last 12 months of spending for that merchant
- Monthly/annual amount (respects toggle)
- Transaction count
- **Trend indicator**: Arrow up/down if the recent 3-month average differs from the historical average by more than 10%
- **Expected amount warning**: Amber warning icon when the merchant's average deviates more than 15% from a user-set expected amount
- **Action menu** (three-dot button, see below)

## Action Menu

Each merchant row has a three-dot action menu with:

- **View transactions** — navigates to the transactions page filtered by that merchant
- **Edit category** — inline category picker to bulk-reassign all transactions from this merchant
- **Set expected amount** — user enters an expected monthly amount; stored locally. Shows a warning badge when actual spending deviates >15%. Can be cleared.
- **Not recurring (dismiss)** — removes the merchant from the recurring list by unflagging all its transactions

## Expected Amounts

Users can set an expected monthly amount per merchant. When the merchant's actual average deviates more than 15% from the expected value, a warning indicator appears on the row with a tooltip showing expected vs. actual. Expected amounts are stored in the browser (localStorage) — no account/server dependency.

## Sections

### Expenses

Recurring charges grouped by category (collapsed by default, expandable). Can be filtered by the donut chart.

### Recurring Income

Positive recurring items (salary, bonuses) highlighted in green. Includes sparklines and action menus but no donut chart.

### Cash Allocations

Manually defined budget items:

- Description, amount, and frequency (weekly/biweekly/monthly)
- Monthly equivalent amount displayed (respects monthly/annual toggle)
- Optional category assignment
- Optional start/end dates
- Active or ended status

## Cash Allocation Management

Users can:

- Create a new allocation (description, amount, frequency, optional category, optional date range)
- Edit allocation fields
- Delete allocations
