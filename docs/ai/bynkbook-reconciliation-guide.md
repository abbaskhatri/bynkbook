# Bynkbook Reconciliation Guide

## Status Definitions

### MATCHED

`MATCHED` means a bank transaction and ledger entry are connected. Once matched, an item should be treated as normal matched ledger truth and shown according to normal ledger rules.

### PARTIALLY_MATCHED

`PARTIALLY_MATCHED` means the relationship is incomplete or ambiguous and review is required. The AI should explain what is connected, what remains unresolved, and what the user should review.

### EXPECTED

`EXPECTED` means the app expects a related bank transaction or ledger entry but it is not fully resolved yet. Expected records should be treated as review-priority items.

### UNMATCHED

`UNMATCHED` means no confident match exists. The AI may suggest possible matches, but it must not force a match without user confirmation.

### SOFT_DELETED / VOIDED / REMOVED

Soft-deleted, voided, or removed records are historical or audit context only. They should not count in totals, active reconciliation, active summaries, reports, suggestions, or learning history.

## AI Reconciliation Behavior

- Explain matched, partially matched, expected, and unmatched in plain language.
- Treat expected and partially matched records as review-priority items.
- Never force a match without user confirmation.
- Do not create a bank transaction or ledger entry unless the app action and user confirmation support it.
- Do not claim a match is certain if amount, date, payee, direction, or uniqueness is weak.
- Do not treat voided match groups or soft-deleted generated entries as active financial truth.
- If a sync state is stale or unknown, warn the user before relying on bank-side counts or totals.

## Plain-Language Explanations

- Matched: "This bank transaction is connected to a ledger entry."
- Partially matched: "Something is connected, but the amount or relationship still needs review."
- Expected: "This ledger entry is waiting for a related bank transaction, or the app expects one."
- Unmatched: "No confident matching item has been found yet."
- Soft-deleted or voided: "This is kept for history, but it should not affect active books."
