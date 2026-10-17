# SPEC-019: Household Home Modes

- **Spec ID**: SPEC-019
- **Version**: 2
- **Status**: current
- **Last Updated**: 2026-10-17

---

## Overview

Home answers three everyday household questions: will cash cover what is coming, did we pay our commitments, and what needs attention this week? Runway, Commitments, and Brief are three modes of the same household home screen. Existing analysis and management pages remain available.

## Household Scope

All home modes cover household checking accounts and cards together. Committee accounts are excluded. Internal transfers are excluded from household spending to avoid double counting. Everyday activity follows the routine household scope. Wedding, apartment purchase, and honeymoon are projects rather than global view switches.

## Navigation

- Home opens at `/` with a persistent bottom navigation for Runway, Commitments, and Brief.
- A shared link can select a mode. An explicit valid mode wins over the remembered mode; without one, the last-used mode opens, defaulting to Runway.
- The header shows the mode title and date, with search at the top right. The legacy view and exclusion switches are absent from home.
- Navigation and actions remain reachable on a phone, respect device safe areas, and have at least 44-pixel touch targets.

## Search and Projects

- Search opens a bottom sheet with a query field for transactions, projects, and page links. Submitting the query opens the existing transaction search with that query.
- Projects show their name, net cost, and open or ended state. Selecting one opens its existing tag view.
- Browse includes Transactions, Insights, Subscriptions, Review, Upload, Actions, and Investments.
- Closing the sheet returns focus to its trigger; keyboard navigation and dismissal are supported.

## Runway

- Show the current household balance, snapshot date, and a daily balance forecast over eight weeks.
- The forecast shows salary dates, a dashed zero-balance reference, and the lowest point with date and amount. A plain-language callout explains the forecast low without promising that estimates are certain.
- List upcoming events from today through the next salary date, including salary and other same-day events. Estimated events are labelled. If fewer than three events fall through the salary date, extend the list through at least the next 14 days. If the next salary is unknown, show available upcoming events and say so.
- If no balance is available, say “Balance not available yet” and “Balances arrive with the daily bank import. Upcoming payments are listed below.” Do not offer an upload action. Never imply a missing balance is zero.
- Forecast or balance warnings remain visible but secondary to the main information.

## Commitments

- Show current-month counts of paid, due, and late payment statuses across every displayed obligation, including suggestions.
- Each obligation shows its name, expected amount when known, cadence, note when present, and six months of payment history from oldest to newest.
- Paid, due, late, unconfirmed, and no payment expected have distinct visual and accessible labels. Month labels and a legend explain the trail.
- A single banner explains automatically detected suggestions. Compact row controls let users confirm or dismiss each suggestion, with at least 44-pixel hit areas. Dismissals persist and suppress future detection; failures remain visible and can be retried.
- Repayments show remaining and original balance when known, progress paid off, monthly amount, and expected end date when available. Unknown totals never imply known progress.
- Stable monthly building management fees are household HOA obligations, including card-paid fees. Card-paid fees are included in cash forecasts through their card settlement and never again as a separate checking payment. Obligations do not also appear in Recurring. Recurring excludes food, groceries, dining and similar habit spending; unknown merchants require subscription-like cadence and amount stability. Merchant aliases and normalization merge service spelling variants. Recurring charges show the annual total, individual amount and cadence, and new, price-change, or upcoming-renewal flags.

## Brief

- Show the current weekly headline and notice cards, distinguished as action, watch, or info with text as well as color.
- Notices include their title and explanation, with an optional trend chart.
- “Ask an agent” copies the notice’s self-contained prompt and confirms success. Clipboard failure provides the prompt for manual copying.
- Coverage states the uncategorized share and last import, including an explicit unknown state.

## States and Presentation

- Each mode and the projects list has loading, recoverable error, and empty states.
- Failed data loads offer retry. Switching modes cannot display a previous mode’s data.
- Financial amounts use ILS and tabular numerals. English sentences keep left-to-right direction and isolate embedded names. Pure merchant and project names use automatic direction inside left-aligned rows. All modes reserve bottom space for the tab bar and device safe area.
- The layout is phone-first with a centered, narrow column on desktop. Home follows the system light or dark preference and honors an explicit dark theme, using the existing semantic palette.
- Development previews may use clearly labelled synthetic household data; production never silently substitutes demonstration data.

## Related Specifications

- SPEC-001: navigation and existing pages.
- SPEC-006: superseded for home; legacy cashflow views remain supported elsewhere.
- SPEC-018: shared presentation and controls.
