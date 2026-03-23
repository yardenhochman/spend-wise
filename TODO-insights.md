# SpendWise Insights & Classification Roadmap

## Context

The user lands on the main insights page seeing category spending breakdown.
They can switch between All Time / Annual / Monthly views and click a category
to drill into trends (monthly or daily bars depending on view).
Goal: help the user understand spending habits like a CFP would — through
comparisons, classifications, and anomaly surfacing, with zero manual setup.

---

## 0. Classification System Redesign

### The Problem

SpendWise currently has a flat list of ~30 categories with no secondary dimensions.
This causes:

- **No fixed/discretionary distinction** — can't answer "how much do I actually control?"
- **No cross-cutting context** — a grocery purchase during a trip is either Groceries OR Trips Abroad, never both
- **Transfer is a dumping ground** — 256 tx mixing P2P payments, CC bills, and currency exchange
- **Merchant fragmentation** — 1,018 unique merchants, many are variants of the same entity (6 BIRD variants, 3 AliExpress spellings, etc.)
- **Payment platform masking** — BIT/Paybox transactions carry the platform name, not the spending purpose

### Industry Best Practices (Research Summary)

**Standard structure (Monarch, Copilot, Lunch Money):**

- Two-level hierarchy: Category Group > Category (not deeper)
- Tags as a second dimension: one category per tx, many tags. Category = "what was this for?", tags = "in what context?"
- Category properties (Lunch Money model): boolean flags — "treat as income", "exclude from budget", "exclude from totals"
- Sweet spot: 20-30 active categories across 6-10 groups

**Classification tiers (CFP standard, maps to 50/30/20):**

- **Needs (50%)**: Housing, Utilities, Insurance, Loan Payments, basic Healthcare, Groceries
- **Wants (30%)**: Dining, Shopping, Entertainment, Travel, Sports
- **Savings & Debt (20%)**: Pension, Keren Hishtalmut, Emergency Fund, Extra Loan Payments

**Key references:** Plaid PFC taxonomy (16 primary / 104 detailed), BLS Consumer Expenditure Survey (14 major), Mint (22 parent / 100+ subcategories). Some budgeting services bake fixed/variable into the data model (fixedExpense vs variableExpense envelope types).

### Proposed Category System

#### Category Groups & Categories (~26 routine + lifecycle)

**NEEDS (Fixed/Essential)**

| Group      | Category         | Type       | Notes                                                                |
| ---------- | ---------------- | ---------- | -------------------------------------------------------------------- |
| Housing    | Rent / Mortgage  | Fixed      | Monthly housing payment                                              |
| Housing    | Home Maintenance | Fixed      | Va'ad bayit, repairs, appliances (currently in "Other")              |
| Utilities  | Utilities        | Fixed      | IEC, water, arnona, gas                                              |
| Utilities  | Telecom          | Fixed      | Mobile and internet providers — currently split across Subscriptions/Utilities |
| Insurance  | Insurance        | Fixed      | Health supplement, life, contents                                    |
| Financial  | Bank Fees        | Fixed      | Account fees, ATM fees                                               |
| Financial  | Loan Payments    | Fixed      | Non-mortgage loans                                                   |
| Healthcare | Healthcare       | Semi-fixed | Kupat Holim, pharmacy, dental, specialists                           |

**WANTS (Discretionary)**

| Group        | Category          | Type          | Notes                                            |
| ------------ | ----------------- | ------------- | ------------------------------------------------ |
| Food & Drink | Groceries         | Flexible      | Shuk, supermarkets, mini-markets                 |
| Food & Drink | Dining            | Discretionary | Restaurants, cafes, bars, delivery (Wolt)        |
| Transport    | Transport         | Flexible      | Scooters, car-share, public transit, taxis       |
| Shopping     | Shopping          | Discretionary | Clothing, electronics, home goods                |
| Shopping     | Online Shopping   | Discretionary | AliExpress, Amazon, Temu                         |
| Lifestyle    | Entertainment     | Discretionary | Movies, concerts, events                         |
| Lifestyle    | Subscriptions     | Semi-fixed    | Streaming, apps, news                            |
| Lifestyle    | Sports & Fitness  | Discretionary | Gym, physio                                      |
| Lifestyle    | Personal Care     | Discretionary | Hair, grooming (currently in Shopping/Other)     |
| Lifestyle    | Pets              | Discretionary | Pet food and vet care                            |
| Travel       | Trips Abroad      | Discretionary | Flights, hotels, in-trip spending                |
| Gifts        | Gifts & Donations | Discretionary | Gift checks, charity (new category)              |
| Education    | Education         | Discretionary | Courses, books                                   |

**STRUCTURAL (Excluded from spending analysis)**

