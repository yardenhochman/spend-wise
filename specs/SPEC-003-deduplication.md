# SPEC-003: Deduplication

- **Spec ID**: SPEC-003
- **Version**: 2
- **Status**: current
- **Last Updated**: 2026-11-06

---

## Overview

SpendWise uses a three-layer deduplication system to prevent double-counting transactions, even when the same transaction appears across different data sources (e.g., multiple bank PDFs or statement exports).

## Layer 1: Normalized Hash

Every transaction generates a deterministic hash from three fields:

- **Date** (YYYY-MM-DD)
- **Amount** (normalized to integer agorot to avoid float precision issues)
- **Merchant** (normalized: card/account suffixes stripped, whitespace collapsed)

If two transactions from any source produce the same hash, they are considered duplicates.

## Layer 2: Fuzzy Cross-Source Matching

Catches near-duplicates where exact hashing fails due to source differences:

- **Date tolerance**: Exact match or +/- 1 day (settlement vs. transaction date)
- **Amount tolerance**: Within 0.50 ILS (rounding differences across sources)
- **Merchant**: Exact match after normalization

This layer handles the common case where different sources report the same transaction on slightly different dates (e.g., settlement date vs. transaction date).

## Layer 3: Database Constraint

A unique index on the hash column serves as a final safety net. If both Layer 1 and Layer 2 miss a duplicate, the database rejects the insert silently.

## Idempotency

- Importing the same file multiple times produces the same result
- Running CLI import scripts repeatedly is safe
- Import summaries report how many duplicates were skipped

## Hash Migration

On first startup, all existing transactions are rehashed with the current normalization rules and exact duplicates are removed. This ensures consistency if normalization logic has been refined.

## Merged Duplicates

One purchase can be stored twice under two spellings when an earlier import saw a different name than the posted statement.

- Two rows merge only with the same date and amount, two different spellings, no conflicting categories, and the bank's own record showing exactly one charge. Two posted charges are two purchases. Identical strings and rows on two different cards never merge.
- When one row has no card, its name must be the other name cut short, or differ only by a mirrored bracket. Rows with no card on either side are listed for a person, as are pairs the bank record cannot confirm.
- The categorized row is kept, then a Hebrew name, then the row with a card. Tags, links, notes, valuation and spread settings move to it.
- A merged row keeps its import identity, so later imports treat it as still present and cannot re-create it.
- Checking-ledger card settlements are not merged. Home already counts them once.
- A merge records what it removed, so it can be undone.
