# Complete findings register

## Summary

| ID | Severity | Type | Title | Production impact |
|---|---|---|---|---|
| BYNK-AUDIT-001 | HIGH | Confirmed defect | Vendor statement SQL uses nonexistent column | Likely; runtime not authenticated-tested |
| BYNK-AUDIT-002 | HIGH | Confirmed defect | Placeholder legal pages are public | Confirmed |
| BYNK-AUDIT-003 | HIGH | Dependency risk | Frontend production dependency advisories | Likely dependency tree; applicability varies |
| BYNK-AUDIT-004 | HIGH | Dependency risk | Backend production dependency advisories | Likely dependency tree; applicability varies |
| BYNK-AUDIT-005 | HIGH | Deployment inconsistency | Supplied production API hostname does not resolve | Confirmed hostname failure; consumers unknown |
| BYNK-AUDIT-006 | MEDIUM | Incomplete implementation | Role policies are stored but not dependable enforcement | Likely |
| BYNK-AUDIT-007 | MEDIUM | Confirmed policy defect | Multiple mutations request only VIEW policy | Code-confirmed; enforcement currently default-off |
| BYNK-AUDIT-008 | MEDIUM | Confirmed data-design defect | Repeated AP apply/unapply can violate uniqueness | Likely edge case |
| BYNK-AUDIT-009 | MEDIUM | Confirmed security weakness | CSV exports permit formula injection | Likely |
| BYNK-AUDIT-010 | MEDIUM | Configuration risk | Web responses lack baseline security headers | Confirmed |
| BYNK-AUDIT-011 | MEDIUM | Deployment risk | Tracked production env file contains stale placeholders | Repository confirmed; live app uses override |
| BYNK-AUDIT-012 | MEDIUM | Missing control | IaC defines no alarms, API access logs, WAF, or rate controls | Repository confirmed; deployed state unknown |
| BYNK-AUDIT-013 | INFO | Audit blocker | Required AWS profile unavailable | Confirmed locally |
| BYNK-AUDIT-014 | MEDIUM | Architecture risk | Production bridge depends on dev-named resources | Repository-documented; not independently verified |
| BYNK-AUDIT-015 | LOW | Confirmed content defect | Landing page exposes named-business demo scene | Confirmed production |
| BYNK-AUDIT-016 | LOW | Accessibility defect | Public text actions have 16px touch height | Confirmed production mobile viewport |
| BYNK-AUDIT-017 | LOW | Dead code | 24 unused `.handler.ts` re-export shims | Static evidence |
| BYNK-AUDIT-018 | LOW | Production hygiene | Dev dialog gallery ships as production route | Build-confirmed |
| BYNK-AUDIT-019 | LOW | Maintainability/performance risk | Three page clients exceed 4,000 lines | Static evidence |
| BYNK-AUDIT-020 | INFO | Missing test | No frontend unit/component/E2E suite | Repository confirmed |
| BYNK-AUDIT-021 | INFO | Audit limitation | Authenticated production workflows not executed | Confirmed limitation |
| BYNK-AUDIT-022 | INFO | Audit limitation | SST build/synth not run after AWS hard stop | Confirmed limitation |

## Detailed findings

### BYNK-AUDIT-001 — Vendor statement SQL uses nonexistent column

- Severity / confidence / status: **HIGH / High / confirmed defect**.
- Feature / role / class: vendor AP statement export; authenticated business members; backend/data.
- Location: `infra-sst/packages/functions/src/ap.ts:736`, `infra-sst/prisma/schema.prisma:709-736`, migration `20260214_160000_ap_bills/migration.sql`.
- Function/resource: `GET .../vendors/{vendorId}/ap/statement.csv`; `bill_payment_application`.
- Expected vs actual: the statement should sum active applications. SQL filters `bpa.reversed_at IS NULL`, but neither schema nor migrations define `reversed_at`; active state is `is_active` plus `voided_at`.
- Evidence/reproduction: compare the SQL at line 736 with Prisma/migration columns, then call the endpoint with a valid member and vendor; PostgreSQL should report undefined column. The route was not called in production to avoid customer-data access.
- User/business/security impact: vendor statements fail instead of downloading; AP workflows and customer trust are affected. No direct exposure, but availability and financial reporting are impaired.
- Root cause / correction: stale column name from an earlier reversal design. Replace with the canonical active-state predicate in a separate fix PR.
- Complexity / regression risk / tests: low complexity, medium accounting regression risk. Add an endpoint integration test with active and voided applications and validate CSV totals.
- Production affected / normal-use blocker: likely if current backend is deployed; blocks this export, not the entire app.

