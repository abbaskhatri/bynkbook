# BynkBook Exhaustive Operational Audit — Control Matrix

Status: **IN PROGRESS**  
Baseline commit: `e4d111db30079ae622e7a9cb22a3c4790cd01c6c`  
Canonical production app: `https://app.bynkbook.com`  
Canonical production API: `https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com`

## Evidence levels

No workflow may be called fixed or verified without naming its evidence level.

1. `STATIC`: code/config inspection only.
2. `UNIT`: isolated automated test with mocks.
3. `INTEGRATION`: real frontend/backend/database in a disposable environment or QA fixture.
4. `PRODUCTION_READ_ONLY`: authenticated production execution without mutation.
5. `PRODUCTION_QA_MUTATION`: complete create/change/retry/cleanup sequence in the test-only business.
6. `EXTERNAL_PROVIDER`: real Plaid/Cognito/S3/email/provider round trip.

Passing a lower level never implies a higher level passed.

## Mandatory sequence coverage

| Domain | Required sequences | Current state |
|---|---|---|
| Authentication | sign up, confirm, login, refresh, expiry, logout, reset, OAuth callback, invite acceptance | Pending |
| Business/account scope | business switch, account switch, archived account, all-accounts scope, deep link, stale query cache | Pending |
| Dashboard | cold load, warm load, partial API failure, account switch, issue/category count refresh | Read-only route pass only |
| Accounts | create, edit, archive, unarchive, delete eligibility, blocked delete, opening balance | Pending |
| Plaid | new Item, multi-account Item, sequential account add, reconnect A→B→A, account-id replacement, webhook, sync lease, cursor continuation, disconnect | Provider coverage pending; static/unit evidence exists |
| Bank transactions | Plaid import, CSV import, retry, overlap cleanup, pending→posted, modified, removed, duplicate replay | Pending production-QA sequence |
| Ledger | create, edit, categorize, delete, restore, pagination, filters, account switch, balance stability | Pending production-QA sequence |
| Reconcile | create-and-match, match existing, auto-match, unmatch, revert, duplicate retry, loading/error completion | Pending production-QA sequence |
| Issues | manual scan, automatic scan, cross-page refresh, pagination, duplicate merge, not-duplicate, stale, missing category | Partial; canonical route evidence collected |
| Category Review | pagination, counters, suggestions, apply, override, auto-fix safety, issue refresh | Partial; canonical route evidence collected |
| Vendors/AP | vendor CRUD, upload, bill lifecycle, payment apply/unapply/delete, statements | Pending |
| Reports | P&L, cash flow, accounts, AP, categories, filters, exports, mutation reflection | Read-only route pass only |
| Planning | budget save/reload, goals CRUD, empty/error/loading states | Read-only route pass only |
| Closed periods | preview, close, blocked mutation, reopen, role restriction | Pending production-QA sequence |
| Settings/team/security | roles, policies, invites, membership changes, backup/reset, preferences | Pending |
| Uploads/mobile | receipt, invoice, CSV, duplicate file, retry, download, deletion, mobile navigation | Pending |
| Accessibility/responsive | keyboard, focus, dialogs, table navigation, 390/768/900/1440, zoom | Route-level pass only |
| AWS/operations | identity, deployed routes, logs, alarms, queues, DLQ, backups, drift, stale resources | Pending re-verification |

## Canonical route pass — 2026-07-11

- 19 authenticated routes × 3 viewports = 57 page executions.
- Canonical API hostname verified in browser traffic.
- Zero failed HTTP responses in the broad pass.
- Zero browser console/page errors in the broad pass.
- Zero page-level horizontal overflow in the broad pass.
- Four initial loading candidates were observed; three completed after warm responses and require targeted cold-load timing before classification.
- This is navigation evidence only. It does not verify mutations or workflow correctness.

