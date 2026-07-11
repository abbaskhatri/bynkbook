# Re-Audit Remediation Status

Implementation date: 2026-07-11

## Implemented and locally verified

| Finding | Remediation |
|---|---|
| BYNK-REAUDIT-PLAID-001 | `/transactions/sync` now uses the SDK-typed `options.account_id` contract. |
| BYNK-REAUDIT-PLAID-002 | Only `SYNC_UPDATES_AVAILABLE` sets the transaction-update flag and enqueues a drain. |
| BYNK-REAUDIT-PLAID-003 | `PENDING_DISCONNECT`, account revocation, `LOGIN_REPAIRED`, and `NEW_ACCOUNTS_AVAILABLE` have explicit lifecycle handling. |
| BYNK-REAUDIT-PLAID-004 | A failed status request renders `Status unavailable` with a retry action and never invites a duplicate connection. |
| BYNK-REAUDIT-PLAID-005 | A database-backed, expiring, token-owned per-account sync lease serializes manual and queued cursor drains. Queue contention is retried. |
| BYNK-REAUDIT-PLAID-006 | Update mode enables account selection; newly shared accounts can be selected, created atomically, and synced independently. |
| BYNK-REAUDIT-OPS-001 | Both Plaid alarms always target SNS. SST creates a stage-scoped operations topic when no approved shared topic ARN is configured. |
| BYNK-REAUDIT-RECON-001 | Background entry pagination no longer depends on its own loading state and always releases the loading flag. |
| BYNK-REAUDIT-RECON-002 | History failures reach a terminal error state with an explicit retry action. |
| BYNK-REAUDIT-RECON-003 | Placement-summary hydration waits for bounded background entry hydration instead of recomputing for every intermediate page. |
| BYNK-REAUDIT-UI-001 | Sidebar, desktop topbar controls, mobile drawer, and bottom navigation now switch together at the large breakpoint. |
| BYNK-REAUDIT-TEST-001 | The Plaid request is statically typed and regression coverage includes the SDK shape, lease contention, webhook allowlisting/lifecycle, and account discovery. |

## Verification results

- Backend: 26 files, 291 tests passed.
- Frontend: 4 files, 16 tests passed.
- Frontend ESLint: passed.
- Infrastructure TypeScript: passed.
- Prisma schema validation: passed.
- Next.js production build: passed with 33 routes.

## External completion gates

These cannot truthfully be closed by repository code alone:

1. The managed SNS topic needs an approved human/on-call subscription and confirmation after deployment. The repository cannot invent a recipient.
2. A real signed Plaid webhook must arrive after deployment, or an approved isolated Plaid Item must be used, to prove the new production worker path end to end.
3. Final privacy/terms commitments require business and counsel approval.
4. Dev-named live Cognito, database, bucket, and KMS resources require a rehearsed, reversible customer migration and maintenance window. They must not be renamed in place.
5. Historical `BankMatch` conversion requires production inventory and accounting review because legacy partial matches cannot be blindly converted to the current full-match model.
6. WAF adoption remains a cost and architecture decision; API throttling and access logging are active.

The deployment record and post-deployment verification should be appended here only after the production release succeeds.
