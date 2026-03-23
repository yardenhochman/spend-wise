# SPEC-017: Export & Reporting

- **Spec ID**: SPEC-017
- **Version**: 1
- **Status**: current
- **Last Updated**: 2026-02-28

---

## Overview

SpendWise can generate and export a spending analysis report as a downloadable document.

## Analysis Report

### Content

The generated report includes:

- **Date range**: Full period covered by the dataset
- **Transaction count**: Total transactions analyzed
- **Summary totals**: Total spend, total income, net balance
- **Monthly breakdown**: Spend and income per month
- **Category breakdown**: Total and monthly average per category
- **Top merchants**: Ranked by total spend amount

### Format

- Exported as Markdown (.md) file
- Downloadable via the "Export Analysis" button on the Insights page

### Scope

- Report reflects the currently active view mode (Routine/Home/Wedding)

## Save with Notes

Users can save an analysis snapshot with optional freetext notes. The saved report is stored locally alongside the database.
