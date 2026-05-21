# Bynkbook Production Readiness Smoke Gate

## Purpose

This gate protects Bynkbook production verification and deployment by requiring:

- Correct AWS identity.
- Clean main branch.
- Passing local checks.
- Read-only production smoke checks unless explicit approval is given.
- No production data mutation without approved test records.
- Clear stop rules.

## When To Use This Gate

Use this gate:

- Before any production deployment.
- Before production API checks.
- Before production smoke testing.
- After deployment when explicitly approved.
- After Ledger/Reconcile/Category Review/Plaid/AI suggestion changes.
- Before asking a non-technical operator to validate production.

## Absolute Stop Rules

STOP immediately if:

- AWS account does not equal 116846786465.
- AWS_PROFILE is not ledrigo-dev.
- Current git branch is not main for deployment/preflight.
- Local main is not up to date with origin/main.
- Git status is dirty.
- Validation checks fail.
- Production smoke check would mutate real financial data.
- User has not explicitly approved deployment.
- Production app/API URL differs from the approved URLs.
- Plaid/bank sync testing would affect real production records without approved test business/test records.
- Any command would use default AWS profile.
- Any uncertainty exists about account, branch, environment, or data safety.

## Approved Production Targets

Production app:
https://app.bynkbook.com

Production API:
https://actwy6st05.execute-api.us-east-1.amazonaws.com

Expected AWS account:
116846786465

Required AWS profile:
ledrigo-dev

## AWS Identity Verification

PowerShell:

```powershell
$env:AWS_PROFILE="ledrigo-dev"
aws sts get-caller-identity
```

Expected:

- Account must be 116846786465.

Rules:

- Do not use default AWS profile.
- Do not continue if account differs.
- Do not run production API checks before this passes.
- Save/copy the command output into the validation notes if doing a deployment or production smoke check.

## Local Repo Preflight

PowerShell:

```powershell
cd C:\Users\abbas\Bynkbook-app
git checkout main
git pull origin main
git status
```

Expected:

- Branch is main.
- Up to date with origin/main.
- Working tree clean.

## Local Validation Preflight

PowerShell:

```powershell
cd C:\Users\abbas\Bynkbook-app\bynkbook-web
npm run lint
npm run build
```

Infra command:

```powershell
cd C:\Users\abbas\Bynkbook-app\infra-sst
npm run typecheck
```

Targeted function tests:

```powershell
cd C:\Users\abbas\Bynkbook-app\infra-sst\packages\functions
npx vitest run src/ledgerSummary.test.ts src/entriesApplyCategoryBatch.test.ts src/lib/categorySuggestionScoring.test.ts src/bankTransactions.test.ts
```

Note:
If repo scripts or test paths change, use the actual current scripts and document any skipped checks.

## Deployment Approval Gate

- This document does not approve deployment by itself.
- Deployment requires explicit user approval in the current conversation or task.
- If approval is not explicit, stop before deployment.
- Never deploy from a feature branch.
- Never deploy with dirty git status.
- Never deploy from wrong AWS account.
- Never deploy if checks are failing unless user explicitly approves a known non-blocking issue.

## Read-Only Production Smoke Checklist

Only run after AWS identity is confirmed and production smoke is approved.

Read-only checks:

- Open https://app.bynkbook.com.
- Confirm app loads.
- Confirm login page loads.
- Login only with approved test account/test business if available.
- Confirm dashboard loads.
- Confirm Ledger page loads.
- Confirm Reconcile page loads.
- Confirm Category Review page loads.
- Confirm sync status areas display clearly.
- Confirm no obvious broken navigation.
- Confirm dark mode/readability if available.
- Confirm mobile/narrow width basic usability if practical.

Strictly avoid:

- Creating real entries.
- Deleting/voiding/restoring real entries.
- Matching/unmatching/reverting real transactions.
- Running Plaid sync on real production records.
- Applying AI category suggestions.
- Bulk applying suggestions.
- Changing business/account settings.

Do not perform any avoided action unless an approved test business/test record is being used and the user explicitly approves mutation.

## Production API Smoke Checklist

Only run after AWS identity is confirmed and production API smoke is explicitly approved.

Rules:

- Prefer safe GET/health/read-only endpoints only.
- Do not call mutation endpoints.
- Do not create/delete/update/match/unmatch/revert records.
- Do not run Plaid sync/import endpoints against real production records unless explicitly approved.

Placeholder guidance:

- Use the current documented health/read-only endpoints if available.
- If no safe health endpoint is documented, do not invent one; verify through the app UI instead.

## Accounting Flow Smoke Checklist

Read-only checks:

- Ledger loads.
- Ledger totals look present and not obviously broken.
- Reconcile loads.
- Review queues render.
- Matched/review sections render.
- Category Review loads.
- AI suggestion metadata appears where available.
- Sync/stale state does not look misleading.
- No obvious runtime errors in browser console if checked.

## Plaid / Bank Sync Safety

- Do not run production Plaid sync unless explicitly approved.
- If Plaid sync is approved, use approved test business/test bank connection only.
- Confirm expected account and business before sync.
- Verify UI does not claim fake sync success.
- Verify new transactions are not hidden by filters/date/account selection.
- Do not mutate real production bank/reconcile records.

## Rollback / Stop Guidance

Stop and do not proceed if:

- App fails to load.
- Login fails unexpectedly.
- Ledger/Reconcile fails to load.
- Totals look obviously wrong.
- Production API returns unexpected errors.
- AWS account mismatch occurs.
- Any mutation accidentally occurs.
- Data safety is uncertain.

Rollback guidance:

- Do not attempt ad-hoc fixes in production.
- Record the issue, screenshot, timestamp, branch/commit, and environment.
- Revert through the normal GitHub/AWS deployment process only after explicit approval.
- If a PR caused the issue, revert the PR or create a hotfix PR.

## Evidence To Save

- AWS STS output if AWS was used.
- Git branch/status output.
- Validation command outputs.
- PR number / commit SHA.
- Production app URL checked.
- Production API URL checked, if any.
- Screenshots of Ledger/Reconcile/Category Review.
- Notes on whether checks were read-only or mutated approved test data.
- Any errors/warnings.

## Pass / Fail Decision

PASS only if:

- AWS identity is correct when AWS/prod checks are used.
- Branch/status/checks are clean.
- No unauthorized production mutation occurred.
- App loads.
- Ledger/Reconcile/Category Review load.
- Production smoke is read-only unless mutation was explicitly approved.
- No critical accounting display issue is observed.

FAIL if:

- Wrong AWS account/profile.
- Dirty git status before deployment.
- Checks fail without approved exception.
- Production app/API checks run without identity verification.
- Production data is mutated without approval.
- Ledger/Reconcile/Category Review fails to load.
- Totals or sync state appear misleading.
- Uncertainty exists about environment or data safety.