### BYNK-AUDIT-002 — Placeholder Privacy Policy and Terms are public

- Severity / confidence / status: **HIGH / High / confirmed defect**.
- Feature / role / class: signup/legal; public/all roles; frontend/legal/deployment.
- Location: `bynkbook-web/src/app/(auth)/privacy/page.tsx:112`, `terms/page.tsx:31,137`.
- Expected vs actual: production should show approved legal terms and contact/data-use disclosures. Both pages tell the reader to replace placeholder copy before public launch/distribution.
- Evidence/reproduction: open `/privacy` and `/terms`; both returned 200 and rendered the placeholder instructions.
- User/business/security impact: users cannot rely on complete terms or privacy disclosures; material compliance, contractual, and trust risk. The policy omits concrete controller/contact, retention, subprocessors, rights, and jurisdiction details.
- Root cause / correction: design copy was shipped as legal copy. Obtain counsel-approved text and a version/effective-date process.
- Complexity / regression risk / tests: medium external/legal effort, low code risk. Add route/content checks and legal approval evidence.
- Production affected / normal-use blocker: confirmed production; should block broader public launch, not sign-in mechanics.

### BYNK-AUDIT-003 — Frontend dependency tree has high advisories

- Severity / confidence / status: **HIGH / High / dependency risk**.
- Feature / role / class: entire web application; all roles; frontend/security.
- Location: `bynkbook-web/package.json`, `package-lock.json`.
- Expected vs actual: production dependencies should have reviewed/mitigated advisories. `npm audit --omit=dev` exits 1 with 8 advisories: 5 high and 3 moderate, including Next.js 16.1.1 and transitive XML, cookie, lodash, PostCSS, and UUID packages.
- Evidence/reproduction: run `npm audit --omit=dev --audit-level=low` on 2026-07-10. Audit recommends Next 16.2.10 outside the pinned range.
- User/business/security impact: advisory-dependent DoS, cache, request, injection, or cookie risks. Not every advisory is reachable in this deployment; exploitability requires package-by-package triage.
- Root cause / correction: pinned/outdated direct and transitive versions. Upgrade in a dedicated tested security PR; do not run blind `audit fix --force`.
- Complexity / regression risk / tests: medium-high; medium-high framework risk. Re-run build, browser smoke, auth, image, cache, and all financial flows.
- Production affected / normal-use blocker: dependency versions likely deployed; active exploitation not evidenced; does not presently block normal use.

### BYNK-AUDIT-004 — Backend dependency tree has high advisories

- Severity / confidence / status: **HIGH / High / dependency risk**.
- Feature / role / class: APIs/integrations; all roles; backend/security.
- Location: `infra-sst/package.json`, `package-lock.json`.
- Expected vs actual: runtime and tooling dependencies should be reviewed. `npm audit --omit=dev` exits 1 with 18 advisories: 12 high and 6 moderate, including Axios, Hono, Prisma tooling, XML packages, lodash, form-data, and redirects.
- Evidence/reproduction: run the recorded npm audit. Several findings are tooling/transitive and may not enter Lambda bundles; Axios is used transitively by integrations and merits runtime confirmation.
- User/business/security impact: potential SSRF, prototype pollution, request tampering, DoS, and other package-specific risks. No exploitation evidence.
- Root cause / correction: fast-moving dependency graph with CLI packages in runtime dependencies. Separate build-only packages, inspect Lambda bundles, and upgrade deliberately.
- Complexity / regression risk / tests: high; integrations and Prisma have meaningful regression risk. Run 259 tests plus Plaid/upload/API contract tests and stage smoke.
- Production affected / normal-use blocker: deployment applicability unknown without bundle/AWS inspection; no current blocker proven.

### BYNK-AUDIT-005 — Supplied production API hostname does not resolve

