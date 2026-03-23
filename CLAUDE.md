# SpendWise — Claude Code Guide

## What is this?

Israeli household expense tracker with three view modes: **Routine** (daily expenses), **Home** (apartment purchase), **Wedding** (wedding expenses). Built with TanStack Start (React) frontend + Express/SQLite backend.

## Product Specs & Agent Workflow

- **Product specs**: `specs/` — 18 feature specs describing what the app does (no implementation details). See [`specs/README.md`](./specs/README.md) for the full registry.
- **Agent guide**: [`agents.md`](./agents.md) — how agents should work with specs, claim features, and coordinate parallel work.
- **Categorization agent**: [`subagents/categorize.md`](./subagents/categorize.md) — bulk transaction categorization workflow.

When implementing a feature: read the relevant spec first, claim it (`in-progress`), write spec changes, then implement. See `agents.md` for the full lifecycle.

## Quick Start

```bash
# Terminal 1: Backend (port 4000)
npm run dev:server

# Terminal 2: Frontend (port 3000, proxies /api to 4000)
npm run dev
```

## Private Overlay

- Public-safe defaults: `config/spendwise.defaults.json`
- Example private template: `config/spendwise.private.example.json`
- Local private overrides: `private/spendwise.private.json` or the path in `SPENDWISE_PRIVATE_CONFIG_PATH`

Use the private overlay for household-specific rules, recommendation cards, and exact transaction heuristics that should not live in the public repo.

## Tooling

- **Linting**: `npm run lint` (oxlint)
- **Formatting**: `npm run format` (oxfmt)
- **Type checking**: `npx tsc --noEmit` (frontend) / `npx tsc --project server/tsconfig.server.json --noEmit` (server)
- **Build**: `npx vite build`
- **Config files**: `oxlint.json`, `.oxfmtrc.json`, `components.json` (shadcn)

## Key Architecture

### Tech Stack

- **Frontend**: TanStack Start (React) + TailwindCSS v4 + shadcn/ui (Base UI / base-nova style)
- **Backend**: Express + better-sqlite3, TypeScript (run via `tsx`)
- **UI primitives**: `@base-ui/react` via shadcn — components in `src/components/ui/`
- **Utilities**: `cn()` from `src/lib/utils.ts` (clsx + tailwind-merge)
- **Currency**: dinero.js via `src/utils/currency.ts` (`formatILS`, `splitAmount`)
- **Dates**: date-fns via `src/utils/dates.ts` (`formatMonthLabel`, `formatMonthAbbr`, `formatChartLabel`)
- **Validation**: Zod v4 (server-side input validation)
- **ORM**: Drizzle schema defined in `server/schema.ts` (alongside raw better-sqlite3 queries)
- **API layer**: tRPC router in `server/trpc.ts`, mounted at `/trpc/*` alongside Express REST routes

### View Modes (`server/index.ts` → `buildViewModeFilter()`)

- **Routine**: Excludes Home/Wedding/Mortgage and all sub-categories + loan SQL patterns
- **Home**: Includes Property Price, Purchase Tax, Closing Costs, Home Loans, Mortgage, Home Purchase categories + mortgage/loan SQL patterns
- **Wedding**: Includes Wedding, Venue & Catering, Music & Sound, Photography, Wedding Planning, Wedding Loan categories + wedding loan SQL patterns
- `includeInternal: false` for all modes — internal transactions (self-transfers, currency conversions, CC payments) are always hidden from insights

### Internal Transactions

Auto-flagged in `server/db.ts` on startup via `INTERNAL_PATTERNS`. These are excluded from spending totals to prevent double-counting. Includes: CC payments, self-transfers, currency conversions, inter-bank movements.

### Categories

See `subagents/categorize.md` for the full category table with descriptions and examples. Categories are split into routine (daily life), home mode (property purchase), and wedding mode (wedding expenses).

### Cross-Source Deduplication (`server/lib/dedup.ts`)

Three-layer dedup prevents duplicates across multiple bank and credit card sources:

