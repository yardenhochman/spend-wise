# SPEC-019: Household Home Modes

- **Spec ID**: SPEC-019
- **Version**: 6
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
- List every upcoming event from today through the later of the next salary date and today + 14 days, including all events on the final day. Estimated events are labelled. Event availability does not depend on a balance snapshot. Preserve each known card cycle as its own readable estimated bill; unlinked cycles use observed household settlement dates and replace overlapping issuer aggregates. An issuer debit cannot mark unrelated card cycles paid. Project suggested and confirmed checking obligations and each mortgage on its own payment day, once per occurrence. Card-paid obligations remain covered by card bills. Separate recurring salary streams even when their bank descriptions are identical; distinguish them by receiving account and recurring payment timing. If the next salary is unknown, show available upcoming events and say so.
- If no balance is available, say “Balance not available yet” and “Balances arrive with the daily bank import. Upcoming payments are listed below.” Do not offer an upload action. Never imply a missing balance is zero.
- Forecast or balance warnings remain visible but secondary to the main information.

## Commitments

- Show current-month counts of paid, due, and late payment statuses across every displayed obligation, including suggestions.
- Each obligation shows its name, expected amount when known, cadence, note when present, and six months of payment history from oldest to newest.
- Paid, due, late, unconfirmed, and no payment expected have distinct visual and accessible labels. Month labels and a legend explain the trail.
- Confirmation preserves payment matching and paid history. Match normalized bank merchants within the occurrence month; use amount tolerance to distinguish fixed repayments sharing a bank description. Variable transfers may consist of several payments. An observed payment remains paid even when an amount difference merits a note. Late requires no matching payment and a date strictly after the due date plus grace.
- Building fees count payments from checking or cards. Mortgage debits match by amount and payment timing, including standing orders. Each debit has one owner unless it demonstrably pays a combined set of mortgages; allocate that debit across those mortgages without counting its full amount twice.
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

## Merchant labels and names

- Obligation names, recurring merchants and Runway events have a 44px rename affordance opening a shared sheet with a prefilled label and “Bank name: …”. Names use automatic direction and bidirectional isolation; the bank name remains muted secondary text.
- A merchant label applies to every past and future transaction with the same normalized bank merchant, including transaction search, Runway, Commitments and Brief. A saved obligation name takes priority over the merchant label, then the bank name.
- Obligation editing offers “Use this name for all transactions from this merchant”, checked by default. Unchecking saves only the obligation name. Renaming a detected suggestion saves and confirms it while preserving its matching and payment history.
- A Confirm all control confirms every displayed suggestion. Successful confirmations remain saved if another fails; failures remain visible and retryable. Confirmation does not alter payment history.

## Payees and payment source

- Generic bank transfer commitments are detected separately for each payee. Display only the payee name, with account digits removed; explicit names and merchant labels take precedence.
- A commitment can recognize several payment descriptions and payees, each with its own expected amount and optional effective month. Historical payments retain their original amount expectations.
- Tapping a month opens payment evidence (date, positive amount and payee). Missing payments can be marked paid or cleared, with an optional note. Manual marks are explicitly identified and survive refreshes; clearing never removes bank evidence. Controls have at least 44px targets.
- Commitments paid from an untracked own account show neutral “Paid elsewhere” for missing occurrences from the selected start month. Earlier tracked payments remain visible. These commitments and manually paid months produce no tracked-cash forecast outflow.
- Own-account destinations are configured privately using account prefixes or payee patterns. Matching transfers are internal even if the destination is not imported, and excluded from spending, insights and tracked-cash projections. Generic transfer descriptions alone do not establish own-account ownership when destination evidence identifies another payee.
