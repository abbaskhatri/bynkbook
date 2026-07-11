# Full Deduplicated Remediation Status

Updated on 2026-07-11 from the complete-system audit and the Plaid/account/reconciliation audit. Original finding IDs are preserved. A status of resolved means the correction is committed and locally verified; it does not mean it has been deployed.

## Summary

| Status | Open-list findings | Including 3 previously resolved baseline findings |
|---|---:|---:|
| Resolved and verified locally | 27 | 30 |
| Partially remediated; external verification or migration remains | 3 | 3 |
| Blocked by business input, production access, or a dedicated migration | 3 | 3 |
| Open maintainability refactor | 1 | 1 |
| Total | 34 | 37 |

## High findings

| ID | Status | Result |
|---|---|---|
| BYNK-AUDIT-002 | BLOCKED_BUSINESS_INPUT | Placeholder legal copy must be replaced with counsel/business-approved terms, entity/contact details, jurisdiction, retention, subprocessors, and effective dates. Code cannot safely invent these commitments. |
| BYNK-AUDIT-004 | RESOLVED_CODE_VERIFIED | Production dependencies audit at zero. Full tooling audit has only two low SST/AWS SDK v2 advisories; CDK and vulnerable transitive tooling were upgraded/overridden without a forced SST major migration. |
| BYNK-AUDIT-005 | RESOLVED_CODE_VERIFIED | Tracked production environment and bridge documentation now use the canonical `cpjh7t19u1` API; retired `actwy6st05` is explicitly marked non-resolving and prohibited. |
| BYNK-PLAID-AUDIT-001 | RESOLVED_CODE_VERIFIED | Opening application recomputes the financial amount server-side and rejects invalid choices. |
| BYNK-PLAID-AUDIT-002 | RESOLVED_CODE_VERIFIED | Opening-date changes protect active legacy and MatchGroup links and soft-remove eligible history instead of deleting it. |
| BYNK-PLAID-AUDIT-003 | RESOLVED_CODE_VERIFIED | Plaid credit-card balances use the local liability sign convention. |
| BYNK-PLAID-AUDIT-004 | RESOLVED_CODE_VERIFIED | Match claims are serialized with PostgreSQL advisory locks, preventing concurrent active claims. |
| BYNK-PLAID-AUDIT-005 | RESOLVED_CODE_VERIFIED | Reconnect repair validates Plaid account identity, type, currency, and mask before remapping. |

## Medium findings

| ID | Status | Result |
|---|---|---|
| BYNK-AUDIT-006 | RESOLVED_CODE_VERIFIED | Role policy enforcement defaults on at wave 4, legacy bypass mode now enforces, effective defaults are returned to the UI, and supported mutation families use the policy layer. The UI now states that page visibility remains controlled by static role allowlists. |
| BYNK-AUDIT-007 + BYNK-PLAID-AUDIT-013 | RESOLVED_CODE_VERIFIED | All identified mutation checks require `FULL`; Plaid and account lifecycle operations also enforce `bank_connections` policy after static role checks. |
| BYNK-AUDIT-008 | RESOLVED_CODE_VERIFIED | AP uses an active-only partial unique index, preserving repeated inactive application history. |
| BYNK-AUDIT-009 | RESOLVED_CODE_VERIFIED | Frontend and backend CSV exporters share spreadsheet-formula neutralization with malicious-prefix tests. |
| BYNK-AUDIT-010 | RESOLVED_CODE_VERIFIED | CSP, HSTS, frame, MIME, referrer, permissions, and opener headers are configured; the Next.js signature header is disabled. |
| BYNK-AUDIT-011 | RESOLVED_CODE_VERIFIED | The tracked production environment contains verified API/Cognito identifiers and clean production builds pass. |
| BYNK-AUDIT-012 | PARTIAL_EXTERNAL_SETUP | IaC now defines API access-log retention, stage throttling, SQS/DLQ processing, backlog/dead-letter alarms, and a recovery runbook. An approved SNS topic/subscriber list and controlled delivery test are still required; WAF adoption remains a production architecture choice. |
| BYNK-AUDIT-014 | BLOCKED_PRODUCTION_MIGRATION | Dev-named live Cognito, upload, KMS, and database dependencies cannot be renamed safely in an application-code pass. This requires inventory, data/auth migration, staged cutover, rollback, and deployment approval. |
| BYNK-PLAID-AUDIT-006 | RESOLVED_CODE_VERIFIED | Verified webhooks enqueue durable sync jobs with a DLQ and partial batch retries. |
| BYNK-PLAID-AUDIT-007 | RESOLVED_CODE_VERIFIED | Capped sync retains its update flag and the client automatically continues bounded drain calls. |
| BYNK-PLAID-AUDIT-008 | RESOLVED_CODE_VERIFIED | Date-wide historical cutoff was removed; exact soft-removed IDs remain suppressed without hiding unseen history. |
| BYNK-PLAID-AUDIT-009 | RESOLVED_CODE_VERIFIED | Final local disconnect removes the Plaid Item first and preserves mapping state if Plaid does not confirm removal. |
| BYNK-PLAID-AUDIT-010 | RESOLVED_CODE_VERIFIED | Multi-account database creation is atomic. |
| BYNK-PLAID-AUDIT-011 | RESOLVED_CODE_VERIFIED | The amount/date/name replacement heuristic was removed; distinct source facts retain distinct durable identity. |
| BYNK-PLAID-AUDIT-012 | RESOLVED_CODE_VERIFIED | New-account onboarding returns `202 PENDING_SYNC` for deferred work and the frontend no longer claims false sync success. |

