# SpendWise home redesign — shared API contract (v1)

Product decisions (by the owner, final):
- The home screen becomes three modes switched with BOTTOM TABS: **Runway**, **Commitments**, **Brief**.
- A search button in the top-right header opens a bottom sheet: search box (merchant/amount/tag), **Projects** list, **Browse** links (All transactions, Categories/insights, Subscriptions, Review, Upload).
- The old Routine/Home/Wedding view-mode switch goes away from the new shell. Wedding/Apartment/Honeymoon are "projects" (tags with a net cost). Everything on the three modes is everyday household money (= existing "routine" filter + includeInternal false).
- Household = all Leumi checking accounts + cards together. The HOA committee account is NOT household and must be excluded everywhere.
- Visual reference mockups: /tmp/sw-directions.html (the three modes) — match their structure and tone; adapt to the app's existing shadcn/Tailwind tokens. Phone-first (~390px), must also look fine on desktop (centered column, max ~480px, or a wider layout if natural).

All amounts are ILS numbers (positive = money in, negative = money out, unless stated). Dates are ISO `YYYY-MM-DD`; months `YYYY-MM`.

## GET /api/home/runway?days=56
```ts
interface RunwayResponse {
  asOf: string                       // today
  openingBalance: number | null      // null if no balance snapshot imported yet
  balanceAsOf: string | null         // ISO datetime of the snapshot used
  accounts: { label: string; balance: number; asOf: string }[] // household accounts only, label is generic e.g. "Checking ••12"? NO digits — use "Checking 1", "Checking 2"
  days: { date: string; balance: number }[]          // empty if openingBalance null
  events: { date: string; label: string; amount: number; kind: 'salary' | 'mortgage' | 'card' | 'obligation' | 'other'; estimated: boolean }[]
  low: { date: string; balance: number } | null
  nextSalary: { date: string; amount: number } | null
  warnings: string[]                 // e.g. "Card settlement amounts are estimates", "Balance snapshot is 3 days old"
}
```

## GET /api/home/commitments?months=6
```ts
type TrailStatus = 'paid' | 'due' | 'late' | 'unconfirmed' | 'none'
interface CommitmentsResponse {
  months: string[]                   // oldest → newest, length = months
  obligations: {
    id: string; name: string; kind: 'mortgage' | 'tuition' | 'tax' | 'hoa' | 'loan' | 'utility' | 'other'
    expectedAmount: number | null    // positive number, per occurrence
    cadence: 'monthly' | 'bimonthly' | 'yearly' | 'irregular'
    trail: { month: string; status: TrailStatus; amount: number | null }[]
    note: string | null              // e.g. "₪50 short vs expected"
    confirmed: boolean               // false = auto-detected suggestion, not confirmed by the user
  }[]
  repayments: { id: string; name: string; remaining: number; original: number | null; monthly: number | null; endDate: string | null; source: 'mortgage' | 'manual' }[]
  recurring: {
    annualTotal: number
    items: { merchant: string; amount: number; cadence: 'monthly' | 'yearly' | 'other'; annualized: number; lastSeen: string
             flag: 'new' | 'price-up' | 'price-down' | 'renewal-soon' | null; flagDetail: string | null }[]
  }
}
```

## GET /api/home/brief
```ts
interface BriefResponse {
  weekOf: string                     // Monday of current week
  headline: string                   // e.g. "All good. 2 things worth a look."
  notices: {
    id: string                       // stable across runs for the same underlying fact
    severity: 'action' | 'watch' | 'info'
    title: string; body: string
    chart: { points: number[] } | null
    evidenceTransactionIds: number[]
    agentPrompt: string              // self-contained prompt the user can paste into an agent
  }[]
  coverage: { uncategorizedShare: number; lastImportAt: string | null }
}
```

## GET /api/home/projects
```ts
interface ProjectsResponse { projects: { tag: string; label: string; net: number; status: 'open' | 'ended'; lastActivity: string | null }[] }
```
(Reuse the existing tag-summary service.)

## PUT /api/obligations/:id  — body `{ name?, kind?, expectedAmount?, cadence?, dueDay?, matchPattern?, confirmed? }` → 200 updated obligation. POST /api/obligations to create, DELETE to remove.

## Backend clarifications