| Group     | Category        | Behavior            | Notes                                      |
| --------- | --------------- | ------------------- | ------------------------------------------ |
| Income    | Salary          | Treat as income     | Employment income                          |
| Income    | Other Income    | Treat as income     | Interest, refunds, freelance               |
| Transfers | Transfer        | Exclude from totals | True bank-to-bank, CC payments             |
| Transfers | Cash Withdrawal | Exclude from totals | ATM — payment method, not spending purpose |
| Financial | Savings         | Exclude from budget | Keren Hishtalmut, pension                  |

**LIFECYCLE (Isolated by view mode, unchanged)**

- Home: Property Price, Purchase Tax, Closing Costs, Home Loans, Mortgage, Home Setup
- Wedding: Venue & Catering, Music & Sound, Photography, Wedding Planning, Wedding Loan

#### Changes from Current System

1. **New**: Telecom (split from Utilities/Subscriptions), Home Maintenance (from Other), Personal Care (from Shopping), Gifts & Donations
2. **Reclassified**: Cash Withdrawal gets "exclude from totals" (payment method, not category)
3. **Category properties**: Each gets `spending_type` (needs/wants/savings/structural) and `exclude_from_totals` boolean

### Tags System (New Second Dimension)

Tags already exist in DB (`tags` + `transaction_tags`) and have a UI picker in TransactionTable. What's needed: tag-based analytics, cross-dimensional reporting, and auto-tagging at import time.

**Design philosophy:** Tags are rich indexed metadata, not a UI feature. Capture broadly, surface selectively. The data is always there for agents/tooling to query. Visual decisions come later — a tag that's never shown in the UI still has value as a queryable dimension.

**Zero downside to broad tagging:** Storage is trivial (a join table row per tag). Auto-tagging by merchant pattern reuses the existing rules infrastructure. A missing tag is just less detail, not a wrong classification. Cognitive load only matters if surfaced in UI — and we control that separately.

**Two tag types:**

1. **Context tags** (cross-cutting, applied manually or by date/event):
   - Trip tags: auto-generated from Trips Abroad date clusters ("London Jul 2024")
   - "Tax Deductible", "Reimbursable", "One-Time", "Gift"

2. **Sub-segment tags** (within-category detail, auto-assigned by merchant pattern):

   | Category      | Tags                                              | Auto-assign by                           |
   | ------------- | ------------------------------------------------- | ---------------------------------------- |
   | Groceries     | `shuk`, `supermarket`, `convenience`, `specialty` | Merchant name patterns                   |
   | Dining        | `delivery`, `bakery`, `restaurant`, `bar`, `cafe` | Merchant name patterns                   |
   | Transport     | `scooter`, `car-share`, `taxi`, `public-transit`  | Merchant name patterns                   |
   | Shopping      | `online`, `clothing`, `electronics`, `home-goods` | Merchant name + Online Shopping category |
   | Entertainment | `events`, `streaming`, `gaming`                   | Merchant name patterns                   |
   | Healthcare    | `kupat-holim`, `pharmacy`, `dental`, `specialist` | Merchant name patterns                   |

   These enable queries like "delivery spend trend", "shuk vs supermarket ratio", "am I taking more taxis?" without polluting the category system. The UI can surface any of these when a particular breakdown earns its place visually.

**Key principle:** Category = "what was this for?", Tag = "in what context?" + "what sub-type?". A grocery purchase during a trip stays in Groceries (accurate budget) but gets a trip tag (accurate trip cost) and a `shuk` tag (accurate sourcing detail).

### Merchant Normalization

~50-80 alias rules would cover the worst fragmentation:

- BIRD (6 variants), Dott (3), TIER (9), AliExpress (2), YouTube/Spotify (2 each)
- Cash withdrawals (8 variants), Rav-Pas (2), BIT (4)
- Implementation: `merchant_aliases` table mapping raw → canonical

### Recurring Transaction Detection

Many merchants are already identifiable as monthly recurring. Auto-detect: same merchant, similar amount ±10%, monthly cadence ±3 days.

---

## 1. Category Bar Enrichment (Summary View)

### 1a. "vs average" indicator on each category

- Badge/arrow: "↑ 23% vs avg" or "↓ 10%"
- Monthly view: compare to category's monthly average
- Annual view: compare to annual average
- All-time view: compare last full month to rolling average

### 1b. Percentage of total spend

- Show "22% of spend" explicitly on each category bar

### 1c. Top 3 categories trending up (nudge)

- "Trending up: Dining ↑30%, Shopping ↑22%"
- Compare recent 3mo avg to prior 3mo avg

---

## 2. Category Drill-Down Enrichment (on click)

### 2a. Average overlay on trend chart

- Dashed line for category average across visible period

