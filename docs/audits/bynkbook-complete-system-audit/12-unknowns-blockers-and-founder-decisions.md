# Unknowns, blockers, and founder decisions

## Hard blockers

1. **AWS profile missing.** The required `ledrigo-dev` profile is not configured, so account `116846786465` was not verified and no AWS CLI inspection was allowed.
2. **No approved production test account/tenant.** Authenticated reads and all financial/admin workflows were intentionally not executed.

GitHub's app connector could not create the PR (403), and `gh auth status` reported an invalid default token; however, the branch push and CLI fallback successfully created draft PR #206, so publication is no longer blocked.

## Deployment unknowns

- Whether `cpjh7t19u1` route/Lambda configuration exactly matches current `main`.
- Whether any client or Plaid configuration still targets nonresolving `actwy6st05`.
- Effective API authorizer issuer/audience, Lambda environment-variable names, timeouts, concurrency, bundle versions, and aliases.
- Effective IAM permissions versus SST intent.
- API access logs, WAF/rate limits, CloudWatch alarms/dashboards, recent errors/throttles/timeouts.
- Amplify production environment variables, build history, current source commit, cache invalidation, and rollback readiness.
- Route 53 records and ownership for `api.bynkbook.com`.
- Whether deployed resources exist that are absent from repository/IaC or vice versa.

## Data/storage unknowns

- Current migration table/state and whether production columns/indexes match Prisma.
- Existing duplicates/orphans/invalid statuses/old record shapes/stale/demo rows.
- Actual tenant-isolation behavior under swapped business/account IDs.
- RDS encryption, deletion protection, backup/PITR, snapshot retention, restore success, engine patch level, and capacity.
- S3 public-access block, bucket policy, encryption, versioning, lifecycle, object lock, CORS, logging, and malware controls.
- Whether seven-day backup retention from prior documentation is still current and adequate.
- Whether customer data already contains formula-prefix values in exportable fields.

## Authentication/security unknowns

- Cognito password/MFA/risk policies, disabled/deleted users, refresh/revocation behavior, and global-session expectations.
- Google OAuth callback/logout settings and current identity-provider configuration.
- Actual business `authz_mode`/wave distribution; any business already using ENFORCE could be affected by `BYNK-AUDIT-007`.
- Rate limiting/account enumeration/abuse behavior under load.
- Dependency advisory reachability in deployed frontend and Lambda bundles.
- Complete privacy/legal obligations, subprocessors, retention commitments, and jurisdiction.

## Product-intent questions for the founder

1. Is `cpjh7t19u1` now the sole canonical production API, and may all `actwy6st05` references be treated as legacy after Plaid verification?
2. Is the landing-page business name fictional, approved marketing content, or derived from a real business?
3. Should the default session maximum be 12 hours (marketing) or seven days (code fallback)?
4. Are custom role policies intended to be enforceable now, or should the Settings editor be removed/disabled until completion?
5. What exact write permissions should ACCOUNTANT and BOOKKEEPER have for vendors, uploads, settings, categories, AP, and ledger?
6. Should a payment allocation support unlimited apply/unapply history? The current model implies yes through void history, but the index prevents it.
7. What RPO/RTO and backup retention are required for financial/customer records?
8. Is `/dev/dialogs` intentionally available to every authenticated production user?
9. Which AI features are approved for production data, and what disclosure/retention terms are required?
10. Which communication/email system should send invitations/recovery/business messages? Current team invite creation stores records but no application email provider is represented.
11. Are budgets/goals/planning part of the supported paid product or experimental?
12. What accessibility target (WCAG level) and browser/device support matrix should be contractual?

## Intentionally untested actions

- Sign up/confirm/sign in/OAuth/reset with real identity.
- Create/update/delete/reset/backup a production business.
- Create/edit/delete/restore/merge entries or transfers.
- Connect/disconnect/reconnect/sync Plaid or alter opening date/balance.
- Upload/download/import customer files or run Textract.
- Match/unmatch/revert bank transactions; scan/apply issues; close/reopen periods.
- Create/edit vendors/bills/payments/applications; export customer statements.
- Apply AI/category suggestions or send OpenAI production data.
- Invite, role-change, or remove users.
- Read production database records, S3 keys, secrets, or CloudWatch log events.
- Deploy, synthesize against AWS, update DNS/config, invalidate cache, or modify any resource.

## Assumptions that are not facts

- Repository operations docs dated 2026-07-09 are treated as historical evidence, not independent deployed truth.
- Current production likely follows `main`, but the exact deployed commit was not verified.
- The vendor statement SQL defect likely affects production if current code is deployed, but no authenticated request proved it.
- Dependency advisories are real in lockfiles; runtime exploitability is not established.
- Static tenant scoping looks consistent; live isolation is not proven.

## Inputs required to complete blocked audit work

- A least-privilege read-only `ledrigo-dev` AWS profile that returns account `116846786465`.
- An approved synthetic test tenant and accounts for each role, with explicit allowed mutations.
- Confirmation of canonical API/Plaid webhook targets.
- Counsel-approved legal text or owner of that process.

Until those inputs exist, do not convert UNKNOWN/NOT_TESTABLE statuses into claims of production correctness.