- **CHANGED:** POST accepts the PUT fields and requires `name`; it returns 201 with the saved obligation. PUT returns the same camelCase entity (`id`, listed fields, `anchorMonth`, `tolerance`). Defaults: kind `other`, expectedAmount `null`, cadence `monthly`, dueDay `1`, matchPattern = name, confirmed `true` on explicit POST. Invalid fields/windows return 400; unknown IDs return 404; DELETE returns 204. PUT may confirm a computed suggestion using its stable ID. DELETE suppresses that suggestion on later GETs. GETs never persist suggestions.
- **CHANGED:** Matching uses case-insensitive literal merchant containment for checking outflows. Mortgage matching additionally requires its own amount/day tolerance; see the signal quality corrections below. Grace defaults to 5 days; `household.graceDays` overrides it. Paid amounts and recurring per-occurrence/annual costs are positive (cost fields, exceptions to the global cashflow sign convention). A qualified amount mismatch retains its observed amount and produces a note; it is not `paid`. Variable amounts without a stable baseline are treated as observed payments. Bimonthly/yearly occurrence months anchor to the earliest detected payment (manual entries: creation month). Irregular entries show observed payments but are not projected or labelled late. Due days clamp to month end.
- **CHANGED:** Private overlay `household` accepts `accountNumbers: string[]`, `legacyAccountIds?: string[]`, `runwayFloor?: number`, `graceDays?: number`. Example with fake values: `{ "household": { "accountNumbers": ["111-22222_33"], "legacyAccountIds": ["example-checking-id"], "runwayFloor": 0, "graceDays": 5 } }`. Missing allowlist fails closed. Legacy unnumbered Leumi PDF rows require explicit account-ID opt-in. Balances include only allowlisted ILS checking accounts. `balanceAsOf` is the oldest of each account's latest snapshot timestamps; warnings disclose staleness.
- **CHANGED:** Runway includes today and `days-1` following days (1–366; default 56). Commitments includes the current month and preceding months (1–36; default 6). Billing cycle labels identify the settlement month; dates use observed checking debit days. When card identity cannot be linked to a checking debit, its day is estimated from household card-debit history. Without any observed debit day no date is invented. Future/unobserved cycle amounts use recent cycle estimates. Salaries require at least two observed months; all forecasts are estimated. The private mortgage snapshot supplies individual mortgage suggestions and repayments even though Mortgage is excluded from routine analytics.
- **CHANGED:** Projects are tags with event profiles or the standard home/apartment/wedding/honeymoon names. Project net is positive cost, after refunds. Project categories are included in project costs while household/internal exclusions remain enforced; applying the routine category exclusions here would erase the projects themselves. Explicit profile end dates determine `ended`.
- **CHANGED:** Brief compares six completed calendar months (last three vs preceding three), suppressing category drift when uncategorized transaction share exceeds 30% or history does not span the comparison. Drift requires 25% and ILS 100 monthly-average change. Staleness means no household import for 7 days. UUID transaction IDs cannot be represented in the contract's numeric evidence array: those arrays contain only numeric IDs; self-contained agentPrompt text retains actual source IDs. Notice IDs are deterministic for the fact and comparison period.

## Signal quality corrections (2026-10-17)

- Card issuer checking settlements are excluded from obligations and recurring notices, regardless of their internal flag. Forecasts deduplicate issuer spelling variants per cycle; detailed cards use their own cycles (including unlinked cards); issuer-only forecasts use deduplicated checking history when no detailed cycles cover that account. Card service fees are expenses, but not commitments.
- Suggested obligations exclude fees/commissions, cash withdrawals and internal transfers. The per-occurrence minimum is `household.obligationMinimum` (default ILS 100). This threshold applies to suggestions, not explicit manual commitments.
- Each active private mortgage is a separate obligation with its own payment amount and day. Checking mortgage/loan debits are assigned once by amount (15% tolerance) and payment day (up to five days for banking delays); unmatched loan payments remain eligible for loan suggestions. Missing mortgage evidence remains unconfirmed. No combined household mortgage forecast is added.
- Variable amounts count as observed payments. Only a user-confirmed expected amount or at least three prior occurrence amounts with CV <= 5% enables mismatch notes, above max(ILS 20, 5%). Mortgage matching retains its 15% tolerance. An observed payment is never forecast again in the same occurrence, even when its amount differs.
- Brief has at most five notices, sorted by severity then financial impact. Related findings are merged. Its headline counts only displayed action/watch notices, or says “All good.” when there are none. Visible amounts are rounded ILS strings; source IDs appear only in evidence or agent prompts.
- `coverage.uncategorizedShare` is the fraction by transaction count of routine household outflows in the last three complete calendar months, excluding internal transfers and checking card settlements. Category comparisons span six complete months; drift is suppressed if more than 30% of outflows in that compared window are uncategorized, replaced by one categorization info notice. Merchant aliases are used for display; unmatched Hebrew names are preserved.


## Mobile and recurring corrections (2026-10-17)

