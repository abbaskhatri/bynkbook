# Reconnection and Recovery Audit

Connection failures are recorded on `BankConnection` with code/message/status. Item/login-required errors surface a reconnect UI. The frontend requests a Link token in update mode, and the backend uses the existing encrypted access token; this preserves the same Item and its transaction history.

After Link succeeds, repair fetches `/accounts/get`, requires the selected ID to be live on that Item, prevents a same-business duplicate mapping, resets the selected cursor, and clears stale reconnect state for live sibling mappings. This is materially better than creating a new Item.

The recovery defect is identity validation: any live sibling account can be selected. The backend does not compare stored mask, account type/subtype, currency, or immutable prior identity. A checking ledger can therefore be redirected to another live account on the Item (BYNK-PLAID-AUDIT-005). The next sync then intentionally starts from a cleared cursor, potentially mixing feed history into the wrong local ledger.

Recovery also depends on a human returning to Bynkbook. Webhooks do not enqueue sync, and no scheduled retry exists (BYNK-PLAID-AUDIT-006). A capped recovery sync needs another manual call (BYNK-PLAID-AUDIT-007).

Safe conclusions:

- Same-Item credential repair: implemented and unit-tested.
- Live-account verification: implemented.
- Duplicate same-business Plaid account mapping: constrained.
- Account identity compatibility: not implemented.
- Automatic post-webhook recovery drain: not implemented.
- Authenticated production reconnect: not tested; no test user or safe Plaid Item was supplied.
