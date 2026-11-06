# SPEC-020: Agent Access (Read-Only MCP)

- **Spec ID**: SPEC-020
- **Version**: 2
- **Status**: current
- **Last Updated**: 2026-11-06

---

## Overview

The household can ask an AI agent plain questions about its money and get answers it can check. SpendWise offers a Model Context Protocol server with read-only tools over the same household figures the home screen uses. Judge answers by the household goal: raise income outside career, lower expenses, keep quality of life. Lead with money lost for no gain before suggesting restraint.

## Questions Answered

| Question | Tool |
| --- | --- |
| Where did the money go this month? | `where_money_went` |
| Is that more than usual? | `compare_to_usual` |
| What's left before payday? | `left_before_payday` |
| Does anything look off? | `anything_off` |
| Which transactions support this figure? | `transactions_for_figure` |

There are no write tools. Nothing an agent does through this server can categorize, label, confirm, dismiss, import or otherwise change data.

## Every Answer

- States the date it was computed, the latest transaction per account, how current checking and cards are, the last import and the balance date. Stale data, as Home defines it, produces a visible warning.
- Returns evidence rows: date, merchant, posted amount, amount counted in the figure, category and account. Forecast figures return forecast rows marked as estimated, with the balance snapshots and the most recent transaction behind each forecast row.
- Each figure names the exact `transactions_for_figure` request that lists its rows. Those rows add up to the figure.
- A finding that has no transaction behind it (a stale import, for example) says so instead of implying evidence.
- A missing balance is unknown, never zero. An unknown next salary is said plainly.

## Scope

- Household accounts only, using the same fail-closed allowlist as Home. The building committee account never appears, in any tool or search.
- Internal transfers and card settlement debits are excluded so nothing counts twice.
- `routine` is everyday spending, matching Home. `outside_routine` is other real outflows such as mortgage, loans and projects. Answers show both, so the routine total is never mistaken for everything that left the account.
- Account numbers and transaction notes are not returned, except the payee name on a generic bank transfer, as on Home. Long digit runs in merchant names are masked.

## Figures

- Spending is the sum of outflows. Money coming in, including refunds, is reported separately, as on Insights.
- A billing-spread payment counts evenly across its spread months, as on Insights. Its row shows both the posted amount and the amount counted.
- A partial month compares like with like: spending through the same day of the month, in each of the six preceding months, using the median as usual. The comparison stops at the latest day with data, so slow card imports do not read as lower spending. Above or below usual needs at least a 25% and ₪100 difference, as on Brief. Fewer than three comparison months is reported as not enough history. When more than 30% of comparison transactions are uncategorized, category comparisons are marked unreliable.
- `anything_off` returns Brief's notices, including its possible double charges and fees or interest (SPEC-019 owns those rules), plus late commitments. It can miss a smaller notice that Brief's limit of five crowds out, and it cannot tell whether a subscription is used.
- Two spellings of one card purchase can be imported as duplicates, so spending answers warn that figures can run slightly high.

## Access

- Reachable only inside the private network, never on a public Funnel. A request that arrives through Funnel is refused even if Funnel is turned on by mistake.
- Every request, including health, requires a bearer token. Unknown hosts and browser origins are refused.
- Agent chats get these tools by project, not everywhere, so a chat browsing untrusted content does not hold them.
- The server log records the tool, argument names and row counts. It never records amounts, merchants or search text.

## Privacy: What Is and Is Not Enforced

Enforced by the server:

- Read-only database connection; there are no write tools.
- Household scope, data minimization, tailnet-only reach, token, Funnel refusal and data-free logs, as above.

Requested but not enforceable by the server (each answer and the server instructions state these as handling rules; the client decides):

- **Keep linked-account chats out of memory and search.** The server cannot see or control the client. Answers reach the model provider, the client's transcript and any chat search built on it. Claude Code and T3 store them on disk and T3 search can find them. An agent can write them to memory.
- **Confirm before publishing.** The server cannot see what an agent does with an answer. An agent with publishing tools can publish without asking.
- **Who reads it.** Anyone holding the token inside the tailnet can read everything these tools expose.

Enforcing the first two needs client-side rules in the agent tooling, outside this product.

## What Stays the Same

Web app behavior and data are unchanged. Brief's “Ask an agent” button is replaced by these tools. Its removal is a SPEC-019 change.