- Severity / confidence / status: **HIGH / High / confirmed deployment inconsistency**.
- Feature / role / class: all API workflows/Plaid webhook; all roles; deployment/infrastructure.
- Location: audit brief versus `scripts/bynkbook-production-preflight.ps1:7`, `docs/production-bridge-current-state.md:28-34`; live bundle chunk `34a279c0da1dca92.js`.
- Expected vs actual: one canonical production API should be documented and resolvable. `actwy6st05…` from the brief failed DNS resolution, while `cpjh7t19u1…/v1/health` returned 200 and the live web bundle contains the latter.
- Evidence/reproduction: safe GET/HEAD to both health endpoints; inspect live ledger bundle for API literal. No AWS changes or authenticated requests.
- User/business/security impact: stale clients/webhooks/runbooks can fail completely; if Plaid still targets the old host, transaction notifications may be lost or delayed.
- Root cause / correction: API migration and compatibility documentation drift. Confirm Plaid's configured webhook and every consumer, then publish one source of truth and retire legacy references through a controlled plan.
- Complexity / regression risk / tests: medium; high integration regression risk. Validate health, CORS, auth, Plaid signature route, DNS, and rollback.
- Production affected / normal-use blocker: old hostname failure confirmed; current web uses working host; impact depends on remaining consumers.

### BYNK-AUDIT-006 — Editable role policies are not dependable enforcement

- Severity / confidence / status: **MEDIUM / High / incomplete implementation**.
- Feature / role / class: roles & permissions; owners/admins/members; security/backend/frontend/data.
- Location: `schema.prisma:26-28,597`, `rolePolicies.ts:130-131,215`, `authz.ts:224-284,344`, Settings around line 1674.
- Expected vs actual: saved None/View/Full choices should consistently control backend access. New businesses default `authz_mode=OFF`, wave 0; responses say `notEnforcedYet`; OFF and ENFORCE_ONLY allow; the UI also labels the matrix Store-only while saying policies are active on supported screens.
- Evidence/reproduction: create a business and inspect defaults, or statically trace policy save to `authorizeWrite` mode evaluation.
- Impact: owners may believe restrictions are active when static role allowlists remain the real authority. No anonymous access was found, but least privilege is unreliable.
- Root cause / correction: staged rollout left storage/UI ahead of enforcement. Either remove editing and state the exact limits, or finish enforcement with migration and audit logs.
- Complexity / regression risk / tests: high/high. Build a role × action matrix integration suite and migrate businesses explicitly.
- Production affected / blocker: likely; does not block normal use but blocks reliance on custom permissions.

### BYNK-AUDIT-007 — Mutation handlers request VIEW policy strength

- Severity / confidence / status: **MEDIUM / High / confirmed policy defect**.
- Feature / role / class: categories, preferences, entries, uploads, vendors, AP; write roles; backend/security.
- Location: `categories.ts:43`, `bookkeepingPreferences.ts:111`, `entryUpdate.ts:142`, `uploads.ts:176`, `vendors.ts:48`, `ap.ts:57`.
- Expected vs actual: writes should require FULL. These handlers call `authorizeWrite(... requiredLevel: "VIEW")`, so a VIEW policy satisfies the check when enforcement is enabled.
- Evidence/reproduction: enable ENFORCE/wave for a test business, assign VIEW, and invoke the relevant mutation. Static `policyAllows` proves VIEW is accepted.
- Impact: future/current enforced businesses can permit mutations contrary to displayed policy. Static role allowlists limit which roles can exploit it.
- Root cause / correction: mistaken level passed to shared helper. Change all mutations to FULL and add a lint/test invariant.
- Complexity / regression risk / tests: low-medium/medium. Add all six endpoint authorization tests for VIEW denial and FULL success.
- Production affected / blocker: dormant where mode is OFF; active on any business already enforcing relevant waves.

### BYNK-AUDIT-008 — Repeated AP apply/unapply can violate uniqueness

- Severity / confidence / status: **MEDIUM / High / confirmed data-design defect**.
- Feature / role / class: bill payment allocation; write roles; data/backend.
- Location: `schema.prisma:722-733`, migration `20260214_160000_ap_bills:89`, `ap.ts:1103-1113,1225-1226`.
- Expected vs actual: a payment can be applied, unapplied, reapplied, and unapplied again with history. Unique `(entry_id,bill_id,is_active)` permits only one false row; the second active row cannot be changed to false while the first false row exists.
- Evidence/reproduction: in a test DB, perform apply → unapply → apply → unapply on the same pair; the final update should hit the unique index.
- Impact: legitimate correction cycles fail and can leave allocations active. History/data are not silently lost, but workflow availability and accounting operations suffer.
- Root cause / correction: boolean composite uniqueness used instead of a partial unique index for active rows only.
- Complexity / regression risk / tests: medium/high data migration risk. Replace with `UNIQUE ... WHERE is_active=true`; test repeated cycles/concurrency.
- Production affected / blocker: likely edge case; blocks repeated reversal for a pair.

