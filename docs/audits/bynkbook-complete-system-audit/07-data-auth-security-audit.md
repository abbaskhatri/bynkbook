# Data, authentication, authorization, and security audit

## Data systems

PostgreSQL is the system of record, accessed through Prisma 7 and `pg` with Secrets Manager-provided URL/CA and `rejectUnauthorized=true`. S3 stores private upload objects and reconciliation exports. KMS encrypts Plaid tokens and protects upload operations. Cognito stores identities; OpenAI, Plaid, and Textract receive scoped integration requests.

## Schema inventory

The 27 models are: Business, UserBusinessRole, Account, EntryMerge, CategoryMemory, Entry, Category, BookkeepingPreferences, EntryIssue, Upload, BankConnection, BankTransaction, BankMatch, MatchGroup, MatchGroupBank, MatchGroupEntry, Transfer, ReconcileSnapshot, BusinessInvite, BusinessRolePolicy, ActivityLog, ClosedPeriod, Vendor, Bill, BillPaymentApplication, Budget, and Goal.

Business ownership is carried explicitly by `business_id` on nearly every tenant entity. Foreign keys and cascades link primary business data. Financial money uses `BigInt` cents. Date-only fields use PostgreSQL date for entries/bank/bills/openings. Timestamps use timezone-aware columns.

## Data integrity

Positive evidence:

- Composite tenant indexes cover common business/account/date/status queries.
- Unique identifiers and source hashes reduce duplicate upload/import/Plaid creation.
- Soft deletion exists for entries/uploads and audit-preserving voids exist for matches/bills/applications.
- Closed-period checks protect financial mutations.
- Match-group and transfer operations use transactions.
- Plaid service has extensive pagination, reconnect, identity, duplicate, and failure tests.

Risks/findings:

- AP application active/history uniqueness is structurally wrong for repeated reversals (`008`).
- Vendor statement SQL has schema drift (`001`).
- Category name uniqueness is database case-sensitive; handlers should continue normalizing/handling case collisions, though no confirmed user defect was established.
- Migration deployment and production record shapes could not be checked.
- Orphan/duplicate/stale production records could not be scanned without DB/AWS access.

## Authentication lifecycle

- Signup/confirmation/login/reset/Google OAuth use Amplify/Cognito.
- API calls attach an Amplify-managed Cognito ID token.
- API Gateway validates Cognito issuer/audience.
- AppShell protects app routes and clears state on sign-out/session expiry.
- `sanitizeAuthNext` confines redirects to the app origin/path.
- Token refresh is attempted once after a 401.
- Plaid webhook independently verifies Plaid-signed JWT/body hash.

Public auth screens rendered correctly; actual Cognito account creation/login/reset/OAuth were not performed. Revoked/disabled/deleted-user behavior and global sign-out were not tested. Application sign-out is local (`global:false`), so other devices remain signed in by design.

## Authorization

The reliable current layer is static role/membership logic in handlers: OWNER, ADMIN, BOOKKEEPER, ACCOUNTANT, MEMBER. Reads require business membership; writes generally restrict to the four write roles; owner/admin-only operations have stronger checks; owner deletion/reset validates both membership role and `owner_user_id`; last-owner protections exist.

The configurable policy layer is not reliable (`006`,`007`). Treat the Settings matrix as advisory until a dedicated authorization phase closes all action mappings and enables policies through an explicit migration. Frontend permission hints are UX only and correctly state that backend is the source of truth, but backend defaults remain allowlist-driven.

## Tenant isolation

Static review found consistent `business_id` filters and account-in-business checks across sampled handlers. Raw report/AP SQL includes business predicates. S3 keys include business/account segments and Lambda S3 permissions are scoped to `private/biz/*` within the configured bucket. No confirmed cross-tenant access path was found.

Tenant isolation is not marked VERIFIED_WORKING because live two-tenant adversarial tests were not run. Required follow-up: create two synthetic businesses/users and exercise every ID-bearing GET/mutation with swapped IDs, including signed download URLs.

## Upload security

Upload initialization validates upload type, declared content type, positive size, per-type size cap, and account scope. Presigned URLs expire after 600 seconds, downloads after 300. Completion uses S3 metadata/size, and objects live under a private prefix. Risks: MIME validation is declarative rather than file-signature/content scanning; `image/*` is broad; no antivirus/malware scan is present; deployed bucket public-access block, encryption defaults, lifecycle, and CORS could not be checked.

## Secrets and privacy

No common-pattern AWS key, OpenAI key, private key, or credentialed PostgreSQL URL was found in tracked files. Only environment-variable/secret names are committed. Database URL, CA, Plaid, and OpenAI values are intended to live in Secrets Manager. Cognito pool/client IDs and API URLs are public identifiers, not secrets.

PII/business data includes identity email, business profile/contact data, ledger/payee/memo, uploads, bank transactions, and activity actors. The placeholder privacy policy does not adequately document handling (`002`). Backup/export can collect nearly all business data and is owner-only; it deliberately omits Plaid access-token ciphertext from the selected bank connection shape.

## Browser/API security

- CORS correctly withholds allow-origin for an untrusted test origin.
- HTTPS is used.
- Baseline response security headers are absent (`010`).
- CSV formula injection is present (`009`).
- No untrusted React `dangerouslySetInnerHTML` flow was found; theme bootstrap is fixed text.
- Ledger print HTML escapes record values.
- No application WAF/rate-limit/abuse control is defined in IaC (`012`). Cognito and API Gateway may have service defaults, but deployed settings are unknown.

## Backups, retention, and recovery

Prior repository documentation states seven-day RDS backup retention and 30-day retention for most Lambda log groups. This audit could not verify point-in-time recovery, deletion protection, snapshots, S3 versioning/lifecycle, or restore success. No restore rehearsal evidence was found in this audit scope. These remain founder/operator decisions after AWS access is restored.
