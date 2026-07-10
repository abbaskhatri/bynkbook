# Backend and API audit

## API shape

SST declares 148 routes and 49 unique handler exports. API Gateway JWT authorization protects all business and AI routes; only `GET /v1/health` and `POST /v1/plaid/webhook` are public. The webhook performs Plaid JWT signature verification, body hash verification, key lookup/cache, and timing-safe comparison before updating records.

| Route family | Methods / representative paths | Handler | Primary data/service | Contract notes |
|---|---|---|---|---|
| Health/me | `GET /v1/health`, `/v1/me` | health/me | none/claims | `{ok, service, ts}`; me returns sub/email |
| Businesses | list/create/profile/usage/backup/reset/delete | businesses | Business and all scoped models | JSON `{ok,...}`; BigInt serialized as strings; destructive confirm text |
| Accounts | list/create/update/archive/unarchive/delete eligibility/delete | accounts | Account, Entry, BankConnection | account scope and role checks |
| Uploads | init/mark/complete/list/download/import/create entries/create bills/delete | uploads | S3, Textract, Upload, Entry, Bill | signed URLs 10m PUT/5m GET; type/size validation |
| Plaid | link/exchange/status/repair/opening/disconnect/sync/webhook | Plaid handlers/service | Plaid, KMS, BankConnection/Transaction | webhook public but signed; sync up to 45s |
| Entries/transfers | list/create/update/delete/restore/hard-delete/merge/category batch; transfer CRUD | entry/transfer handlers | Entry, Transfer, Issue, Match | closed-period and matched-delete guards |
| Bank/reconcile | bank transactions, direct matches, match groups, revert, adjustment | bank/matches/matchGroups | BankTransaction, BankMatch, MatchGroup | business/account scope and transactions |
| Team/policies | team list/invites/member changes; policy GET/PUT | team/rolePolicies | membership, invite, policy | last-owner guard; policy incomplete |
| Planning/categories | budgets, goals, categories, migration, preferences | dedicated handlers | Budget, Goal, Category, preferences | month/value validation |
| AI/search/insights | category suggestions, explain/chat/anomalies/normalize, search, dashboard | AI/search/insights | OpenAI + scoped aggregates | authenticated; user-initiated AI paths |
| Reports/periods | P&L/cashflow/accounts/AP/categories; close/reopen | reports/closedPeriods | Entries/AP/ClosedPeriod | reports mostly read-only |
| Vendors/AP | vendor CRUD; bills/payments/applications/statements | vendors/AP | Vendor, Bill, Application, Entry | statement defect at `ap.ts:736` |
| Issues/activity | scan/list/resolve/bulk/count/attention/activity | issue/activity handlers | EntryIssue, ActivityLog | scoped queues/audit |
| Snapshots | create/list/get/export | reconcileSnapshots | DB + S3 CSV | signed export URLs |

## Request/response conventions

- Authentication: `Authorization: Bearer <Cognito ID token>`; API Gateway validates issuer/audience before Lambda.
- Scoping: business and account IDs appear in paths; handlers query membership and require account ownership by business.
- JSON: most responses use `{ ok: true, ... }` and errors `{ ok: false, error, code? }`.
- Money: persisted as PostgreSQL `bigint` cents and serialized to strings where necessary.
- Dates: financial dates generally use `YYYY-MM-DD`/PostgreSQL date; timestamps are ISO strings.
- Pagination: entry and high-volume flows include cursor/limit behavior; small administrative lists are unpaginated.
- CSV: vendor statements return direct CSV; snapshots store CSV in S3; frontend exports some CSV locally.
- Errors: many handlers catch and return generic failures, but logging/correlation conventions are inconsistent.

## Authorization and tenant isolation

Static review found membership checks across all sampled business handlers, account-in-business checks where account IDs are accepted, and owner/admin/write-role allowlists for mutations. Business ID is included in most Prisma predicates and raw SQL. The API returned 401 to an unauthenticated protected GET. No confirmed IDOR/cross-tenant route was found.

Risks remain: the editable role policy layer is default-off/store-only (`006`); six mutation families request only VIEW (`007`); authorization helpers and allowlists are duplicated across handlers, making drift likely. Live cross-tenant tests were not performed.

## Validation and integrity controls

Positive controls include invalid JSON handling, UUID/account scope lookups, role allowlists, closed-period checks, upload size/type limits, S3 HeadObject size verification, signed webhook validation, Plaid token encryption, entry/bank idempotency keys, match transactions, owner confirmation strings, and last-owner safeguards.

Confirmed defects:

- Vendor statement raw SQL uses nonexistent `reversed_at` (`001`).
- AP application uniqueness cannot preserve more than one inactive history row per entry/bill pair (`008`).
- CSV formula prefixes are not neutralized (`009`).

## CORS and public HTTP

Trusted preflight from `https://app.bynkbook.com` returned 204 with the expected origin, methods, and `authorization,content-type` headers. An untrusted origin also received 204 but no `Access-Control-Allow-Origin`, so browsers cannot grant it access. This matches SST's prod allowlist of `app.bynkbook.com` and `bynkbook.com`.

## Reliability/performance

Most DB Lambdas are VPC-attached with 20-second timeouts; Plaid sync uses 45 seconds. Secrets and Prisma/PG clients are cached across warm invocations. Raw report SQL and scoped indexes are used for financial aggregates. The architecture provisions a Lambda per route, producing a large function fleet and operational surface. No deployed timeout/throttle/log review was possible.

## Logging and errors

Handlers emit selected console errors and ActivityLog business events. There is no common correlation/request ID, structured logger, or log-redaction wrapper. One Textract error logs the raw caught error object. No code intentionally logs tokens/secrets was found, and Plaid failure persistence is sanitized/tested. API 404s can include method/path; this is low sensitivity.

## Tests

The backend has 23 test files and 259 passing tests. Strong areas include Plaid service (37), bank transactions (32), category scoring (30), issues, entry deletion/category application, authorization gaps, accounts, team, reports, uploads, and database TLS helpers. Gaps include the vendor statement SQL route, repeated AP reversal lifecycle, CSV formula safety, full handler-to-database integration, deployed authorizer/CORS, and frontend/backend contract tests.

## Backend result

The backend is substantive and generally defensive, but the vendor statement defect is a clear high-priority break, AP lifecycle constraints need repair, policy enforcement is unfinished, and dependency/runtime reachability needs security triage.
