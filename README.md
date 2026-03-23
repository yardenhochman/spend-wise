# SpendWise

SpendWise is a local-first personal finance app for importing bank and credit card statements, categorizing transactions, and exploring spending trends.

## What You Need

- Node.js 22+
- `pnpm`

## Quick Setup

```bash
git clone <repo-url>
cd spend-wise
pnpm install
```

Start the backend in one terminal:

```bash
pnpm run dev:server
```

Start the frontend in another terminal:

```bash
pnpm run dev
```

Open:

```text
http://localhost:3000
```

That is enough for a first run. The app will create a local SQLite database under `./data`.

## Import Your Data

Use the Upload page in the app and import your own files.

Currently supported:

- Leumi bank statement PDFs
- Leumi credit card PDFs
- Interactive Brokers Flex XML

## Local Data

Everything runs locally by default.

- Database: `./data/spend-wise.sqlite`
- Schema: `./server/db/sqlite-schema.sql`

Nothing in this repo includes your personal transaction data unless you add it yourself locally.

## Optional Private Overlay

If you want personal recommendation cards or household-specific rules without editing tracked files:

1. Copy the example file:

```bash
mkdir -p private
cp config/spendwise.private.example.json private/spendwise.private.json
```

2. Edit:

```text
private/spendwise.private.json
```

That file is gitignored.

You can override the path with:

```bash
SPENDWISE_PRIVATE_CONFIG_PATH=/path/to/spendwise.private.json
```

## Useful Commands

```bash
pnpm run dev
pnpm run dev:server
pnpm run build
pnpm run test
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec tsc --project server/tsconfig.server.json --noEmit
```

## Notes

- The frontend runs on port `3000`
- The backend runs on port `4000`
- The frontend proxies `/api` to the backend in development
- Google Sheets export is optional and requires local `gcloud` auth
