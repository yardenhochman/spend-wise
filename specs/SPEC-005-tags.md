# SPEC-005: Tags & Sub-Segments

- **Spec ID**: SPEC-005
- **Version**: 1
- **Status**: current
- **Last Updated**: 2026-02-28

---

## Overview

Tags are the second dimension of transaction classification. While categories answer "what for?" (e.g., Groceries), tags answer "in what context or sub-type?" (e.g., shuk, supermarket, delivery).

A transaction can have multiple tags. Tags are color-coded.

## Tag Types

### Auto-Applied Sub-Segment Tags

Applied automatically via merchant pattern rules. These break categories into meaningful sub-groups:

**Groceries sub-segments**: shuk (market), supermarket, convenience, specialty (butcher, cheese, fish)

**Dining sub-segments**: delivery, bakery, bar, cafe, cafeteria, street-food, restaurant

**Transport sub-segments**: scooter, car-share, taxi, public-transit, parking, car (fines)

**Other sub-segments**: pharmacy (Healthcare), clothing (Shopping), gym (Sports & Fitness), gaming (Entertainment)

### Context Tags (Manual)

Applied manually by users to add context:

- **one-time**: Large irregular expenses not representative of monthly spending
- **reimbursable**: Expenses that will be or have been reimbursed
- **tax-deductible**: Expenses eligible for tax deduction

## Tag Management

- Users can create new tags with a custom name and color
- Tags can be added to or removed from transactions inline on the Transactions and Review pages
- Creating a tag from the transaction row auto-assigns it to that transaction
- Deleting a tag removes it from all associated transactions

## Auto-Tagging Rules

Tag rules define patterns that automatically assign tags to matching transactions:

- Rules match by merchant pattern (contains/exact/regex)
- Rules can be scoped to a specific category (e.g., "delivery" tag only applies within "Dining")
- Applied idempotently — safe to re-run without creating duplicates
