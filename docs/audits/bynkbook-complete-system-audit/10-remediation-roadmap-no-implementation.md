# Remediation roadmap — no implementation

Every phase below should be a separate reviewed PR or infrastructure change set. Do not combine production bridge migration with application fixes.

## Phase 1 — Emergency stabilization

- Scope: fix vendor statement SQL (`001`); confirm canonical API and every old-host consumer (`005`); publish an operator freeze note for the production bridge (`014`).
- Dependencies: safe staging/test vendor; verified AWS profile/account for API/webhook inspection.
- Risk: accounting export low/medium; API/webhook routing high.
- Verification: statement integration test; current/legacy health and signed Plaid webhook; no customer mutation.
- Separate PR: yes—one application fix PR and one independently approved infrastructure/config PR.

## Phase 2 — Critical security, legal, and data integrity

- Scope: replace legal placeholders (`002`); triage/upgrade frontend and backend dependency advisories (`003`,`004`); fix repeated AP allocation constraint (`008`); neutralize CSV formulas (`009`).
- Dependencies: counsel; test/staging DB migration plan; dependency reachability/bundle analysis.
- Risk: high for Prisma/Next/dependency and AP schema changes; low for legal copy/CSV helper.
- Verification: full local suite, clean build, migration rehearsal/rollback, repeated AP lifecycle, malicious CSV fixtures, auth/browser smoke.
- Separate PR: required for legal, frontend dependencies, backend dependencies, AP migration, and CSV changes.

## Phase 3 — Authorization completion

- Scope: decide whether policies are truly supported; correct all VIEW-on-write calls (`007`); remove contradictory UI/API flags or enable explicit business migration (`006`).
- Dependencies: founder-approved role matrix and backward-compatibility behavior.
- Risk: high; legitimate users can be locked out or over-permitted.
- Verification: exhaustive role × action × mode × wave tests, two-tenant tests, audit logs, staged rollout, rollback flag.
- Separate PR: yes; ideally backend enforcement, data migration, then UI activation.

## Phase 4 — Frontend/backend contract corrections

- Scope: add contract tests for vendor/AP, uploads, entries, reports, and error codes; validate production environment at build time (`011`); remove stale API sources only after consumer confirmation (`005`).
- Dependencies: stable API schema and synthetic tenant.
- Risk: medium.
- Verification: generated/fixture contracts, clean-room build, current production bundle host assertion, CORS/auth smoke.
- Separate PR: yes.

## Phase 5 — Performance and reliability

- Scope: measure authenticated production/stage route performance; add correlation IDs and structured redacted logs; define alarms/access logs/rate controls (`012`); add staged security headers (`010`).
- Dependencies: verified AWS read-only access, alert destination/owner, CSP endpoint inventory.
- Risk: medium; CSP/rate controls can disrupt integrations.
- Verification: latency/error/throttle dashboards, alarm drills, report-only CSP, OAuth/Plaid/upload/AI regression.
- Separate PR/change set: yes; infrastructure changes independently approved.

## Phase 6 — Test coverage

- Scope: frontend component/E2E suite (`020`); authenticated synthetic production/stage tenant (`021`); AP statement/reversal/CSV tests; tenant/role isolation; SST synth gate (`022`).
- Dependencies: fixture factory and non-customer identities/data.
- Risk: low.
- Verification: CI reports, deterministic cleanup, zero production mutation by default.
- Separate PR: yes; test-only foundation before refactors.

## Phase 7 — Cleanup and maintainability

- Scope: prove/delete unused handler shims (`017`); remove/gate dev route (`018`); incrementally split reconcile/ledger/settings (`019`); document route/handler ownership.
- Dependencies: Phase 6 tests.
- Risk: low for dead files/dev route; high for page decomposition.
- Verification: typecheck, 259+ tests, route manifest, SST synth, visual/E2E regression.
- Separate PR: one mechanical cleanup PR; one PR per major page extraction.

## Phase 8 — UX and accessibility

- Scope: enlarge public touch targets (`016`); replace named-business demo (`015`); run axe/Lighthouse/contrast/keyboard checks; validate authenticated mobile routes.
- Dependencies: frontend E2E harness and approved sample content.
- Risk: low.
- Verification: 390px/768px/desktop visual checks, 44px targets, keyboard/focus, screen-reader naming, no horizontal overflow.
- Separate PR: yes, can group low-risk public UI items.

## Phase 9 — Production bridge migration (separate program)

- Scope: only after stabilization, plan clean prod-named RDS/S3/Cognito/KMS/DNS resources to replace the documented bridge (`014`).
- Dependencies: verified AWS account, complete inventory, backups/restores, Cognito user migration strategy, S3 validation, Plaid webhook/token plan, maintenance window, rollback.
- Risk: very high.
- Verification: non-production rehearsal, record counts/hashes, auth test cohort, upload/download, read-only ledger/reconcile, rollback drill, confidence window.
- Separate PR/change program: mandatory; never combine with normal cleanup or dependency updates.

## Recommended next phase

Begin a separate **Emergency stabilization and verification** phase: (1) restore the required read-only AWS identity, (2) verify current API/Plaid routing and deployed logs without changes, (3) fix `BYNK-AUDIT-001` in an application PR with a synthetic integration test, and (4) obtain legal approval for `BYNK-AUDIT-002`. Do not begin bridge migration yet.
