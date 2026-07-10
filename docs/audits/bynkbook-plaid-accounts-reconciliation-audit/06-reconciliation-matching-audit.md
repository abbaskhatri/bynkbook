# Reconciliation and Matching Audit

## Current model

The current frontend uses `MatchGroup`, not the older `BankMatch` creation flow. A group is `ACTIVE` or `VOIDED`, has `INFLOW` or `OUTFLOW` direction, and contains one or more bank rows and one or more expected entries. Creation requires exact positive-cent totals on both sides; this is full-match-only. The user must explicitly apply a suggestion. Revert voids the group and retains an audit reason/user/time.

Expected entries and unmatched bank transactions are visually separated. After a full match, ledger/status queries derive matched activity from active groups and place it on the bank posting date. Refunds and transfers are treated through direction/entry semantics; there is no special Plaid-only transfer matcher.

## Matching behavior

- Exact/manual: supported, balanced, explicit.
- Automatic suggestion: deterministic candidate scoring/subset search, but explicit Apply is required.
- Partial: legacy `BankMatch` backend supports partial amounts, while the current UI and MatchGroup model say full-only. This dual model needs an explicit migration policy (BYNK-PLAID-AUDIT-016).
- Split/many-to-many: supported only when both selected sides balance exactly.
- Rematch: revert then create a new group; history is retained.
- Auto-reconcile input: only the first 250 expected entries are considered, so suggestions can be omitted (BYNK-PLAID-AUDIT-015).

## Correctness risk

Before inserting, the service checks whether each bank transaction and entry already belongs to an active group. The schema, however, has no unique constraint for active membership and `MatchGroupBank.bank_transaction_id` has no foreign key to `BankTransaction`. Two concurrent requests can both pass the read and create separate active groups (BYNK-PLAID-AUDIT-004). The missing foreign key also enables the opening-date orphan defect (BYNK-PLAID-AUDIT-002).

False positives are not silently applied, which limits exposure. A Plaid remove+add heuristic can nevertheless rekey a matched bank row to a different coincidental transaction and thereby preserve the wrong match (BYNK-PLAID-AUDIT-011).
