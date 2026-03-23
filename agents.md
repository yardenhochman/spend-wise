# SpendWise — Agent Workflow Guide

## Overview

SpendWise uses product specs (`specs/`) as the source of truth for what the app does. Agents implementing features must read, update, and respect these specs. This guide defines how agents interact with the spec system and with each other.

## Specs Directory

```
specs/
  README.md              # Registry of all specs + workflow instructions
  SPEC-001-navigation.md
  SPEC-002-data-import.md
  ...
  SPEC-018-design-system.md
```

Each spec has a unique ID (`SPEC-XXX`), version number, and status (`current`, `in-progress`, `deprecated`).

Full registry: [`specs/README.md`](./specs/README.md)

---

## Feature Work Lifecycle

### 1. Claim the Spec

Before implementing a feature change, read the relevant spec(s) and understand the current product behavior.

```
# Copy the current spec to a versioned working file
cp specs/SPEC-008-insights.md specs/SPEC-008-insights.v2.md
```

Update the header in the **new version**:

```markdown
- **Version**: 2
- **Status**: in-progress
- **Last Updated**: <today>
```

Update the registry in `specs/README.md` to add a row for the v2 file with status `in-progress`.

> **Locking rule**: An `in-progress` spec is owned by one agent. Other agents must not modify it. If you need to change a spec that is `in-progress`, work on a different feature or coordinate with the owning agent.

### 2. Write the Spec Changes

Edit the `.v2.md` file to describe the **desired** product behavior after your changes. This is what you're building toward. Keep it product-focused — no implementation details.

Changes should be clearly motivated:
- What new behavior is being added?
- What existing behavior is changing?
- What stays the same?

### 3. Implement

Build the feature to match the updated spec. Use `CLAUDE.md` for technical guidance (architecture, file locations, tooling).

### 4. Finalize

Once implementation is complete and verified:

```
# Replace the current spec with the new version
mv specs/SPEC-008-insights.v2.md specs/SPEC-008-insights.md
```

Update the header:

```markdown
- **Status**: current
```

Update `specs/README.md` to reflect the new version number and remove the v2 row.

---

## Agent Roles

### Feature Agent

**Trigger**: User requests a new feature or change to existing behavior.

**Workflow**:
1. Identify which spec(s) are affected
2. Read the current spec(s) to understand existing behavior
3. Claim the spec (copy → v2, set `in-progress`)
4. Write the spec changes first, then implement
5. Finalize the spec when done

**Key files**:
- `specs/SPEC-*.md` — what to build
- `CLAUDE.md` — how to build it (tech stack, file locations, conventions)

### Categorization Agent

**Trigger**: New transactions imported with missing categories.

**Workflow**: See [`subagents/categorize.md`](./subagents/categorize.md)

**Summary**:
1. Extract uncategorized merchants from DB
2. Classify merchants in batches by name, amount, and frequency signals
3. Apply categories via SQL (confidence > 70% only)
4. Leave ambiguous merchants for manual user review

**Specs involved**: SPEC-004 (Categorization & Rules), SPEC-005 (Tags & Sub-Segments)

### Review Agent

**Trigger**: User asks to audit data quality or fix categorization issues.

**Workflow**:
1. Read SPEC-010 (Data Quality Review) to understand the flag types
2. Query the review endpoint for flagged transactions
3. Propose fixes (category reassignment, internal flagging, tag application)
4. Apply fixes after user confirmation

**Specs involved**: SPEC-010 (Review), SPEC-004 (Categorization), SPEC-014 (Internal Transactions)

### Analytics Agent

**Trigger**: User asks questions about their spending, trends, or patterns.

**Workflow**:
1. Read SPEC-008 (Insights) and SPEC-006 (View Modes) to understand available data
2. Query the appropriate API endpoints
3. Present findings in the context of the active view mode
4. Reference SPEC-009 (Recurring) for subscription analysis, SPEC-016 (Spread) for amortization context

---

## Coordination Rules

### Parallel Work

Multiple agents can work simultaneously as long as they claim **different** specs. The `in-progress` status in `specs/README.md` acts as a lightweight lock.

**Safe to parallelize**:
- Agent A works on SPEC-008 (Insights) while Agent B works on SPEC-012 (Search)
- One agent implements while another reviews data quality

**Must serialize**:
- Two agents both need to change SPEC-007 (Transactions) — one must wait
- A feature touches both SPEC-004 and SPEC-005 — one agent claims both

### Spec Dependencies

Some specs reference others. When changing a spec, check if dependent specs need updating:

| If you change... | Also check... |
|---|---|
| SPEC-004 (Categorization) | SPEC-005 (Tags), SPEC-006 (View Modes), SPEC-008 (Insights) |
| SPEC-006 (View Modes) | SPEC-008 (Insights), SPEC-009 (Recurring) |
| SPEC-002 (Data Import) | SPEC-003 (Deduplication), SPEC-004 (Categorization) |
| SPEC-007 (Transactions) | SPEC-010 (Review), SPEC-008 (Insights) |
| SPEC-018 (Design System) | All UI-facing specs |

### Reading vs. Writing

- **Any agent can read any spec at any time** — specs are the shared understanding of the product
- **Only the claiming agent writes to an `in-progress` spec**
- **`current` specs are immutable** — copy to a new version before editing

---

## Quick Reference

| Task | Start here |
|---|---|
| Add a new feature | Read affected spec → claim → write spec changes → implement → finalize |
| Fix a bug | Read affected spec to understand expected behavior → fix → no spec change needed unless behavior was wrong |
| Categorize transactions | `subagents/categorize.md` |
| Understand what the app does | `specs/README.md` → individual spec files |
| Understand how to build | `CLAUDE.md` |
| Add a new category | SPEC-004 + checklist in `CLAUDE.md` ("Adding Categories") |
| Change the design system | SPEC-018 + `src/styles.css` + `src/lib/constants.ts` |
