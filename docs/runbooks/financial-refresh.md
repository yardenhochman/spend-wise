# Financial Refresh Runbook

Use this when updating or diagnosing SpendWise financial data.

## Local setup

`mise.toml` pins the Node and pnpm toolchain. Install from the frozen lockfile
before using import commands. Keep recovery history and deployment details in
`private/docs/`; they are specific to each installation.

## Sources

| Source              | Command                                                    | Freshness |
| ------------------- | ---------------------------------------------------------- | --------: |
| Leumi bank accounts | `pnpm run import:bank-scraper -- --write`                  |       24h |
| Leumi CardsWorld    | `pnpm run import:leumi-cards -- --from 2025-06-01 --write` |       24h |
| Leumi mortgages     | `pnpm run import:leumi-mortgages -- --write`               |        7d |

Prefer the orchestrator:

```bash
pnpm run refresh:financial-state -- --stale-only
```

It reads and writes `private/financial-refresh-state.json`, refreshes stale
sources only, and records sanitized success/failure summaries.

## Authentication

Bank scraping reads `LEUMI_USERNAME` and `LEUMI_PASSWORD` from the local
process environment or `.env`. Mortgage scraping also requires
`SPENDWISE_LEUMI_ACCOUNT_SUFFIX` or an explicit `--account-suffix` selection.
Broker `--input` mode consumes local snapshots without loading scraper credentials.
If authentication fails, check local credential configuration and retry only
when the account is ready. Never publish credential values or account selectors.

Do not print or commit credential values. Do not store raw bank responses outside
`private/`.

## Private Files

Keep these local and uncommitted:

```text
data/spend-wise.sqlite
private/
.env
```

`private/` may contain mortgage snapshots, raw bank responses, refresh status,
and logs.

## Interpretation Rules

- Household accounts may be combined only after confirming ownership locally.
- Confirm whether a transfer is internal before treating it as income or spending.
- Card settlements and currency conversions must not duplicate purchases.
- Store household classification exceptions in the private overlay or
  `private/docs/`; public examples are not evidence for classifying live data.
- Separate one-time event spending from routine spending when projecting costs.

## Mortgage Notes

The mortgage importer reads the overview and the read-only `loanInfo` endpoint
for each mortgage from the authenticated mortgage iframe. It stores all tracks
in `mortgages[].tracks` in `private/leumi-mortgages.latest.json` and preserves the
source responses in the corresponding `.raw.json` file.

Track details include principal and clearing balances, contractual/effective
rates, original rates, anchor and margin, indexation, latest payment, start and
maturity dates, next reset date, reset frequency, recent payments, and fee
components. Margins and reset frequencies may be Hebrew descriptions: preserve
them instead of treating them as missing numbers. Dates are normalized to ISO.

`trackCoverage` at snapshot and mortgage level measures retrieved loan IDs
against the overview. Missing fields are `null`; coverage does not imply every
field is available or a refinancing recommendation is ready.
`trackPaymentTotal` sums available track payments only with complete coverage;
`trackPaymentDifference` is overview last payment minus that total. A nonzero
difference is reported in the CLI summary by mortgage count. It may reflect
bank-side payment timing or other components; do not invent an explanation. Fixed and prime
tracks can legitimately have no next scheduled reset date.

If any mortgage detail request fails or track coverage is incomplete, the
importer fails before replacing either snapshot. The orchestrator records the
failure and retains the previous successful timestamp. Check refresh status and
`scrapedAt` before relying on a retained snapshot.

Force a mortgage-only refresh before refinance advice:

```bash
npm run refresh:financial-state -- --source leumi-mortgages --force
```

Compare new quotes against contractual track rates and the next scheduled
reset, including individual exit fees. Mortgage-level `interestPredicted` and
`interestForCompare` are comparison metrics, not the contractual rates. Track
fee totals and mortgage clearing balances already include relevant fee
components; do not add them twice. Operational fees are mortgage-level and
should not be multiplied by the number of tracks.

## Local deployment

Keep service names, VPN mappings, recovery history and machine paths in
`private/docs/`. Choose an unused private HTTPS port if other services share
the machine. Set `SPENDWISE_ALLOWED_HOSTS` for the frontend hostname.

## Tagged trip costs (2026-09-29)

Insights → Tags & trips summarizes existing tagged transactions, across all
purchase dates. Tag profile dates only determine trip duration and daily average.
Categories retain their existing meaning; additional tags provide optional
flight/hotel/etc. detail. Detail tags can overlap and must not be summed together.
The transactions link and tag filter show the underlying ledger entries.

Foreign original amounts and valuation status live in `transaction_valuations`.
Posted NIS amounts are actual; foreign billing amounts require an explicit ILS
valuation and are labeled estimated when using historical BOI rates. Rates alone
do not include card fees. Refunds retain positive ledger signs. Authorizations
are excluded from posted imports. Stable source IDs prevent valuation changes
from creating duplicates; existing valuations are preserved on replay.

`legacyForeignNeedsReview` counts deferred matches to old unvalued foreign rows.
A reconciliation is scoped to the records it verifies.
Keep reconciliation evidence, database backups and scripts under `private/`.
Pending purchases and unknown cash belong in the tag review note until verified;
currency purchases are assets/internal transfers, not extra trip expenses.

## Verification

After changing refresh/import code, run:

```bash
pnpm run typecheck:server
pnpm exec vitest run \
  server/lib/financial-refresh.test.ts \
  server/lib/bank-scraper-import.test.ts \
  server/lib/leumi-card-import.test.ts \
  server/lib/leumi-mortgage-import.test.ts
```

## Official bank documents

Mortgage JSON snapshots are not bank-issued reports. For an official balance or
early-repayment PDF, use [the Leumi document crawler](leumi-documents.md). It can
request the report, track bank preparation, and collect the original from bank mail.
