# SPEC-018: Design System & Theming

- **Spec ID**: SPEC-018
- **Version**: 2
- **Status**: current
- **Last Updated**: 2026-07-24

---

## Overview

SpendWise uses a dark-themed design system optimized for financial data readability. The system includes a defined color palette, typography scale, and reusable UI primitives.

## Color Palette

### Core Colors

- **Page background**: Deep navy (#0f172a)
- **Surface** (cards, inputs): Slate (#1e293b)
- **Surface-alt** (hover, headers): Medium slate (#334155)
- **Brand**: Indigo (#6366f1) for active states, buttons, highlights

### Semantic Colors

- **Expense/Negative**: Rose (#fb7185)
- **Income/Positive**: Emerald (#34d399)
- **Warning/Review**: Amber (#f59e0b)

### Gray Scale (6 tones)

Ranges from near-black (gray-10: #1e293b) to near-white (gray-100: #f1f5f9), used for borders, text hierarchy, and disabled states.

### Category Colors

40+ unique colors assigned to categories for consistent identification across charts, pills, dots, and badges. Each view mode (Routine, Home, Wedding) has its own color group.

## Typography

- System font stack (no custom fonts loaded)
- Monospace/tabular-nums for financial amounts (alignment and readability)
- Smaller superscript for decimal places in amounts
- Currency symbol (ILS) prefixed to all amounts

## Amount Display

Amounts follow a consistent format across the app:

- ILS currency symbol (₪) prefix
- Integer portion in normal weight
- Decimal portion in smaller, reduced-opacity text
- Right-aligned with tabular number spacing
- Red for expenses, green for income

## UI Primitives

Reusable components following shadcn/ui patterns:

- **Button**: 6 variants (default, outline, secondary, ghost, destructive, link) x 7 sizes
- **Badge**: Pill-shaped labels with custom color support
- **Card**: Container with header, content, footer sections
- **Input**: Text and date inputs with consistent styling
- **Select**: Styled dropdown with rounded corners
- **Table**: Responsive with header styling, row hover, overflow handling
- **Checkbox + Label**: For filter toggles

## Responsive Behavior

- **Mobile**: Icon-only navigation, horizontally scrollable header groups,
  scrollable tables, stacked cards, reduced page padding, and no floating
  developer tools over content
- **Tablet**: Full navigation labels, responsive chart widths
- **Desktop**: Full layouts, multi-column grids, expanded charts

## Interaction Patterns

- **Focus rings**: Visible on all interactive elements for keyboard navigation
- **Hover states**: Subtle background color changes
- **Transitions**: Smooth color transitions on interactive elements
- **Disabled state**: 50% opacity with no pointer events
