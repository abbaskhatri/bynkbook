# Mobile transaction and reconciliation audit

## Current workflow

Reconcile places expected ledger entries and bank transactions in two separate 560px tables, with summary/filter/tool bars above and manual/partial/history/snapshot/revert flows in dialogs. Source inspection confirms virtualization for the two large lists and keep-last-good refresh logic; those behaviors should remain.

## Task visibility gaps

| User question | Current friction | Required mobile answer |
|---|---|---|
| What needs attention? | Split tables, counters, tabs, filters | One unresolved queue grouped by action type/date |
| Why is this suggested? | Tooltip/dialog rationale | Visible reason, confidence, date/amount comparison |
| What amount is matched? | Columns/dialog state | Original/matched/remaining together |
| Which record is linked? | Opposite pane/dialog | Linked-record card with source label |
| What date/account is affected? | Separate columns | Review summary before confirmation |
| Does this change the ledger? | Consequence text varies by action | Explicit `Ledger effect` section |
| Is it reversible? | Revert lives elsewhere | Visible reversibility label and history link |
| Where will it move? | Table/tab transition | Success state names destination and next item |

## Canonical mobile flows

### Review an entry

List → open entire row → metadata/detail → action sheet or primary action → confirmation/success → back to same list anchor.

### Reconcile a transaction

Unresolved queue → transaction detail → suggestion card → linked record detail → confirm/reject → success → next unresolved item. Reject asks for no destructive side effect unless the existing backend action has one.

### Partial match

Transaction → allocate to one or more records → live original/matched/remaining summary → review ledger effect → confirm → `Partial match` detail with `Allocate remaining` action.

### Manual match

Transaction detail → Find record → searchable grouped candidate list → candidate detail → allocation/review → confirm. Candidate rows always show date, payee, amount, status, and source.

## Completed entry behavior

- Remove unresolved emphasis after success.
- Place the entry in normal chronological activity and matched history; do not duplicate it in unresolved lists.
- Preserve linked-record and audit history access.
- Return the user to the next unresolved item only when that queue mode was active.

## Recommended components

`TransactionRow`, `ExpectedEntryRow`, `MatchSuggestionCard`, `PartialMatchSummary`, `AllocationRow`, `LedgerEffectNotice`, `ReconcileSuccess`, and `NextUnresolvedBar` share amount/date/account/status primitives.

## Regression tests

Unmatched, full match, partial match, rematch, reject, source removed, stale sync, duplicate-looking records, transfer pair, refund/reversal, long payee, high amount, negative amount, empty queue, large queue, network failure during confirm, double-submit protection, and browser-back preservation.
