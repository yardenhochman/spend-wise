# SPEC-007: Transaction Management

- **Spec ID**: SPEC-007
- **Version**: 1
- **Status**: current
- **Last Updated**: 2026-02-28

---

## Overview

The Transactions page (Search) is the primary interface for browsing, filtering, and editing individual transactions. It supports full-text search, multi-criteria filtering, inline editing, and pagination.

## Browsing & Filtering

### Search

- Full-text merchant name search
- Debounced input — results update as the user types

### Filters

- **Category**: Dropdown to filter by any single category or "All"
- **Date range**: From/To date inputs (inclusive)
- **Hide internal**: Checkbox to exclude internal transfers, CC payments, and currency conversions

### Sorting

- Sortable by: Date, Amount, Merchant
- Click column header to sort; click again to reverse direction
- Visual indicator (chevron) shows current sort column and direction

### Pagination

- 50 transactions per page
- Shows "Showing X-Y of Z" count
- Previous/Next navigation buttons

## Transaction Display

Each transaction row shows:

| Field    | Description                                                               |
| -------- | ------------------------------------------------------------------------- |
| Date     | Transaction date (YYYY-MM-DD)                                             |
| Merchant | Merchant name (supports Hebrew, right-to-left)                            |
| Amount   | Color-coded: red for expenses, green for income. Monospace, right-aligned |
| Category | Color-coded pill with category dot                                        |
| Tags     | Row of colored badges                                                     |
| Notes    | User-added freetext annotation                                            |

## Inline Editing

### Category Reassignment

- Click the category pill to open a dropdown
- Select a new category from the full list
- Change is saved immediately

### Tag Management

- Existing tags shown as colored badges with remove (X) button
- Plus button opens a dropdown of available tags
- Can create a new tag inline (type name + Enter)
- Adding/removing tags saves immediately

### Notes

- Click the notes cell to enter edit mode
- Type text and press Enter to save, Escape to cancel
- Empty notes display as a dash

### Billing Spread

- Calendar icon button per transaction
- Dropdown offers: 2, 3, 6, or 12 month spread options, plus Clear
- Sets the spread period for amortization (see SPEC-016)

## Utility Actions

- **Copy transaction ID**: Button copies the transaction's unique ID to clipboard (shows confirmation checkmark)

## Deep Link Support

- URL parameter `category_id` pre-selects the category filter
- URL parameter `q` pre-fills the search input
- Navigation from other pages (e.g., clicking a category in Insights) uses these parameters

## Data Indicators

- Transactions flagged for review show an amber left border
- Internal transactions display at reduced opacity with an "Internal" badge