### BYNK-AUDIT-009 — CSV exports permit spreadsheet formula injection

- Severity / confidence / status: **MEDIUM / High / confirmed security weakness**.
- Feature / role / class: ledger/reconcile/snapshot/vendor CSV exports; members; frontend/backend/security.
- Location: `bynkbook-web/src/lib/csv.ts:1-12`, reconcile page around `2457`, `reconcileSnapshots.ts:70-79`, `ap.ts:756-793`.
- Expected vs actual: user-controlled cells beginning `=`, `+`, `-`, `@`, tab, or carriage return should be neutralized. Exporters only quote commas/quotes/newlines or use JSON quoting, which does not stop spreadsheet formula evaluation.
- Evidence/reproduction: create a test payee/memo like `=1+1`, export, and open in a spreadsheet's protected test environment; no production record was created during audit.
- Impact: malicious imported/vendor text can execute formulas when staff open CSVs, potentially causing external requests or misleading output.
- Root cause / correction: CSV syntax escaping mistaken for spreadsheet-safety escaping. Centralize a formula-safe cell function and use it in all exporters.
- Complexity / regression risk / tests: low-medium/low. Add malicious-prefix fixtures to every export test.
- Production affected / blocker: likely; advise caution with exports, but app remains usable.

### BYNK-AUDIT-010 — Baseline web security headers are absent

- Severity / confidence / status: **MEDIUM / High / configuration risk**.
- Feature / role / class: all web pages; all roles; frontend/hosting/security.
- Location: `bynkbook-web/next.config.ts`; live CloudFront response.
- Expected vs actual: production should deliberately configure HSTS, CSP or an evaluated alternative, frame protection, referrer policy, content-type protection, and permissions policy. HEAD `/` returned none and exposed `X-Powered-By: Next.js`.
- Evidence/reproduction: `Invoke-WebRequest -Method Head https://app.bynkbook.com/` and inspect headers.
- Impact: weaker browser hardening against framing, downgrade, content-type, referrer, and injection classes. TLS is present; no exploit was performed.
- Root cause / correction: no `headers()` configuration or hosting response policy. Add staged headers, beginning report-only CSP to avoid breaking Cognito/Plaid.
- Complexity / regression risk / tests: medium/medium. Browser-test OAuth, Plaid, images, scripts, and downloads under headers.
- Production affected / blocker: confirmed; not a current availability blocker.

### BYNK-AUDIT-011 — Tracked production env file contains stale placeholders

- Severity / confidence / status: **MEDIUM / High / deployment risk**.
- Feature / role / class: all deployed web features; operators; deployment/configuration.
- Location: tracked `bynkbook-web/.env.production`; `api/client.ts:5`.
- Expected vs actual: a clean production build should use validated canonical environment values. The tracked file points to unused `https://api.bynkbook.com` and placeholder Cognito IDs/domains. The live bundle works only because Amplify overrides it.
- Evidence/reproduction: inspect tracked file; clean build without deployment env; compare live bundle `cpjh7t19u1`.
- Impact: local release/recovery/alternate CI builds can silently ship unusable auth/API configuration.
- Root cause / correction: placeholder file retained after bridge migration. Replace with non-secret example strategy and fail builds when placeholders/unapproved hosts are present.
- Complexity / regression risk / tests: low-medium/medium. Add environment validation and clean-room production build test.
- Production affected / blocker: live Amplify currently overrides; blocks trustworthy reproducible releases.

### BYNK-AUDIT-012 — Operational controls are not defined in infrastructure code

- Severity / confidence / status: **MEDIUM / Medium / missing control**.
- Feature / role / class: API/operations; operators; infrastructure/observability/security.
- Location: `infra-sst/sst.config.ts`.
- Expected vs actual: production IaC should define or reference alarms, API access logs, rate/abuse controls, and recovery settings. SST defines routes/log permissions but no alarms, API access logging, WAF/rate limiting, or database/backup resources.
- Evidence/reproduction: static config search; deployed out-of-band controls could not be checked.
- Impact: failures, throttling, abuse, and recovery gaps may go unnoticed or be non-reproducible.
- Root cause / correction: infrastructure focuses on API routes while shared/legacy resources live outside the stack.
- Complexity / regression risk / tests: medium-high/low-medium. Inventory deployed controls, import/reference them, and test alarm delivery/runbooks.
- Production affected / blocker: configuration risk; deployed status unknown.

