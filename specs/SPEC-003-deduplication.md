# SPEC-003: Deduplication

- **Spec ID**: SPEC-003
- **Version**: 1
- **Status**: current
- **Last Updated**: 2026-02-28

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
