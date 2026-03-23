# SPEC-011: Actions & Recommendations

- **Spec ID**: SPEC-011
- **Version**: 1
- **Status**: current
- **Last Updated**: 2026-02-28

---

## Overview

The Actions page presents curated, actionable financial recommendations based on the user's spending data. All content is informational (read-only) — the user takes action outside the app.

## Recommendation Types

### Spending Anomaly Alerts

- Flags specific transactions or bills that are unusually high
- Provides investigation steps and relevant contact information
- Example: Water bill spike with utility company phone number

### Service Optimization

- Identifies subscriptions and services where the user may be overpaying
- Compares current cost to alternatives
- Provides cancellation contacts and steps
- Examples: Mobile plan comparison, water cooler rental vs. purchase, unused landline

### Overlap Detection

- Identifies potentially redundant services
- Examples: Multiple health insurance policies, Spotify + YouTube Premium music overlap
- Suggests audit steps to identify and eliminate overlap

### Spending Trend Analysis

- Visual comparisons of related spending categories over time
- Custom charts showing behavioral shifts
- Example: Dining vs. Groceries trend (bar chart showing 12-month history, highlighting travel months)

### Strategic Planning

- Forward-looking recommendations not tied to specific transactions
- Example: Sale calendar with major e-commerce events and optimal purchase timing
- Example: Two-card credit card strategy with specific card recommendations

## Card Format

Each recommendation is presented as a card with:

- Icon and color theme
- Title describing the recommendation
- Body content (text, tables, numbered steps, or charts as appropriate)
- Contact numbers or action items where relevant

## Content Characteristics

- All recommendations are curated (not auto-generated)
- Amounts reference actual user spending data
- Phone numbers and specific service details are included for actionability
- Savings potential is quantified where possible