## Low findings

| ID | Status | Result |
|---|---|---|
| BYNK-AUDIT-015 | RESOLVED_CODE_VERIFIED | Public demo content is explicitly fictional and generic. |
| BYNK-AUDIT-016 | RESOLVED_CODE_VERIFIED | Identified public/auth text actions now have accessible touch target sizing. |
| BYNK-AUDIT-017 | RESOLVED_CODE_VERIFIED | All 24 unused handler re-export shims were removed; typecheck and tests pass. |
| BYNK-AUDIT-018 | RESOLVED_CODE_VERIFIED | The `/dev/dialogs` production route was removed and is absent from the build route list. |
| BYNK-AUDIT-019 | OPEN_REFACTOR | Reconcile, ledger, and settings clients remain monolithic. Decomposition is a high-regression architectural program and should follow broader component/E2E coverage; it is not a proven accounting defect. |
| BYNK-PLAID-AUDIT-014 | RESOLVED_CODE_VERIFIED | Matched source removals retain accounting history while recording and displaying a separate Plaid source-removal state. |
| BYNK-PLAID-AUDIT-015 | RESOLVED_CODE_VERIFIED | Auto-reconcile no longer truncates expected candidates to the first 250; split-subset work remains explicitly bounded. |

## Informational and verification debt

| ID | Status | Result |
|---|---|---|
| BYNK-AUDIT-020 | RESOLVED_CODE_VERIFIED | Vitest is configured for the frontend with an initial security regression suite. Broader component/E2E coverage remains desirable but the absence finding is closed. |
| BYNK-AUDIT-021 | BLOCKED_TEST_ACCESS | Authenticated production workflows still require an approved synthetic test tenant, credentials, and explicit mutation limits. No customer data was used. |
| BYNK-AUDIT-022 | PARTIAL_EXTERNAL_VERIFICATION | The invalid `sst build` script was replaced by repeatable typecheck/Prisma validation and a documented `sst diff` command. Validation passes; a real diff remains blocked because no AWS profile is configured in this environment. |
| BYNK-PLAID-AUDIT-016 | PARTIAL_PRODUCTION_MIGRATION | New legacy `BankMatch` write routes are no longer deployed; new matching uses MatchGroup exclusively. Historical BankMatch rows remain readable until production counts and a reversible data migration are approved. |

## Previously resolved baseline findings

- BYNK-AUDIT-001 — vendor statement SQL corrected and export coverage retained.
- BYNK-AUDIT-003 — frontend production dependency advisories resolved.
- BYNK-AUDIT-013 — the earlier audit's AWS access blocker was resolved for that audit; the current remediation environment again has no configured AWS profile, as recorded under BYNK-AUDIT-022.

## Latest local verification

- Backend: 26 test files, 284 tests passed.
- Frontend: 7 unit tests passed; ESLint passed; Next.js 16.2.10 production build passed with 33 routes.
- Infrastructure: TypeScript validation and Prisma schema validation passed.
- Dependencies: frontend and backend production dependency audits report zero vulnerabilities; full infrastructure tooling audit reports two low advisories in SST's AWS SDK v2 chain.
- Git diff whitespace validation passed.
- Not performed: deployment, database migration execution, AWS resource changes, production data changes, authenticated production E2E, or live Plaid actions.
