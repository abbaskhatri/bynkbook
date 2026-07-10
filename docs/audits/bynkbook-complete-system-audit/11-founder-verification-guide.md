# Founder verification guide

Use a dedicated synthetic BynkBook business, synthetic bank/test data, and non-customer files. Do not run bank sync, upload, delete, reset, close, match, apply, or bulk actions in a real customer business merely to test them.

## Public and account access

### Landing page

- Where: `https://app.bynkbook.com/`.
- Normal: page loads quickly, Sign in/Create business work, no blank screen or horizontal scrolling.
- Reads/changes: reads no business data; an existing local session may redirect to Dashboard.
- Backend: Cognito session check only.
- Warning signs: named business appears as if real, broken logo, console errors, old API URL.
- Audit result: works with warnings; hardcoded sample name/metrics are present.

### Signup, confirmation, login, and recovery

- Where: `/signup`, `/confirm-signup`, `/login`, `/forgot-password`, `/reset-password`.
- Normal: required fields enable the primary button; confirmation/reset codes arrive; successful login reaches the requested in-app page.
- Reads/changes: creates/updates Cognito identity and tokens; no business exists until business setup.
- Backend: AWS Cognito through Amplify; app API begins after login.
- Safe verification: use an approved test email; never paste codes into audit notes.
- Warning signs: redirect to another domain, repeated callback loop, API 401 after valid login, wrong business appears.
- Audit result: pages and signed-out redirect work; actual identity lifecycle was not executed.

### Legal pages

- Where: Privacy and Terms links on public/auth pages.
- Normal: final approved, dated policies with business contact and actual data practices.
- Reads/changes: none.
- Warning signs: words such as “replace this placeholder.”
- Audit result: failed content readiness; both are placeholders.

## Workspace and navigation

### Business setup/profile

- Where: first login `/create-business`; later Settings → Business.
- Normal: creating a synthetic business creates an owner membership and default categories; profile changes reappear after reload.
- Data: Business, UserBusinessRole, Category.
- Backend: business routes and PostgreSQL.
- Safe verification: use a uniquely named test business; do not delete/reset a real business.
- Warning signs: another user's business, missing owner role, profile saved but not reloaded.
- Audit result: code/tests traced; production transaction not run.

### Dashboard

- Where: Dashboard.
- Normal: selected business/account is clear; attention, trends, AP, and next actions agree with source pages.
- Data/backend: entries, issues, bank state, reports, AP through attention/insights/report handlers.
- Safe verification: compare counts to Ledger/Issues using a test account.
- Warning signs: stale counts after changes, blank charts, totals from another business.
- Audit result: code-traced, authenticated production not verified.

### Global search/activity

- Where: top search and bell/activity; full activity in Settings.
- Normal: results/actions stay within selected business; recent actions show actor/time.
- Data/backend: scoped search queries and ActivityLog.
- Warning signs: cross-business result, missing destructive action, customer data in error logs.
- Audit result: code-traced only.

## Bookkeeping

### Accounts and bank connections

- Where: Settings → Accounts/Bank connections.
- Normal: manual accounts can be created/archived; Plaid status names the right institution/account; reconnect does not duplicate history.
- Data/backend: Account, BankConnection, BankTransaction; Plaid/KMS.
- Safe verification: use Plaid-approved test institution/account only. Do not connect/sync real banking during verification.
- Warning signs: wrong last four digits, duplicate transactions, history disappearing, reconnect mapped to another account.
- Audit result: extensive Plaid tests pass; live workflow intentionally untested.

### Uploads and mobile receipt/invoice capture

- Where: Settings/uploads, vendor pages, `/mobile/receipt`, `/mobile/invoice`.
- Normal: supported synthetic file passes size/type checks, progress completes, review-only invoice does not create a bill automatically, download expires.
- Data/backend: Upload row, private S3 object, optional Textract/Entry/Bill.
- Safe verification: use a harmless synthetic image/PDF/CSV with no PII; confirm test business/account first.
- Warning signs: public object URL, another business's file, file accepted with wrong type/size, automatic posting contrary to copy.
- Audit result: code/tests traced; no upload performed.

### Ledger entries and transfers

- Where: Ledger.
- Normal: selected account/range is obvious; create/edit/transfer updates totals; closed periods block edits; delete/restore and matched-entry safeguards explain what happened.
- Data/backend: Entry, Transfer, issues/matches; entry/transfer handlers.
- Safe verification: use small synthetic amounts in an open test period; reverse/clean up only inside test tenant.
- Warning signs: cents/sign errors, totals not refreshing, transfer legs unequal, closed entry editable, wrong account affected.
- Audit result: code-traced with strong backend tests; no live mutation.

### Categories, Category Review, and AI suggestions

