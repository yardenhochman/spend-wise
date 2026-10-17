# SpendWise

Codex should use the same project guidance that Claude used.

Read these before making changes:

1. `CLAUDE.md` - technical architecture, conventions, commands, key files.
2. `agents.md` - spec-first workflow, feature claiming, and coordination rules.
3. `specs/README.md` - product spec registry.

Important rules:

- SpendWise is an Israeli household expense tracker for tracking income, expenses, and financial commitments.
- The app is local-first: TanStack Start frontend, Express/SQLite backend, and
  local DB under `data/spend-wise.sqlite`.
- Product behavior is governed by `specs/SPEC-*.md`; read the relevant spec
  before feature work.
- For feature changes, follow `agents.md`: claim the affected spec, write the
  spec change first, then implement.
- For categorization work, use `subagents/categorize.md`.
- For live Leumi/Card/Mortgage refreshes and Tailscale access, use
  `docs/runbooks/financial-refresh.md`.
- Do not expose or commit private financial data. Keep private overlays in
  `private/spendwise.private.json` or `SPENDWISE_PRIVATE_CONFIG_PATH`.
