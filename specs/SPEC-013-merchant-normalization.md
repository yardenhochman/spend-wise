# SPEC-013: Merchant Normalization

- **Spec ID**: SPEC-013
- **Version**: 2
- **Status**: current
- **Last Updated**: 2026-10-17

---

## Overview

Bank statements frequently show the same merchant with different name fragments (e.g., "BIRD RIDE", "BIRD RIDES", "Bird scooter"). Merchant normalization unifies these variants under a single canonical name for consistent categorization and analytics.

## Alias System

An alias maps a raw pattern to a canonical merchant name.

### Properties

- **Raw pattern**: The text fragment to match in merchant names
- **Canonical name**: The unified name to display and use
- **Match type**: `contains` or `exact`

### Current Alias Groups

| Canonical Name  | Variants Covered                                          |
| --------------- | --------------------------------------------------------- |
| BIRD Scooter    | BIRD RIDE, BIRD RIDES, Bird scooter                       |
| Dott Scooter    | DOTT SCOOTER RIDE, Dott scooter ride, Dott trip auth hold |
| TIER Scooter    | TIER\_, TIER MOBILITY, Tier Mobility                      |
| WIND Scooter    | WIND.CO, Wind.co                                          |
| AliExpress      | ALIEXPRESS, aliexpress                                    |
| YouTube Premium | Google YouTubePremium, GOOGLE YOUTUBEPREMIUM              |
| Spotify         | SpotifyIL, SPOTIFYIL                                      |
| Rav-Kav         | מ.תחבורה - רב-פס, מ.תחבורה ? רב-פס                        |
| Globes Online   | גלובס און ליין, גלובס - און ליין                          |
| BIT Transfer    | BIT ביט, העברת ביט, ביט BIT                               |
| Paybox          | פייבוקס, PAYBOX                                           |

## Normalization During Dedup

During hash generation for deduplication, merchant names are also normalized:

- Card/account number suffixes stripped (e.g., "פלאפל כרטיס 4" -> "פלאפל")
- Extra whitespace collapsed
- Newlines removed

## Management

Seeded aliases provide defaults; users can override or clear their own exact merchant labels.

## User merchant labels

Users can rename a merchant from a transaction, recurring charge, Runway event or obligation. A user label matches the entire normalized bank name (case and whitespace insensitive, with bank account/card suffixes removed). It applies retroactively and to future matching transactions. Exact user labels take priority over seeded aliases, including service defaults. Clearing a label restores seeded alias resolution or the original bank name. Labels never change transaction identity, bank names, deduplication or obligation matching rules.

The human label is primary; the original bank name remains available as secondary text. Search matches both bank names and resolved labels. Blank labels are rejected; users explicitly clear labels instead.