### 2b. Highest / lowest period callout

- "Peak: ₪4,200 in Dec 2024" / "Lowest: ₪800 in Aug 2023"

### 2c. Top merchants within category

- Top 3-5 merchants driving spend in that category

---

## 3. Benchmark / Comparison Insights

### 3a. Period-over-period comparison

- Per-category delta: Groceries ₪3,200 → ₪3,800 (+₪600, +19%)
- "This month vs last month" or vs same month last year

### 3b. Category share shift over time

- "Dining was 12% of spend last year, now 18%"

---

## 4. Fixed vs. Discretionary Display

### 4a. Add `spending_type` to categories table

- Enum: 'needs', 'wants', 'savings', 'structural'

### 4b. Needs/Wants/Savings split in summary

- "Needs: ₪8,200/mo (55%) | Wants: ₪4,800/mo (32%) | Savings: ₪1,900 (13%)"
- Compare to 50/30/20 benchmark targets

### 4c. Track discretionary spending trend

- "Your discretionary spending is up 15% over the last 3 months"

---

## 5. Anomaly Detection

### 5a. Unusual spikes

- Flag months where category is >1.5x its average
- Surface in summary: "1 unusual spike this month: Shopping"

### 5b. New or disappeared merchants

- "New merchant: Fox Home (₪890) appeared in Shopping"

### 5c. Large single transactions

- Flag transactions >₪1,000 or >2x category avg

---

## Data Quality Quick Wins

Periodically review misclassified, uncategorized, and "Other" transactions. Common patterns:
- Currency exchange in Entertainment → Trips Abroad
- Streaming/news subscriptions in Entertainment → Subscriptions
- Appliance installments in Other → Home Maintenance
- Legal fees in Other → Closing Costs
- Interest income in Other → Other Income

---

## 6. Amortization of One-Time Expenses

### The Problem

Large irregular expenses (annual tax payments, insurance catch-ups) distort the month they land in.
A large annual payment makes that month look terrible, but the cost relates to an entire year.

### Approach: Spread Across Associated Period

- Each one-time expense gets an `amortize_months` attribute (e.g., 12 for annual tax)
- Monthly view shows the amortized portion
- Annual view shows the full amount
- Tax payments specifically reduce annual income and by extension monthly income equally

### Implementation

- Add `Taxes` category (`spending_type: 'needs'`, `category_group: 'Financial'`)
- Tag one-time expenses with `one-time`
- Add `amortize_months` field to transactions (or via a separate `amortization_rules` table)
- Backend: monthly average calculations exclude raw one-time amounts and instead distribute the amortized portion
- Frontend: show amortized amount in monthly view, full amount in annual, with a subtle indicator that it's amortized

---

## 7. Transaction Linking & Reimbursements

### The Problem

Some expenses are reimbursed (fully or partially). Without linking,
reports show the full expense + the reimbursement income separately, both misleading.

### Implementation

- Add `linked_transaction_id` field to transactions table (nullable, references another tx)
- Or a `transaction_links` join table for many-to-many links
- When linked, reports can show net amount and flag "reimbursed" visually
- Tag both sides `reimbursable` for easy filtering
- Frontend: show linked transactions together with net calculation

---

## 8. Additional Data Quality Fixes (from discussion)

### New category: Taxes

- `spending_type: 'needs'`, `category_group: 'Financial'`
- For income tax, national insurance catch-ups, and similar government obligations
- NOT for arnona (that's Utilities) or small bank interest tax (Bank Fees)

---

## Implementation Priority

### Phase 1: Classification Foundation

1. Add `spending_type` column to categories + assign values
2. Merchant normalization — alias table for top ~50 fragmented merchants
3. Data quality fixes — reclassify known misclassifications above

### Phase 2: Insights Enrichment

4. 1a — vs average indicator
5. 4b — needs/wants/savings split display
6. 2a — average overlay on trend chart
7. 1c — trending categories nudge

### Phase 3: Data Quality & New Categories

8. Create Taxes category + recategorize tax/government payments (section 8)
9. Tag known one-time expenses (`one-time`, `reimbursable`)
10. Link reimbursement outgoing/incoming transactions

### Phase 4: Deep Analysis

11. 3a — period-over-period comparison
12. 2c — top merchants in drill-down
13. 5a — spike detection
14. 2b — highest/lowest callout

### Phase 5: Amortization & Linking

15. Amortization system — spread one-time expenses across months (section 6)
16. Transaction linking for reimbursements (section 7)
17. Backend: exclude raw one-time amounts from monthly averages, use amortized values

### Phase 6: Tags & Recurring

18. Tag analytics — spending by tag, cross-dimensional reports
19. Recurring detection — auto-flag, surface in UI
20. Everything else
