# Preparing a public source release

Keep financial records and operational evidence under the gitignored `data/`,
`private/`, and `.restore-backups/` directories. Store household interpretation
rules in the private overlay; preserve removed operational notes in
`private/docs/`. Use synthetic identities, merchants, dates, and amounts in tests.

Local commit preparation does not authorize publishing or refreshing live data.
Review the complete added-line diff before a separately authorized push. Include
names in both languages, account/card selectors, VPN endpoints, machine paths,
merchant/date/amount combinations, and household classification exceptions in
that review. Long digit runs can also be package versions or synthetic balances;
inspect each match rather than treating a zero-match scan as the only privacy check.

## Offline verification

Use the pinned toolchain via `mise exec --` so native SQLite bindings match Node.
Run frontend and server TypeScript checks, lint, and the full Vitest suite.
The accounting route tests use SQLite in memory, stub server listening, and mock
private configuration; they do not open the household database or bank sessions.
Document-store tests create and remove their own temporary directories.

Mortgage scraping requires an explicit local account selector through
`SPENDWISE_LEUMI_ACCOUNT_SUFFIX` or `--account-suffix`. Vite remote access uses
`SPENDWISE_ALLOWED_HOSTS`. Keep the values out of public documentation.

Legacy recovery tools excluded through `.git/info/exclude` remain local files.
They are not part of the maintained public toolchain; review their assumptions
before reuse. Preserve them during source cleanup.
