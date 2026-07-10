# Feature inventory and flow map

Status vocabulary follows the audit brief. “Code-traced” means frontend → API → handler → data was inspected but not executed with production credentials.

## Inventory (32 features)

| # | Feature / purpose / user view | Role and route | Frontend/state/API client | API → handler → data | Authorization and validation | Verification / known issues |
|---:|---|---|---|---|---|---|
| 1 | Marketing landing; product overview and entry to auth | Public `/` | `src/app/page.tsx`; local auth check | No business API | Redirects authenticated users | WORKING_WITH_WARNINGS; named-business demo and hardcoded metrics (`015`) |
| 2 | Email signup | Public `/signup` | local form; Amplify `signUp` | Cognito directly | Cognito password policy; form requires nonempty email/password | PARTIALLY_VERIFIED; render only |
| 3 | Email confirmation | Public `/confirm-signup` | query email/next; Amplify `confirmSignUp` | Cognito directly | code/email required | PARTIALLY_VERIFIED; no real code submitted |
| 4 | Email/password login | Public `/login` | local form; Amplify `signIn` | Cognito directly | form required; Cognito validates | PARTIALLY_VERIFIED; render only |
| 5 | Google OAuth | Public login/signup → `/oauth-callback` | Amplify hosted UI; sessionStorage next path | Cognito hosted UI | `sanitizeAuthNext`; configured callback | NOT_TESTABLE without approved account |
| 6 | Password recovery/reset | Public `/forgot-password`, `/reset-password` | Amplify reset APIs | Cognito directly | email/code/password required | PARTIALLY_VERIFIED; pages render |
| 7 | Logout/session expiration | All authenticated pages | `sessionPolicy.ts`; AppShell; query cache clear | Cognito sign-out | 7-day fallback idle/max-age; safe next URL | CODE_TRACED; homepage says 12h but config is deployment-dependent |
| 8 | Invitation acceptance | Authenticated `/accept-invite` | `api/team.ts` | `POST /v1/team/invites/accept` → `team.handler` → invite/membership | JWT, token state/expiry; policy exclusion by design | CODE_TRACED; no invite tested |
| 9 | Create/manage business workspace | Authenticated `/create-business`, Settings | TanStack business query; `api/businesses.ts` | business CRUD, usage, backup, reset → `businesses.handler` → Business/roles and related data | member/owner/admin checks; confirm words for reset/delete | CODE_TRACED; destructive actions intentionally untested |
| 10 | Dashboard/attention overview | Member+ `/dashboard` | dashboard queries and AI on demand | insights, attention, reports → handlers → entries/issues/AP | membership | CODE_TRACED; authenticated render untested |
| 11 | Account management | write roles; `/settings`, legacy `/accounts` redirect | `useAccounts`, `api/accounts.ts` | account list/create/update/archive/delete eligibility → accounts handler → Account | membership; writes OWNER/ADMIN or configured allowlist by operation | CODE_TRACED |
| 12 | Plaid connect/reconnect/status/sync/opening | write roles; Settings/Reconcile | `api/plaid.ts`, Plaid Link component | 12 Plaid routes → Plaid handlers/service → BankConnection/BankTransaction | JWT, membership, account scope; token KMS; webhook signature | NOT_TESTABLE; production bank mutation prohibited |
| 13 | Upload receipt/invoice/bank statement/logo | write roles; Settings, vendors, mobile | upload controller/list; presigned PUT | init/mark/complete/list/download/import/create entries/bills → uploads handler → S3/Upload/Textract/DB | type/size/account checks; private key prefix; signed URLs | CODE_TRACED; policy asks `VIEW` for writes (`007`) |
| 14 | Ledger entries/list/search/edit/delete/restore/merge | write roles; `/ledger` | React Query, optimistic mutations, `api/entries.ts` | entry routes → entries/update/delete handlers → Entry, matches, issues | membership/account scope/closed period; write allowlist | CODE_TRACED; no production mutation |
| 15 | Transfers | write roles; Ledger | `api/transfers.ts` | transfer CRUD/restore → transfers handler → Transfer + two Entry legs | membership/account scope/closed period | CODE_TRACED |
| 16 | Categories and migration | write roles; Settings and `/settings/category-migration` | categories/migration APIs | category CRUD + preview/apply → handlers → Category/Entry | member reads; write allowlist; migration owner-only | CODE_TRACED; category writes request `VIEW` policy (`007`) |
| 17 | Category review and suggestions | write roles; `/category-review` | AI/categories/entries APIs and review queues | category suggestion + batch apply → AI/entries handlers → Entry/CategoryMemory | membership/account; FULL AI automation for apply | CODE_TRACED |
| 18 | Issue scan/list/resolve/bulk fix | member reads; write roles mutate; `/issues` | React Query and issues APIs | scan/list/resolve/bulk/count/attention → issue handlers → EntryIssue/Entry | business/account membership; closed-period safety on writes | CODE_TRACED |
| 19 | Reconciliation and matches | write roles; `/reconcile` | bank/entry queries, match groups, AI hints | bank tx, match, match group routes → handlers → BankTransaction/MatchGroup/Entry | membership/account, FULL reconcile policy, idempotency/transactions | CODE_TRACED; no live match action |
| 20 | Reconciliation snapshots/exports | write roles; Reconcile | `api/reconcileSnapshots.ts` | create/list/get/export → snapshot handler → DB + S3 CSV | membership; FULL snapshot/export policy | CODE_TRACED; CSV formula risk (`009`) |
| 21 | Closed periods | owner/admin close; owner reopen; `/closed-periods` | closed-period API/activity | list/preview/close/close-through/reopen → handler → ClosedPeriod | role gates; future dates blocked; mutations guard entries | CODE_TRACED |
| 22 | Vendors | member reads; write roles mutate; `/vendors`, detail | vendor/AP/category APIs | vendor CRUD → vendors handler → Vendor/Category/Entry | membership; write allowlist | CODE_TRACED; policy asks `VIEW` (`007`) |
| 23 | Bills/AP/payment allocation | member reads; write roles mutate; vendor detail/mobile | `api/ap.ts`, upload integration | bills, summaries, payments, apply/unapply, CSV → AP handler → Bill/Application/Entry | membership, vendor/account scope, closed-period checks | BROKEN/WARNINGS; statement SQL (`001`), repeated reversal (`008`), CSV (`009`) |
| 24 | Budgets | member read/write roles; `/planning` | `api/budgets.ts` | GET/PUT budgets → budgets handler → Budget | membership; FULL ledger policy | CODE_TRACED |
| 25 | Goals | member read/write roles; `/planning` | `api/goals.ts` | GET/POST/PATCH goals → goals handler → Goal | membership; FULL ledger policy | CODE_TRACED |
| 26 | Reports | members; `/reports`, dashboard | reports API and chart panels | P&L, cash flow, accounts, AP aging, category detail → reports handler | membership/business scope | CODE_TRACED; query tests pass |
| 27 | Global search | members; AppShell | dynamic search component; query API | `POST /search/query` → search handler → scoped DB queries | membership; capped results | CODE_TRACED |
| 28 | Team and invitations | members view; owner/admin manage; Settings | `api/team.ts` | list/invite/revoke/member role/remove/accept → team handler | membership, role allowlists, last-owner safeguards | CODE_TRACED; tests pass |
| 29 | Roles & permissions | members view; owner edit; Settings | policy rows and hint-only helper | GET/PUT policy → rolePolicies handler → BusinessRolePolicy | owner edit; backend policy engine optional | PARTIALLY_IMPLEMENTED (`006`, `007`) |
| 30 | Activity/notifications | members; Settings/AppShell/mobile | 15s query cache; activity API | GET activity → activity handler → ActivityLog | membership | CODE_TRACED |
| 31 | Bookkeeping preferences | members view; write roles edit; Settings | preferences API | GET/PUT → preferences handler → BookkeepingPreferences | membership; write allowlist | CODE_TRACED; policy asks `VIEW` (`007`) |
| 32 | Mobile workbench/capture/review | authenticated `/mobile/*` | mobile workspace context, queues, upload controller | reuses attention/AP/issues/entries/uploads APIs | same backend membership and role gates | CODE_TRACED; production authenticated UX untested |