1. **Layer 1 — Normalized hash**: `generateDedupHash()` produces a consistent hash from normalized merchant name, amount, and date. All parsers use this shared function.
2. **Layer 2 — Fuzzy matching**: `buildFuzzyIndex()` + `findFuzzyDuplicate()` catch near-duplicates across sources (date ±1 day, amount ±0.5 ILS, same normalized merchant). Used by import scripts and the POST `/api/import` endpoint.
3. **Layer 3 — DB UNIQUE constraint**: Final safety net at the database level.

Helper functions `normalizeMerchant()` and `normalizeAmount()` standardize Hebrew merchant names and amounts before hashing. On first run after migration, `migrateHashes()` in `db.ts` rehashes all existing transactions and removes duplicates.

### Frontend State

- View mode: React Context (`src/lib/view-mode.tsx`) shared across all components
- URL params: TanStack Router `validateSearch` for category filtering on `/transactions`
- Category colors: CSS custom properties in `src/styles.css`, mapped in shared `src/lib/constants.ts`
- Tags: `tags` + `transaction_tags` tables, CRUD API, inline picker in TransactionTable

## Folder Structure

```
src/
  components/
    ui/               # shadcn/ui primitives (button, card, table, input, etc.)
    app/              # App-specific composites (Header, FileUpload, CategoryChart, ActionsPage)
    features/
      transactions/   # TransactionTable
      insights/       # SpendingBreakdown, MonthlyDrilldown
  utils/              # currency.ts (dinero.js), dates.ts (date-fns)
  lib/                # api.ts, types.ts, constants.ts, view-mode.tsx, utils.ts (cn helper)
  routes/             # TanStack file-based routes
  styles.css          # Tailwind v4 theme + shadcn CSS variables + category colors
server/
  tsconfig.server.json
  types.ts            # Shared server interfaces
  schema.ts           # Drizzle ORM schema
  trpc.ts             # tRPC router + procedures
  lib/dedup.ts        # Dedup hash + fuzzy matching
  parsers/            # leumi-credit.ts, leumi-bank.ts, index.ts
  db.ts               # SQLite setup, migrations, category seeding
  index.ts            # Express API server (~800 lines)
```

## Key Files

| File                                                        | Purpose                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `server/index.ts`                                           | Express API + tRPC, view mode filter, all endpoints                          |
| `server/lib/dedup.ts`                                       | Shared dedup: hash generation, fuzzy matching, normalization                 |
| `server/db.ts`                                              | SQLite setup, category seeding, internal flagging, hash migration            |
| `server/schema.ts`                                          | Drizzle ORM table definitions                                                |
| `server/trpc.ts`                                            | tRPC router initialization + procedures                                      |
| `server/types.ts`                                           | Shared TypeScript interfaces                                                 |
| `src/components/features/insights/SpendingBreakdown.tsx`    | Insights: summary cards + expandable category bars with inline charts        |
| `src/components/features/insights/MonthlyDrilldown.tsx`     | Monthly expandable breakdown                                                 |
| `src/components/features/transactions/TransactionTable.tsx` | Filterable transaction list with notes + tags                                |
| `src/components/app/CategoryChart.tsx`                      | Inline SVG bar chart for per-category trends                                 |
| `src/components/app/ActionsPage.tsx`                        | Actions & recommendations page                                               |
| `src/components/app/Header.tsx`                             | Navigation + view mode switcher                                              |
| `src/components/app/FileUpload.tsx`                         | Statement file upload with drag & drop                                       |
| `src/utils/currency.ts`                                     | `formatILS()`, `splitAmount()` via dinero.js                                 |
| `src/utils/dates.ts`                                        | `formatMonthLabel()`, `formatMonthAbbr()`, `formatChartLabel()` via date-fns |
| `src/lib/api.ts`                                            | Typed API fetch wrappers                                                     |
| `src/lib/types.ts`                                          | TypeScript interfaces                                                        |
| `src/lib/constants.ts`                                      | Shared CATEGORY_COLORS + CATEGORY_HEX_COLORS maps                            |
| `src/lib/utils.ts`                                          | `cn()` helper (clsx + tailwind-merge)                                        |
| `src/lib/view-mode.tsx`                                     | ViewMode context provider                                                    |
| `src/styles.css`                                            | Tailwind v4 theme + shadcn CSS variables + category colors                   |
| `subagents/categorize.md`                                   | Categorization guide for new transactions                                    |
| `data/spend-wise.sqlite`                                    | SQLite database                                                              |

