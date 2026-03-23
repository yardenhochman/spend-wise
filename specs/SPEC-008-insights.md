# SPEC-008: Insights & Analytics

- **Spec ID**: SPEC-008
- **Version**: 3
- **Status**: current
- **Last Updated**: 2026-03-24

---

## Overview

The Insights page is the primary expense analytics dashboard. SpendWise also provides a dedicated Investments dashboard for brokerage portfolio tracking. The spending dashboard keeps its two existing views: Summary and Monthly.

## Summary View

### Headline Metrics

Three summary cards:

- **Total Spend**: Sum of all expenses in the current view mode/date range, with trend indicator
- **Total Income**: Sum of all positive transactions
- **Net**: Income minus spend, color-coded (green if positive, red if negative)

### Needs/Wants/Savings Breakdown

- Horizontal stacked bar chart segmented by spending type
- Each segment shows its percentage of total spend
- Only visible when spending type metadata is available

### Category Breakdown

A ranked list of categories by total spend:

- Each row shows: color dot, category name, transaction count, amount, percentage of total, and a proportional progress bar
- Rows are expandable — clicking reveals:
  - **Area chart**: Monthly spend trend with smooth bezier curves, gradient fill, and a dashed average line
  - **Vs-average badge**: Indicates whether recent spending is above or below the historical average
  - **Transaction list**: Individual transactions for the selected period
- Clicking the category name navigates to the Transactions page filtered by that category

### Trending Categories

- Highlights categories with significant recent changes
- Compares the last 3 months' average to the prior 3 months
- Shows percentage change and direction (trending up or down)

## Monthly View

### Year Filter

- Buttons for each year in the dataset, plus "All Years"
- Selecting a year filters the monthly cards

### Monthly Cards (Expandable)

Each month shows:

- **Header**: Month name, transaction count, spend total, income total, net balance
- **Expanded content**: Category breakdown for that month
  - Each category shows: name, count, amount, percentage, progress bar
  - Categories are further expandable to show individual transactions
  - Three-level drill-down: Month > Category > Transactions

## Chart Specifications

### Category Trend Area Chart

- Smooth bezier curve interpolation
- Gradient fill from category color (semi-transparent) to transparent
- Dashed horizontal line showing the period average
- Hover interaction: circle marker on data point, vertical guide line, tooltip with formatted amount
- X-axis: month abbreviations (sampled for density)
- Zero-fills missing months for continuous display
- Responsive width scaling

## Data Scope

- All analytics respect the active view mode (Routine/Home/Wedding)
- Spread transactions are amortized in the analytics (see SPEC-016)
- Internal transactions are always excluded

## Investments Dashboard

The Investments page is a separate analytics surface for long-term asset tracking. It changes behavior by active view mode.

### Mode Behavior

- **Routine** and **Wedding**: show brokerage investment data imported from Interactive Brokers Flex Query XML files
- **Home**: show a derived home-investment dashboard based on apartment-purchase and mortgage transactions already in SpendWise

### Headline Metrics

- Brokerage mode:
  - **Portfolio Value**: Total market value of all open positions in base currency
  - **Unrealized P&L**: Current unrealized gain/loss in base currency
  - **Imported Accounts**: Count of brokerage accounts represented in the latest snapshot set
  - **Snapshot Date**: The effective market date of the latest imported report
- Home mode:
  - **Estimated Home Value**: A current-value baseline derived from the tracked apartment purchase
  - **Net Cash Invested**: Cumulative out-of-pocket cash committed to the home lifecycle after financing inflows
  - **Saved Rent**: Estimated avoided rent since occupancy, based on a Tel Aviv price-to-rent assumption shown in the UI
  - **Net Gain**: Saved rent plus any modeled home-value uplift, minus hard costs and explicit financing costs that are tracked in SpendWise

### Holdings Table

- Each holding row shows symbol, description, quantity, average cost, market price, market value, and unrealized P&L
- Holdings can be sorted by size or gain/loss
- Long and short exposure are visually distinguishable when present
- In Home mode, the holdings table is replaced by a cost-and-performance breakdown for the apartment purchase, financing, and saved-rent contribution

### Portfolio Trend

- The page includes a full-size performance monitor with a shared X/Y chart area rather than sparkline-only summaries
- Brokerage mode shows time-series lines for portfolio value, cost basis, and unrealized gain/loss across imported snapshot dates
- Home mode shows time-series lines for estimated home value, cumulative net cash invested, cumulative saved rent, and net gain
- If only one brokerage snapshot exists, the page still renders current-state metrics and explains that more imports are required for trends

### Position Concentration

- The dashboard highlights the largest positions by portfolio weight
- Security-level weights are computed from the latest imported snapshot
- Position concentration is only shown in brokerage mode

### Assumptions & Disclosure

- Home mode clearly discloses the rent-yield assumption used to estimate saved rent
- Home mode makes a distinction between estimated values and imported facts
- Brokerage mode continues to rely on imported IBKR snapshots, while home mode is derived from SpendWise transaction history plus a market assumption