## Shared UI state behavior

- Loading: page wrappers and major queries use skeletons; React Query retains prior ledger/reconcile pages during pagination.
- Empty: major lists have explicit no-data/next-action states; code inspection found mobile capture and upload empty states.
- Success: mutation pages use inline messages/toasts and query invalidation or optimistic cache updates.
- Failure: `apiFetch` centralizes timeout, 401 refresh, closed-period, matched-delete, and Plaid errors. Some feature handlers still return generic errors.
- Session failure: AppShell clears cached business data and redirects to login with a sanitized same-origin return path.
- Tests: backend has 23 test files / 259 passing tests; frontend has no test files or configured Playwright suite.

## Deployment dependencies

All authenticated business features depend on the same Cognito issuer/audience, current API URL, VPC reachability, database secrets/CA, and PostgreSQL availability. Uploads add S3/KMS/Textract; Plaid adds two secrets/KMS/webhook; AI adds OpenAI secrets; snapshot exports add S3. Because AWS inspection was blocked, deployed environment variables and permissions are not independently verified.

## Founder flow model

```text
Page action
→ React/local or TanStack state
→ typed module under src/lib/api (or upload controller)
→ apiFetch adds Cognito ID token
→ API Gateway validates JWT
→ Lambda rechecks business membership/role/account
→ Prisma, S3, Plaid, Textract, or OpenAI
→ JSON/text response
→ React Query cache/state update
→ loading/empty/success/error UI
```