### BYNK-AUDIT-013 — Required AWS profile is unavailable

- Severity / confidence / status: **INFO / High / audit blocker**.
- Feature / role / class: AWS audit; operator; infrastructure.
- Location: local AWS configuration outside repository.
- Expected vs actual: `aws sts get-caller-identity --profile ledrigo-dev --query Account --output text` should return `116846786465`; it failed because the profile was not found.
- Evidence/reproduction: run exact command. Per brief, all AWS inspection stopped.
- Impact: deployed resources, IAM, logs, alarms, backups, errors, and data shape remain unverified. No production change occurred.
- Root cause / correction: missing local profile. Provision least-privilege read-only profile with the required name/account.
- Complexity / regression risk / tests: low/none; rerun identity check before AWS work.
- Production affected / blocker: audit only; blocks complete AWS verification.

### BYNK-AUDIT-014 — Production bridge depends on dev-named live resources

- Severity / confidence / status: **MEDIUM / Medium / architecture risk**.
- Feature / role / class: auth/database/uploads/KMS; all roles; infrastructure/deployment.
- Location: `docs/production-bridge-current-state.md:40-93`.
- Expected vs actual: production dependencies should be clearly isolated and reproducible. Repository docs say prod uses dev-named RDS, bucket, Cognito, and KMS through bridge secrets.
- Evidence/reproduction: repository operations record dated 2026-07-09; not independently AWS-verified in this audit.
- Impact: operators may delete or repoint live dependencies during cleanup; blast radius and environment confusion are high.
- Root cause / correction: historical bridge/cutover. Freeze identifiers, rehearse migration, and cut over one dependency at a time with rollback.
- Complexity / regression risk / tests: very high/high. Separate project with data, auth, upload, Plaid, and rollback rehearsals.
- Production affected / blocker: documented current architecture; not a day-to-day blocker.

### BYNK-AUDIT-015 — Landing page exposes a named-business demo scene

- Severity / confidence / status: **LOW / High / confirmed content defect**.
- Feature / role / class: landing page; public; frontend/privacy/brand.
- Location: `bynkbook-web/src/app/page.tsx:25-43,315`.
- Expected vs actual: demo data should be clearly fictional/generic. Production shows `Flo Vapor and More Dallas • May 2026` with hardcoded transaction metrics.
- Evidence/reproduction: open production `/`; browser snapshot confirms text.
- Impact: can look like customer data exposure or imply real operational figures even if fictional.
- Root cause / correction: design mock embedded directly. Replace with obviously fictional, labeled sample data.
- Complexity / regression risk / tests: trivial/low; content assertion/screenshot test.
- Production affected / blocker: confirmed; no normal-use block.

### BYNK-AUDIT-016 — Public text actions have undersized touch targets

- Severity / confidence / status: **LOW / High / accessibility defect**.
- Feature / role / class: auth/legal navigation; public/mobile; frontend/accessibility.
- Location: landing/login/signup/recovery footer text buttons.
- Expected vs actual: touch targets should generally be around 44×44 CSS pixels. At 390×844, Privacy, Terms, Sign in, Forgot password, and similar text buttons measured 16px high.
- Evidence/reproduction: mobile browser evaluation recorded bounding boxes; no horizontal overflow occurred.
- Impact: harder use for touch and motor-impaired users.
- Root cause / correction: bare inline text buttons without minimum hit area. Add transparent padding/min-size while preserving appearance.
- Complexity / regression risk / tests: low/low; automated bounding-box and accessibility checks.
- Production affected / blocker: confirmed; usability issue only.

### BYNK-AUDIT-017 — Unused handler re-export shims remain

- Severity / confidence / status: **LOW / High / dead code**.
- Feature / role / class: backend build; developers; maintainability.
- Location: 24 files matching `infra-sst/packages/functions/src/*.handler.ts`.
- Expected vs actual: SST handler strings such as `accounts.handler` resolve `accounts.ts` export `handler`; extra `accounts.handler.ts`-style re-exports are not mapped by SST.
- Evidence/reproduction: compare 49 handler strings with filenames/import graph.
- Impact: source ambiguity and audit/build noise; no user defect.
- Root cause / correction: obsolete handler convention migration. Prove no external imports, delete in cleanup PR.
- Complexity / regression risk / tests: low/low; typecheck/tests/SST synth.
- Production affected / blocker: no.