- Where: Category Review and Settings categories/migration.
- Normal: suggestions show confidence/reason; apply affects only selected test entries; deterministic and AI actions are distinguishable.
- Data/backend: Category, Entry, CategoryMemory; category/AI/entry handlers/OpenAI.
- Safe verification: use synthetic entries; review before bulk apply.
- Warning signs: category from another business, silent bulk apply, unclear AI confidence, changed closed-period entry.
- Audit result: scoring/apply tests pass; live AI not run.

### Issues

- Where: Issues and account attention badges.
- Normal: scan/list counts agree; resolve/bulk preview shows exact effects; applied fix updates ledger.
- Data/backend: EntryIssue and Entry.
- Safe verification: create known synthetic issue in an open period; preview before apply.
- Warning signs: count mismatch, fix without preview, issue reappears incorrectly, closed data changes.
- Audit result: issue tests pass; live flow not run.

### Reconciliation and snapshots

- Where: Reconcile.
- Normal: bank and expected sides show the same account/month; match totals/signs agree; revert restores prior state; snapshot exports match visible data.
- Data/backend: BankTransaction, Entry, MatchGroup and children, ReconcileSnapshot/S3.
- Safe verification: use test bank data; never match/unmatch real customer records for testing.
- Warning signs: transaction disappears, duplicate match, remaining amount wrong, revert changes unrelated rows, export cell starts a formula.
- Audit result: substantial tests pass; live flow untested; CSV formula risk exists.

### Closed periods

- Where: Closed Periods.
- Normal: preview lists blockers; close prevents later mutations; only owner reopens; activity records action.
- Data/backend: ClosedPeriod plus mutation guards.
- Safe verification: test business and old synthetic month only.
- Warning signs: future month closes, bookkeeper reopens, closed entry changes, activity missing.
- Audit result: code-traced and 3 tests pass.

## Vendors, AP, planning, and reports

### Vendors, bills, and payments

- Where: Vendors → vendor detail.
- Normal: vendor/bill/payment balances agree; apply/unapply is reversible; statement downloads and matches on-screen totals.
- Data/backend: Vendor, Bill, BillPaymentApplication, Entry; AP handler.
- Safe verification: test vendor/bill/payment only.
- Warning signs: statement server error, second unapply fails, negative/outstanding totals wrong, payment applies across vendor/business.
- Audit result: **warning/broken**—statement SQL is wrong and repeated reversal can violate uniqueness.

### Budgets and goals

- Where: Planning.
- Normal: selected month/category targets save and progress reflects report data.
- Data/backend: Budget, Goal, Category, entries.
- Safe verification: use test month/category.
- Warning signs: duplicate row, target saved in dollars rather than cents, cross-business category.
- Audit result: code-traced only.

### Reports

- Where: Reports and Dashboard summaries.
- Normal: P&L, cash flow, accounts, AP aging, and categories reconcile to ledger/AP for the same range and business.
- Data/backend: report handler raw/Prisma queries.
- Safe verification: compare a small synthetic fixture with hand-calculated totals.
- Warning signs: signs reversed, closed/deleted rows included unexpectedly, date-boundary mismatch, report/detail disagreement.
- Audit result: report tests pass; production data not reviewed.

## Administration

### Team and invitations

- Where: Settings → Team.
- Normal: invite expires/revokes correctly; role updates take effect; last owner cannot be removed/downgraded.
- Data/backend: BusinessInvite, UserBusinessRole, ActivityLog.
- Safe verification: synthetic second test user/email.
- Warning signs: non-member visible, admin promotes/removes owner unexpectedly, revoked invite accepted.
- Audit result: team tests pass; live invitation not sent.

### Roles & Permissions

- Where: Settings → Roles & Permissions.
- Normal desired behavior: None denies, View reads only, Full reads/writes.
- Actual backend: static role allowlists remain primary; saved policies can be default-off/not enforced; several writes request VIEW.
- Safe verification: do not rely on this matrix to protect sensitive data until fixed.
- Warning signs: UI says saved but restricted user still writes.
- Audit result: partially implemented (`006`,`007`).

### Business backup/reset/delete

- Where: owner Settings controls.
- Normal: backup downloads scoped data without Plaid token ciphertext; reset/delete require exact confirmation and owner identity.
- Data/backend: nearly all tenant data; owner-only business handler.
- Safe verification: backup only in approved test tenant; do not reset/delete production during audit.
- Warning signs: operation enabled for non-owner, missing confirmation, wrong business name/scope.
- Audit result: code-traced; destructive operations intentionally not tested.

## What the founder should do next

Provide a synthetic production/stage tenant with owner, admin, bookkeeper, accountant, and member identities; one manual account; synthetic entries/bank transactions; one vendor/bill/payment; harmless upload; and explicit permission to mutate only those fixtures. Re-run this guide alongside the AWS read-only checklist after exact account verification.
