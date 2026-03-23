# SPEC-012: Search & Command Palette

- **Spec ID**: SPEC-012
- **Version**: 1
- **Status**: current
- **Last Updated**: 2026-02-28

---

## Overview

SpendWise provides a global command palette for quick navigation and search across the entire application. It is accessible from any page.

## Activation

- Keyboard shortcut: Cmd+K (Mac) / Ctrl+K (Windows/Linux)
- Click the search trigger button in the header

## Search Behavior

- Text input with debounced search (200ms delay)
- Minimum 2 characters to trigger API search
- Results update incrementally as the user types
- Empty query shows page navigation links only

## Result Categories

### Pages (Always Shown)

Quick links to all six app pages, filtered by query text:

- Insights, Recurring, Actions, Review, Search, Import Statement

### Categories (On Match)

- Categories whose names match the query
- Each result shows the category name
- Clicking navigates to `/transactions?category_id=X`

### Merchants (On Match)

- Merchants whose names match the query
- Each result shows: merchant name, associated category, transaction count
- Clicking navigates to `/transactions?q=<merchant_name>`

## Keyboard Navigation

| Key           | Action                          |
| ------------- | ------------------------------- |
| Arrow Up/Down | Move selection through results  |
| Enter         | Navigate to the selected result |
| Escape        | Close the palette               |

## Visual Behavior

- Modal overlay with backdrop blur
- Auto-focuses the input field on open
- Selected result highlighted with brand color
- Results grouped by type with section headers
- Scrollable if results exceed visible area
- Footer shows keyboard shortcut hints
