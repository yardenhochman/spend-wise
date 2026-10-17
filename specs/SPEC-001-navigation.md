# SPEC-001: Navigation & Information Architecture

- **Spec ID**: SPEC-001
- **Version**: 3
- **Status**: current
- **Last Updated**: 2026-07-24

---

## Overview

SpendWise organizes its features across seven primary pages accessible via a persistent top navigation bar, plus a global command palette for quick access.

## Pages

| Page        | Label       | Purpose                                                      |
| ----------- | ----------- | ------------------------------------------------------------ |
| Insights    | Insights    | Spending analytics dashboard (default landing page)          |
| Investments | Investments | Brokerage portfolio tracking and performance snapshots       |
| Recurring   | Recurring   | Subscription and recurring transaction tracking              |
| Actions     | Actions     | Actionable cost-saving recommendations                       |
| Review      | Review      | Data quality flagging and resolution                         |
| Search      | Search      | Full transaction browser with inline editing                 |
| Import      | Import      | Statement upload (accessible from header icon, not main nav) |

## Navigation Bar

- Persistent header visible on all pages
- Left: Logo ("SpendWise") linking to Insights
- Center: Six main navigation tabs with icons and labels
- Right: Command palette trigger, Import button, and cashflow exclusion toggles
- Active page tab is visually highlighted
- Responsive: on small screens, the header wraps into compact rows; navigation
  is icon-only and horizontally scrollable, while exclusion toggles remain
  reachable without causing page-level horizontal overflow

## Cashflow Exclusion Toggles

The header exposes global toggles that remove major non-routine classes from
the active cashflow view:

| Toggle   | Icon     | Scope                                        |
| -------- | -------- | -------------------------------------------- |
| Wedding  | Heart    | Wedding expenses                             |
| Loans    | Receipt  | Home and wedding loan payments/disbursements |
| Mortgage | Landmark | Mortgage payments                            |
| Home     | Home     | Home purchase/setup costs                    |

Toggles filter data across the relevant pages. Full cashflow is the default.

## Investments Navigation

- Investments is a first-class page in the main navigation, separate from the expense view mode switcher
- The page is always reachable regardless of the active expense view mode
- The page includes an import action for brokerage snapshot files

## Root Redirect

Navigating to `/` redirects to `/insights`.

## Deep Linking

- `/transactions?category_id=X` — pre-filters transaction list by category
- `/transactions?q=X` — pre-fills merchant search
- `/review?filter=X` — pre-selects quality flag tab
- `/review?category_id=X` — pre-filters review by category