### BYNK-AUDIT-018 — Dev dialog gallery ships as a production route

- Severity / confidence / status: **LOW / High / production hygiene**.
- Feature / role / class: `/dev/dialogs`; authenticated users; frontend/deployment.
- Location: `bynkbook-web/src/app/(app)/dev/dialogs/*`; build route list.
- Expected vs actual: internal component galleries should be environment-gated or excluded. Production build generates `/dev/dialogs`; AppShell auth protects it but no dev-role gate exists.
- Evidence/reproduction: `npm run build` route manifest.
- Impact: confusing unsupported UI and extra bundle surface; no data mutation seen.
- Root cause / correction: development playground placed under production App Router tree.
- Complexity / regression risk / tests: low/low; gate or move to Storybook/dev-only tooling.
- Production affected / blocker: likely route exists; no normal-use block.

### BYNK-AUDIT-019 — Core page clients are monolithic

- Severity / confidence / status: **LOW / High / design limitation**.
- Feature / role / class: reconcile/ledger/settings; authenticated users/developers; frontend/performance/maintainability.
- Location: reconcile 7,521 lines, ledger 5,951, settings 4,007.
- Expected vs actual: independent concerns should be isolated for testability and stable rendering. Large components combine queries, derived data, dialogs, exports, and UI.
- Evidence/reproduction: source line/byte measurement; local static chunks total ~4.0 MB uncompressed across 79 files, with two ~400 KB chunks.
- Impact: higher regression risk and slower review; no measured production slowness established.
- Root cause / correction: feature accumulation. Extract state machines/sections incrementally after safety tests exist.
- Complexity / regression risk / tests: high/high; require component and E2E coverage first.
- Production affected / blocker: maintainability risk, not a current blocker.

### BYNK-AUDIT-020 — No frontend automated test suite

- Severity / confidence / status: **INFO / High / missing test**.
- Feature / role / class: all web workflows; all roles; quality.
- Location: `bynkbook-web`; Playwright is installed but no test files/config or test script exists.
- Expected vs actual: auth, navigation, forms, financial displays, mobile, and error states should have repeatable tests. Only lint/typecheck/build are configured.
- Evidence/reproduction: file/script inventory.
- Impact: frontend regressions can reach production despite clean builds.
- Root cause / correction: backend-first testing investment. Add focused component tests and safe mocked/stage Playwright flows.
- Complexity / regression risk / tests: medium/low; tests are the correction.
- Production affected / blocker: no direct defect; remediation dependency for major refactors.

### BYNK-AUDIT-021 — Authenticated production workflows were not executed

- Severity / confidence / status: **INFO / High / audit limitation**.
- Feature / role / class: 20 accounting/admin workflows; all authenticated roles; end-to-end.
- Location: production environment/test access.
- Expected vs actual: safe test users/businesses should exercise reads and reversible test actions. None were provided; only public/auth render, route guards, health, CORS, and unauth rejection were verified.
- Evidence/reproduction: browser session remained signed out; no credentials or production records were used.
- Impact: production-only contract/data/authz defects may remain.
- Root cause / correction: safety boundary and missing fixtures. Provide approved test tenant with synthetic data and explicit mutation limits.
- Complexity / regression risk / tests: medium/low with fixtures.
- Production affected / blocker: unknown; blocks full E2E assurance.

### BYNK-AUDIT-022 — SST build/synth was not run

- Severity / confidence / status: **INFO / High / audit limitation**.
- Feature / role / class: infrastructure deployment; operators; infrastructure/quality.
- Location: `infra-sst`.
- Expected vs actual: infrastructure validation would include SST build/synth for prod. After the mandatory AWS profile failure, the audit avoided any command that might resolve/account-inspect AWS or require production secrets. Typecheck and Prisma validation did pass.
- Evidence/reproduction: command log.
- Impact: packaging/construct/runtime-binding errors beyond TypeScript may remain.
- Root cause / correction: required safety hard stop. Run synth after AWS identity and required non-secret environment are established.
- Complexity / regression risk / tests: low/none for validation.
- Production affected / blocker: unknown; blocks complete deployment assurance, not current runtime use.