- English notice sentences use LTR presentation; dynamic project, merchant, obligation and category names are wrapped in Unicode FSI/PDI. Pure name fields use `<bdi dir="auto">` inside start-aligned LTR rows.
- Home Recurring represents subscriptions, services and bills, excluding habitual food, dining, grocery, shopping and transport spending by category and merchant heuristics. Known service names can resolve broad shopping categories. Otherwise unknown merchants require at least three stable occurrences (CV <= 10%), one per month with 25–35-day gaps, or stable annual cadence.
- Merchant aliases and punctuation normalization group the same service before costs and flags are calculated. YouTube Premium and Amazon Prime billing variants have canonical service labels. Near-date, equal-amount alias observations are deduplicated; distinct charges for the same service retain their combined monthly cost. Known recurring categories include subscriptions, utilities, insurance and communications; broad healthcare/housing categories alone do not establish subscription behavior.
- Stable monthly building management payments are suggested household `hoa` obligations after at least three observed months. This includes card-paid fees. Displayed obligations are removed from Recurring. Card-paid obligations remain in the payment trail but are projected through card settlements, avoiding a second checking outflow.
- Current-month pills count the trail statuses of all displayed obligations, including suggestions. A single detection banner replaces repeated Suggested chips; compact Confirm and Dismiss controls retain 44px hit areas. DELETE tombstones already persist dismissal; the client accepts its 204 response and retains retryable errors.
- Missing balance copy refers to the daily bank import and offers no upload action. The upcoming list includes every event through max(next salary date, today + 14 days), regardless of event count; absent a balance, events are still returned. It never truncates same-day events or shortens a later salary window.
- Every home mode reserves the 73px tab-bar height, bottom safe-area inset and 24px breathing room. Full-page captures scroll to the bottom first so fixed navigation appears after the content.
- Verification uses synthetic unit/route/component tests. Real-copy endpoint samples and dark 390px, scale-2 browser captures remain outside Git in `/tmp/sw-real/`; no original database, importer, external network, service configuration or push is involved.

## Runway completeness corrections (2026-10-17)

- Detailed card cycles remain individual estimated bills after obligation noise filtering. A debit settles only the linked card cycle, never all cards under an issuer. Unlinked cycles estimate their day from the median household checking card debit day in the latest complete month (or available history when none is complete); their overlapping issuer aggregates are omitted to avoid double counting. Labels use readable card bill names without source identifiers.
- Recurring salary streams are separated by receiving account, description and payment timing (allowing banking delays), each requiring two observed months. Each stream remains a separate estimated inflow, including streams with the same bank description.
- Suggested and confirmed checking obligations and private mortgages project once on their expected days; already observed occurrences and card-paid commitments do not create another checking outflow. Payments due beyond the list cutoff remain available in the eight-week API forecast.

## Persistent merchant labels (2026-10-17)

- `PUT /api/merchant-labels` accepts `{ rawMerchant: string, label: string }`; `DELETE /api/merchant-labels` accepts `{ rawMerchant: string }`. Both return `{ merchant, displayName }`. Blank names/labels or labels over 160 characters return 400. PUT upserts a user exact alias using NFKC, case/whitespace normalization and the existing bank card/account suffix removal. DELETE clears only the user override, restoring seed resolution.
- User exact aliases take precedence over seeded exact/contains/regex aliases and recurring service defaults. Seeds and user overrides coexist; startup seeding never overwrites the user label. Raw transaction `merchant` and deduplication hashes remain unchanged. Transaction list/detail/edit, category transactions, review, recurring, merchant analytics and search responses include a separate `displayName`. Transaction and merchant search find resolved labels and raw names.
- Home obligation, recurring and Runway event entities expose optional `rawMerchant` for secondary display and editing; aggregate events without an underlying bank merchant omit it. Brief notices expose `rawMerchants` for labels mentioned in their text. Dynamic names use bidi isolation.
- Explicit obligation names win over merchant labels. A name-bearing obligation PUT persists and confirms computed suggestions while preserving their matching rules and payment IDs. A confirmation-only PUT retains merchant-label following; a later merchant rename still updates that obligation's displayed name. Explicit names also apply to mortgage repayments.
- Commitments obligations, recurring rows, Runway events and transaction rows share an accessible rename sheet with prefilled Label and Bank name. Obligations default to also applying the label to all merchant transactions; unchecking changes only the obligation. Clear merchant label does not erase an explicit obligation name. Failed saves retain the editor and retryable errors.
- Confirm all issues a PUT for each visible unconfirmed obligation. Successes remain confirmed on partial failure; retry addresses only failures. It does not change observed payment history. Tests use synthetic data only; screenshot edits on the worktree copy must be restored from its pre-run backup, and preview servers stopped afterward.
