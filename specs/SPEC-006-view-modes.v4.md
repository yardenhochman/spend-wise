# SPEC-006: Cashflow View & Exclusions

- **Spec ID**: SPEC-006
- **Version**: 4
- **Status**: in-progress
- **Last Updated**: 2026-10-17

---

## Home shell supersession

This spec is deprecated for the home shell, superseded by SPEC-019. Home has Runway, Commitments, and Brief modes; these describe different household questions, not different household datasets. Home excludes committee accounts and internal transfers and uses the everyday household scope. Projects are accessed through search.

The cashflow/exclusion behavior below remains supported on existing pages outside home for backwards compatibility.

## Overview

SpendWise defaults to a full household cashflow view: all non-internal income
and expenses are included unless the user explicitly hides a spending class.
This keeps the first read faithful to the bank reality while still allowing a
cleaner routine-spending view.

## Default View

### Cashflow

- **Purpose**: Show the full household financial picture for the selected date
  range.
- **Includes**: All income and expenses from the imported accounts and cards.
- **Excludes**: Internal transactions such as inter-account transfers and card
  payments.
- **Default**: Active on app load.

## Exclusion Toggles

The header exposes global toggles that remove matching transactions from
analytics, monthly summaries, category drilldowns, recurring merchants, review,
and transaction search.

### Wedding

- Excludes: Wedding, Venue & Catering, Music & Sound, Photography, Wedding
  Planning.
- Does not exclude wedding loan repayments; those are handled by Loans.

### Loans

- Excludes: Wedding Loan and Home Loans.
- Also excludes loan disbursement and repayment patterns configured in the
  private SpendWise view-mode rules.

### Mortgage

- Excludes: Mortgage.
- Also excludes configured Leumi mortgage payment patterns.

### Home

- Excludes: Home Purchase, Property Price, Purchase Tax, Closing Costs, and
  Consulting.
- Does not exclude mortgage or home-loan financing; those are handled by
  Mortgage and Loans.

## Legacy Specialized Modes

The server still supports `routine`, `home`, and `wedding` view modes for
specialized pages and backwards compatibility.

- `routine`: historical shortcut for cashflow minus home, wedding, mortgage,
  and loan activity.
- `home`: dedicated home-purchase lifecycle view.
- `wedding`: dedicated wedding lifecycle view.

Primary household analysis should use `cashflow` plus explicit exclusion
toggles instead of switching mutually exclusive modes.

## Behavior

- Exclusions persist across page navigation within the current browser session.
- API calls include `view_mode=cashflow` and, when needed,
  `excluded_kinds=wedding,loans,mortgage,home`.
- Filtering happens server-side so returned totals and transaction lists match.
- Internal transactions remain hidden from analytics even when no exclusion
  toggles are active.
