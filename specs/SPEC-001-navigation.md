# SPEC-001: Navigation & Information Architecture

- **Spec ID**: SPEC-001
- **Version**: 4
- **Status**: current
- **Last Updated**: 2026-10-17

---

## Overview

SpendWise opens on the household home screen described in SPEC-019. Its three modes use bottom navigation and its search sheet provides access to projects and existing pages. Existing pages retain their top navigation and command palette. The SpendWise brand link returns to home.

## Pages

| Page        | Label       | Purpose                                                      |
| ----------- | ----------- | ------------------------------------------------------------ |
| Insights    | Insights    | Spending analytics dashboard          |
| Investments | Investments | Brokerage portfolio tracking and performance snapshots       |
| Recurring   | Recurring   | Subscription and recurring transaction tracking              |
| Actions     | Actions     | Actionable cost-saving recommendations                       |
| Review      | Review      | Data quality flagging and resolution                         |
| Search      | Search      | Full transaction browser with inline editing                 |
| Import      | Import      | Statement upload (accessible from header icon, not main nav) |

## Navigation Bar

- On existing pages other than home, a persistent header is visible
- Left: Logo ("SpendWise") linking to home
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

## Home

Navigating to `/` opens Runway, Commitments, or Brief. SPEC-019 governs home mode selection, the bottom navigation, and the search sheet. The old exclusion controls are absent from home.

## Deep Linking

- `/transactions?category_id=X` — pre-filters transaction list by category
- `/transactions?q=X` — pre-fills merchant search
- `/review?filter=X` — pre-selects quality flag tab
- `/review?category_id=X` — pre-filters review by category

- `/insights?view=tags&tag=X` — opens the selected project in the existing tag view.
