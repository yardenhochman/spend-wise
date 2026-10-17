# SpendWise Product Specifications

## How This System Works

Each feature area has its own spec file with a unique ID, version, and status. This structure supports parallel development with multiple agents.

### Workflow for Making Changes

1. **Read** the current spec for the feature you're changing
2. **Copy** the spec file to a new version: `SPEC-XXX.v2.md`
3. **Set status** to `in-progress` in the new version
4. **Implement** the changes described in the updated spec
5. **Replace** the original spec with the new version once implementation is complete
6. **Set status** to `current`

### Spec File Format

Every spec follows this structure:

```
- **Spec ID**: SPEC-XXX
- **Version**: 1
- **Status**: current | in-progress | deprecated
- **Last Updated**: YYYY-MM-DD
```

### Status Definitions

| Status        | Meaning                                          |
| ------------- | ------------------------------------------------ |
| `current`     | Reflects the live product as-is                  |
| `in-progress` | Being actively changed — implementation underway |
| `deprecated`  | Replaced by a newer spec version                 |

### Locking

When an agent begins work on a spec, it sets status to `in-progress`. Other agents should not modify an `in-progress` spec — work on a different feature or wait.

---

## Spec Registry

| Spec ID  | File                                                              | Feature Area                          | Status     | Version |
| -------- | ----------------------------------------------------------------- | ------------------------------------- | ---------- | ------- |
| SPEC-001 | [navigation.md](./SPEC-001-navigation.md)                         | Navigation & Information Architecture | current    | 4       |
| SPEC-002 | [data-import.md](./SPEC-002-data-import.md)                       | Data Import & Parsing                 | current    | 5       |
| SPEC-003 | [deduplication.md](./SPEC-003-deduplication.md)                   | Deduplication                         | current    | 1       |
| SPEC-004 | [categorization.md](./SPEC-004-categorization.md)                 | Categorization & Rules                | current    | 1       |
| SPEC-005 | [tags.md](./SPEC-005-tags.md)                                     | Tags & Sub-Segments                   | current    | 2       |
| SPEC-006 | [view-modes.md](./SPEC-006-view-modes.md)                         | Legacy cashflow (home superseded)     | deprecated | 4       |
| SPEC-007 | [transactions.md](./SPEC-007-transactions.md)                     | Transaction Management                | current    | 2       |
| SPEC-008 | [insights.md](./SPEC-008-insights.md)                             | Insights & Analytics                  | current    | 5       |
| SPEC-009 | [recurring.md](./SPEC-009-recurring.md)                           | Recurring & Subscriptions             | current    | 2       |
| SPEC-010 | [review.md](./SPEC-010-review.md)                                 | Data Quality Review                   | current    | 1       |
| SPEC-011 | [actions.md](./SPEC-011-actions.md)                               | Actions & Recommendations             | current    | 1       |
| SPEC-012 | [search.md](./SPEC-012-search.md)                                 | Search & Command Palette              | current    | 1       |
| SPEC-013 | [merchant-normalization.md](./SPEC-013-merchant-normalization.md) | Merchant Normalization                | current    | 1       |
| SPEC-014 | [internal-transactions.md](./SPEC-014-internal-transactions.md)   | Internal Transaction Handling         | current    | 1       |
| SPEC-015 | [cash-allocations.md](./SPEC-015-cash-allocations.md)             | Cash Allocations & Budgeting          | current    | 1       |
| SPEC-016 | [spread.md](./SPEC-016-spread.md)                                 | Billing Spread / Amortization         | current    | 1       |
| SPEC-017 | [export.md](./SPEC-017-export.md)                                 | Export & Reporting                    | current    | 1       |
| SPEC-018 | [design-system.md](./SPEC-018-design-system.md)                   | Design System & Theming               | current    | 2       |
| SPEC-019 | [home-modes.md](./SPEC-019-home-modes.md)                         | Household Home Modes                  | current    | 1       |
