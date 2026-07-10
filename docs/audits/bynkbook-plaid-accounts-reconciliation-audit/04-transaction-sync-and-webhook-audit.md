# Transaction Sync and Webhook Audit

## Cursor, pagination, and idempotency

Each `BankConnection` stores an account-specific packed cursor and sync calls Plaid with `account_id`. The code restarts pagination after a Plaid mutation-during-pagination error. It processes added, modified, and removed arrays. `BankTransaction` has unique `(business_id, plaid_transaction_id)` and CSV-deduplication constraints. These controls strongly reduce ordinary duplicates.

Pending-to-posted identity is handled by finding the existing `pending_transaction_id` row and replacing its Plaid ID/data. A second heuristic handles remove+add replacements using exact amount, date, and normalized name; ambiguity is rejected, but a unique coincidental match can carry the wrong durable identity (BYNK-PLAID-AUDIT-011).

Matched removed transactions are deliberately restored to active rather than marked removed, preserving ledger audit continuity but obscuring source-removal state (BYNK-PLAID-AUDIT-014).

## Missed or delayed transaction risks

- A call stops at 20 pages or 5,000 updates, persists the partial cursor, returns `capped/hasMore`, and clears `has_new_transactions`. The frontend does not loop until complete (BYNK-PLAID-AUDIT-007).
- During the first full drain, if local history already reaches past the effective start, new Plaid rows at or before the latest local date are skipped. This protects CSV overlap but can preserve gaps (BYNK-PLAID-AUDIT-008).
- A valid `SYNC_UPDATES_AVAILABLE` webhook only sets `has_new_transactions=true`. There is no queue, worker, schedule, or retry drain (BYNK-PLAID-AUDIT-006).

The webhook endpoint itself is well defended: it fetches the Plaid JWK, validates ES256 signature and a five-minute `iat` window, hashes the raw body, and compares the hash safely. Item error webhooks mark reconnect-required state. Plaid webhook delivery retry exists externally, but Bynkbook has no internal durable job once the flag is stored. See [Plaid webhook behavior](https://plaid.com/docs/api/webhooks/) and [Transactions sync guidance](https://plaid.com/docs/transactions/).

Concurrency is weakest in reconciliation rather than Plaid-ID insertion: database uniqueness protects Plaid IDs, while active match membership is only read-checked (BYNK-PLAID-AUDIT-004).
