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
- **CHANGED:** Matching uses case-insensitive literal merchant containment, checking outflows only, with 15% amount tolerance (minimum ILS 1). Mortgage matching also recognizes the Mortgage category. Grace defaults to 5 days; `household.graceDays` overrides it. Paid amounts and recurring per-occurrence/annual costs are positive (cost fields, exceptions to the global cashflow sign convention). An amount mismatch retains its observed amount and produces a note; it is not `paid`. Bimonthly/yearly occurrence months anchor to the earliest detected payment (manual entries: creation month). Irregular entries show observed payments but are not projected or labelled late. Due days clamp to month end.
- **CHANGED:** Private overlay `household` accepts `accountNumbers: string[]`, `legacyAccountIds?: string[]`, `runwayFloor?: number`, `graceDays?: number`. Example with fake values: `{ "household": { "accountNumbers": ["111-22222_33"], "legacyAccountIds": ["example-checking-id"], "runwayFloor": 0, "graceDays": 5 } }`. Missing allowlist fails closed. Legacy unnumbered Leumi PDF rows require explicit account-ID opt-in. Balances include only allowlisted ILS checking accounts. `balanceAsOf` is the oldest of each account's latest snapshot timestamps; warnings disclose staleness.
- **CHANGED:** Runway includes today and `days-1` following days (1–366; default 56). Commitments includes the current month and preceding months (1–36; default 6). Billing cycle labels identify the settlement month; dates use observed checking debit days. When card identity cannot be linked to a checking debit, its day is estimated from household card-debit history. Without any observed debit day no date is invented. Future/unobserved cycle amounts use recent cycle estimates. Salaries require at least two observed months; all forecasts are estimated. The private mortgage snapshot supplies the household mortgage suggestion and repayments even though Mortgage is excluded from routine analytics.
- **CHANGED:** Projects are tags with event profiles or the standard home/apartment/wedding/honeymoon names. Project net is positive cost, after refunds. Project categories are included in project costs while household/internal exclusions remain enforced; applying the routine category exclusions here would erase the projects themselves. Explicit profile end dates determine `ended`.
- **CHANGED:** Brief compares six completed calendar months (last three vs preceding three), suppressing category drift when uncategorized expense share exceeds 20% or history does not span the comparison. Drift requires 25% and ILS 100 monthly-average change. Staleness means no household import for 7 days. UUID transaction IDs cannot be represented in the contract's numeric evidence array: those arrays contain only numeric IDs; self-contained agentPrompt text retains actual source IDs. Notice IDs are deterministic for the fact and comparison period.
