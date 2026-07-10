# BynkBook complete-system audit — executive summary

Audit date: 2026-07-10

Audit commit baseline: `fec8aff`

Audit mode: documentation and read-only verification only

## Founder summary

BynkBook's codebase is broadly healthy and the public production site is reachable. The frontend builds cleanly, the backend typechecks, the database schema validates, and all 259 backend tests pass. Public login, signup, recovery, legal, and protected-route redirect screens rendered without browser console errors at desktop and mobile widths. The live frontend bundle points to the current `cpjh7t19u1` API, whose health endpoint returned 200 and whose protected endpoint returned 401 without a token.

The system is not fully production-verified. The required AWS CLI profile is absent, so deployed AWS resources, logs, alarms, backups, IAM, and current production data shapes could not be independently inspected. No safe production test account was provided, so authenticated accounting workflows were traced through code but not executed against production.

The most serious confirmed application defect is the vendor statement export: its SQL references a `reversed_at` column that does not exist in the schema or migrations. The public Privacy Policy and Terms of Service openly identify themselves as placeholder text. Dependency scans also report high-severity advisories in both frontend and backend dependency trees. The API hostname supplied in the audit brief, `actwy6st05…`, does not resolve; the deployed web bundle and current repository operations documents use `cpjh7t19u1…` instead.

## Overall assessment

| Area | Assessment |
|---|---|
| Public availability | Working with warnings |
| Frontend code health | Good; build, typecheck, and lint pass |
| Backend code health | Good baseline; typecheck and 259 tests pass |
| Core accounting implementation | Substantial and business-scoped; authenticated production behavior not verified |
| Data integrity | Generally deliberate; two AP defects need correction |
| Authentication | Cognito/Amplify architecture is coherent; public and route-guard surfaces work |
| Authorization | Static role allowlists exist; editable policy matrix is not dependable enforcement |
| Security posture | Needs dependency updates, export hardening, and response headers |
| AWS/deployment | Blocked from independent inspection; repository documents a fragile production bridge |
| Production readiness | Conditional; suitable for controlled use only after immediate high-risk review |

## Findings by severity

| Severity | Count |
|---|---:|
| CRITICAL | 0 |
| HIGH | 5 |
| MEDIUM | 8 |
| LOW | 5 |
| INFO | 4 |
| **Total** | **22** |

## Highest-risk items

1. `BYNK-AUDIT-001`: vendor AP statement export queries nonexistent `bill_payment_application.reversed_at`.
2. `BYNK-AUDIT-002`: production legal pages contain explicit placeholder legal copy.
3. `BYNK-AUDIT-003` and `004`: npm reports 5 high frontend and 12 high backend dependency advisories.
4. `BYNK-AUDIT-005`: the audit brief's production API hostname does not resolve, while production currently uses another API.
5. `BYNK-AUDIT-006` and `007`: the editable role policy system is store-only/default-off and several writes request only `VIEW` policy strength.
6. `BYNK-AUDIT-008`: a second apply/unapply cycle for the same bill and entry can violate the database unique constraint.
7. `BYNK-AUDIT-009`: CSV exports do not neutralize spreadsheet formula prefixes.

## Data-risk statement

No evidence of an active cross-tenant data exposure or authentication bypass was found in static review. Business-scoped membership checks are consistently present in sampled handlers, the API rejects unauthenticated protected requests, Plaid webhook signatures are verified, database TLS validation is enabled in infrastructure configuration, and no obvious committed credentials were found by common-pattern scanning.

Data risk is nevertheless not fully cleared because production database contents, deployed IAM, S3 policy, backup state, CloudWatch logs, and tenant-isolation behavior could not be inspected through AWS. The AP uniqueness defect can block repeated payment allocation reversals, and CSV formula injection can turn exported user-controlled text into spreadsheet formulas.

## Is it safe to continue using?

Continue only with controlled internal use and heightened caution around vendor statement exports, permission-policy expectations, CSV exports, and production deployment configuration. Do not represent the placeholder legal pages as approved legal terms. Do not change production infrastructure until the AWS profile/account can be verified. There is no evidence requiring an emergency shutdown, but the high findings should enter immediate triage.

## Immediate founder actions

1. Confirm the canonical production API is `cpjh7t19u1` and determine whether anything still depends on `actwy6st05`.
2. Have counsel approve real Privacy Policy and Terms of Service text.
3. Provide the `ledrigo-dev` AWS profile and a read-only/safe production test account for the blocked audit checks.
4. Treat the Roles & Permissions matrix as advisory until enforcement is completed and tested.
5. Avoid vendor-statement export and opening BynkBook CSV exports in privileged spreadsheet environments until fixed.
6. Approve a separate emergency-stabilization PR for findings 001, 003, 004, 005, 008, and 009.

## Recommended remediation order

1. Emergency stabilization: fix vendor statement SQL; confirm canonical API/webhook routing.
2. Security and legal: replace legal copy; dependency upgrades; CSV hardening; security headers.
3. Authorization: make policy enforcement explicit and correct all write-level mappings.
4. AP data integrity: replace the boolean composite uniqueness design with an active-row constraint.
5. Observability and AWS: add/verify logs, alarms, rate controls, backups, and IAM after account verification.
6. Coverage and maintainability: authenticated E2E tests, frontend tests, dead-code removal, and page decomposition.

No application code, AWS resource, configuration, or production data was changed by this audit.
