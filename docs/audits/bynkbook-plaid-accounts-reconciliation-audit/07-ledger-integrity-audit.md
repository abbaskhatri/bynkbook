# Ledger Integrity Audit

## Data flow and rules

Plaid transactions enter `BankTransaction`; they do not themselves create ordinary ledger `Entry` rows. Expected entries are planned records. An active, balanced `MatchGroup` connects bank facts to entries. Ledger queries use active groups, the bank posted date, entry type/direction, and positive matched cents. Reverting a group removes that derived matched state without deleting the underlying entry or bank row.

Opening balance is exceptional. Sync reads Plaid's current balance, sums retained signed bank transactions, and proposes the difference as an opening adjustment. Applying it creates or updates an opening entry and account opening fields. This flow has two direct integrity defects:

- The backend trusts `suggestedOpeningCents` from the request instead of recomputing/validating the preview (BYNK-PLAID-AUDIT-001).
- Plaid reports a credit account's current balance as a positive amount owed; the calculation does not normalize account type before treating the result as an asset-like balance (BYNK-PLAID-AUDIT-003; [Plaid balance semantics](https://plaid.com/docs/api/accounts/)).

Changing an opening date resets the cursor and hard-deletes older Plaid transactions. It checks only legacy `BankMatch` rows, not active MatchGroups. Because group bank links have no transaction foreign key, deletion can leave active audit links pointing to nonexistent transactions (BYNK-PLAID-AUDIT-002).

Ordinary Plaid-ID duplicates are database-constrained. Financial double-use is still possible through concurrent active-match creation (BYNK-PLAID-AUDIT-004). Removed unmatched Plaid rows are soft-removed. Removed matched rows stay active to preserve the ledger, but no independent source-removed marker communicates that conflict (BYNK-PLAID-AUDIT-014).

No production balance or orphan counts were obtained: the database resolved to private `10.10.11.235:5432`, and the read-only connection timed out before executing SQL. No claim about current production corruption is made.