## Coding Conventions

### Error Handling

- **Frontend API calls**: Use `neverthrow` (`ResultAsync`, `Result`) — never throw from API functions. `safeFetchJson<T>()` in `src/lib/api.ts` returns `ResultAsync<T, ApiError>`. New API functions should use it.
- **Legacy**: Some older API functions still use the throwing `fetchJson()`. Migrate when touching them, don't rewrite all at once.
- **Pattern matching**: Use `ts-pattern` (`match()`) for discriminated unions — `ApiError` types, search states, any union with 3+ variants. Prefer `.exhaustive()` to ensure all cases are handled.
- **Server-side**: Express handlers use try/catch + the global error handler. No neverthrow on the server.

### Preferred Libraries (don't reinvent)

| Concern | Library | Location | Key exports |
|---|---|---|---|
| Currency formatting | dinero.js | `src/utils/currency.ts` | `formatILS()`, `splitAmount()` |
| Date formatting | date-fns | `src/utils/dates.ts` | `formatMonthLabel()`, `formatMonthAbbr()`, `formatChartLabel()` |
| Class merging | clsx + tailwind-merge | `src/lib/utils.ts` | `cn()` |
| Debounce/throttle | `@tanstack/react-pacer` | direct import | `useDebouncedCallback`, `useAsyncDebouncedCallback` |
| Validation | Zod v4 | server-side only | `z.object()`, `z.string()`, etc. |
| Error results | neverthrow | `src/lib/api.ts` | `safeFetchJson()`, `ResultAsync`, `ApiError` |
| Union matching | ts-pattern | direct import | `match()`, `.with()`, `.exhaustive()` |

**Before adding a new library**, check this table — there's likely an existing solution.

### Shared Utilities Checklist

Before writing new helpers, check these files:
- `src/utils/currency.ts` — any money formatting
- `src/utils/dates.ts` — any date formatting or month math
- `src/lib/constants.ts` — category colors (`CATEGORY_COLORS`, `CATEGORY_HEX_COLORS`)
- `src/lib/api.ts` — API wrappers; add new endpoints here, not inline
- `src/lib/types.ts` — all shared TypeScript interfaces; don't define response types inline
- `server/lib/dedup.ts` — merchant normalization, hashing
- `server/index.ts` → `buildViewModeFilter()` — view mode SQL filtering

### Component Patterns

- **UI primitives** (`src/components/ui/`): shadcn/base-ui components. Never modify for app-specific logic — wrap them instead.
- **Feature components** (`src/components/features/`): Organized by domain (transactions, insights). Own their data fetching and state.
- **App components** (`src/components/app/`): Shared composites (Header, charts, CommandPalette). Used across routes.
- **Styling**: Tailwind classes via `cn()`. No CSS modules, no styled-components. Category colors use CSS variables from `src/styles.css`.

### Anti-Patterns

- Don't use `any` — use `unknown` and narrow, or define proper types in `types.ts`
- Don't `fetch()` inline in components — add a function to `src/lib/api.ts`
- Don't format currency manually — use `formatILS()` / `splitAmount()`
- Don't create custom debounce hooks — use `@tanstack/react-pacer`
- Don't swallow errors silently (`.catch(() => {})`) — use neverthrow `Result` or at minimum log the error
- Don't add new CSS color tokens without also adding to `CATEGORY_COLORS` map in `constants.ts`

## Database

Schema: `../docs/db/sqlite-schema.sql`
DB: `data/spend-wise.sqlite`

Key tables: `transactions` (id, date, merchant, amount, category_id, is_internal, raw_hash), `categories` (id, name), `tags` (id, name, color), `transaction_tags` (transaction_id, tag_id)

## Adding Categories

When creating new categories:

1. Add to `server/db.ts` via `ensureCategory('Name')`
2. If it belongs to a view mode, update `buildViewModeFilter()` in `server/index.ts`
3. Add CSS color: `--color-cat-slug` in `src/styles.css`
4. Add to `CATEGORY_COLORS` + `CATEGORY_HEX_COLORS` in `src/lib/constants.ts`
5. Update `subagents/categorize.md` category table
