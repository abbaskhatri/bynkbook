# BynkBook Re-Audit — Executive Summary

Date: 2026-07-11  
Revision audited and deployed: `62328bf85fe7cf4884ed8a0a7a21fe5e81fbff3c`  
Audit branch: `codex/re-audit-plaid-ui-20260711`

## Bottom line

BynkBook is not yet flawless. The general build, dependency, queue, route, and regression baseline is healthy, but the production Plaid transaction path has a confirmed request-contract defect and Reconcile has two deterministic permanent-loading paths.

The primary Plaid failure is not a bank disconnect and not a missing-transaction condition. The deployed `/transactions/sync` call sends `account_id` at the request top level. Plaid production returns `UNKNOWN_FIELDS` with `the following fields are not recognized by this endpoint: account_id`. The installed Plaid SDK defines this field as `options.account_id`. The app's fallback does not recognize `UNKNOWN_FIELDS`, so sync returns HTTP 502 and leaves `has_new_transactions=true`.

In the 14-day production access-log window inspected, authenticated manual sync returned 502 26 times and 200 17 times. The currently deployed Lambda logged the exact `UNKNOWN_FIELDS` failure on 2026-07-11. Twelve signed Plaid webhook deliveries from Plaid's Go client returned 200, so the webhook URL and signature path are reachable; the handler logic after receipt is still too broad.

## Direct answers

- Why does Plaid appear to disconnect? Real re-authentication can legitimately be required after password/MFA/consent changes, but BynkBook also turns a transient status-fetch failure into a `Not connected` display. It ignores Plaid's US/Canada `PENDING_DISCONNECT` webhook, so it misses the proactive warning and may only surface the later failure.
- Can multiple accounts be connected? Yes. Initial Link supports selecting several accounts from one Item, creates separate BynkBook accounts atomically, keeps one mapping per Plaid account, and reconnect repairs live siblings. Adding accounts later through Plaid update mode is not fully implemented.
- Why does sync fail? The current production failure is the wrong `/transactions/sync` request shape. It is independent of whether transactions exist.
- Why does `Updates available` stay visible? Any `TRANSACTIONS` webhook sets the flag, even webhook codes that should not drive `/transactions/sync`; failed sync intentionally does not clear the flag. Combined with the request-shape failure, the badge persists.
- Is the webhook broken? Delivery is working, but event classification is incorrect and the new SQS worker has not yet received a post-deployment production webhook, so the complete webhook-to-worker path is not yet proven.
- Why does Reconcile keep loading? The ledger background-pagination effect cancels itself when it sets its loading state and then skips both state commit and loading cleanup. Reconciliation history also renders an endless skeleton after an API error because failure clears hydration without rendering an error state.

## Verified healthy

- Canonical app and API are deployed at `app.bynkbook.com` and `cpjh7t19u1.execute-api.us-east-1.amazonaws.com`.
- Plaid webhook route is unauthenticated at API Gateway and validates Plaid JWT signatures in Lambda.
- Link tokens use the canonical production webhook URL and production Plaid environment.
- SQS worker mapping is enabled with partial-batch failure handling; main queue and DLQ were empty at inspection.
- Multi-account creation is transactional and duplicate Plaid account mappings are database constrained.
- Web build, TypeScript, lint, 300 tests, and production dependency audits pass.
- Production Reconcile runtime had no failed responses or console errors in the synthetic read-only browser run.
- Mobile 390px and desktop 1440px had no page-level horizontal overflow.

## Release position

The Plaid sync contract defect and Reconcile permanent-loading defect should be treated as release-blocking for reliable bank-feed reconciliation. The carried legal, alert-delivery, legacy data-migration, and live-resource naming gaps remain open.

