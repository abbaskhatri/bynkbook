# Bynkbook Accounting Flow Regression Checklist

## Purpose

This checklist verifies Ledger, Reconcile, Category Review, AI category suggestions, bulk apply safety, inactive-record exclusion, totals correctness, and production-safe verification after accounting-flow changes.

## When To Run

- After Ledger changes.
- After Reconcile changes.
- After Category Review changes.
- After AI/category suggestion changes.
- After backend ledger summary changes.
- Before production deployment.
- After production deployment smoke checks if deployment is explicitly approved.

## AWS Identity Rule For Bynkbook

PowerShell:

```powershell
$env:AWS_PROFILE="ledrigo-dev"
aws sts get-caller-identity
```

Expected AWS account:
116846786465

Production app:
https://app.bynkbook.com

Production API:
https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com

Rules:
- Do not run production API checks unless AWS identity is confirmed.
- Do not deploy unless explicitly approved.
- Do not use the default AWS profile.
- If AWS account does not match 116846786465, stop.

## Local Repo Sync

```powershell
cd C:\Users\abbas\Bynkbook-app
git checkout main
git pull origin main
git status
```

## Local Validation Commands

```powershell
cd C:\Users\abbas\Bynkbook-app\bynkbook-web
npm run lint
npm run build
npm run dev
```

For infra/functions checks:

```powershell
cd C:\Users\abbas\Bynkbook-app\infra-sst
npm run typecheck

cd C:\Users\abbas\Bynkbook-app\infra-sst\packages\functions
npx vitest run src/ledgerSummary.test.ts src/entriesApplyCategoryBatch.test.ts src/lib/categorySuggestionScoring.test.ts
```

Note:
If package paths or tests differ, operator should use the actual repo scripts and targeted tests.

## Ledger Checklist

- Ledger page loads.
- Table does not freeze.
- Active totals exclude deleted, soft-deleted, voided, removed, inactive generated entries, and non-INCOME/EXPENSE records.
- INCOME is positive.
- EXPENSE is negative.
- Expected rows appear in review-priority area.
- Partially matched rows appear in review-priority area.
- Matched rows stay out of review queue and use normal date order.
- Long payee/category/memo text does not break layout.
- Action buttons remain visible.
- Category suggestion chips/details still display.
- Review-required/warning suggestions do not apply immediately.
- Dark mode remains readable.
- Mobile/narrow width remains usable.

## Reconcile Checklist

- Reconcile page loads.
- Review queue does not include fully matched records.
- Expected/partial records are easy to review.
- Matched records remain in matched/normal order.
- Match flow works.
- Unmatch flow works.
- Revert flow remains confirmation-protected.
- Create-entry-and-match flow remains safe.
- Row actions do not freeze the whole page.
- Totals/counts exclude inactive records.
- No stale prod labels or stale explanatory notes appear.
- Dark mode remains readable.
- Mobile/narrow width remains usable.

## Reconcile Revert / Duplicate Safety Checklist

- Existing match can be reviewed before unmatch.
- Unmatch confirmation explains whether the ledger entry remains.
- Revert generated entry confirmation explains what will be removed/unlinked.
- Bank transaction remains reviewable after revert/unmatch where intended.
- Create-entry-and-match cannot be triggered twice from stale/pending rows.
- Already matched bank transactions cannot create duplicate ledger entries.
- Partial matches remain review-priority until fully resolved.
- Failed match/unmatch/revert does not fake success.
- Row actions are disabled while pending.
- Destructive or risky reconcile actions remain confirmation-protected.
- No production data mutation during smoke checks unless explicitly approved.

## Plaid / Bank Transaction Visibility Checklist

- Correct AWS identity is verified before any production API check.
- Sync action shows clear state: syncing, succeeded, failed, or stale where available.
- Last synced value is visible where available.
- New transactions appear after successful sync/import.
- If new transactions do not appear, active filters/date/account/search are visible.
- Empty state distinguishes no records from filters hiding records.
- Balance freshness is not misrepresented as transaction-list freshness.
- Reconcile refreshes bank candidates after sync/import.
- Ledger refreshes relevant bank/ledger data after sync/import where that surface supports bank sync.
- No fake import counts or fake sync success.
- No production data mutation during smoke checks unless explicitly approved.

## Category Review Checklist

- Category Review page loads.
- Suggestions show suggested category.
- Suggestions show confidence where available.
- Suggestions show reason where available.
- Warnings are visible for risky suggestions.
- Review-required/protected suggestions are visually distinct.
- Single apply requires explicit user click.
- Risky/review-required suggestions remain manual.
- Auto Fix/bulk apply excludes risky/review-required/protected suggestions.
- Auto Fix/bulk apply excludes suggestions with warnings.
- Auto Fix/bulk apply excludes low confidence suggestions.
- Auto Fix/bulk apply excludes missing category/confidence suggestions.
- Inactive records are not included.
- Deleted/soft-deleted/voided/removed entries are excluded.

## AI Suggestion Scenario Checklist

IRS / EFTPS:
- Shows tax warning.
- Requires review/CPA confirmation.
- Not bulk-applied as safe.

Credit card payment:
- Warns it may be transfer/payment.
- Not treated as automatic expense.
- Not bulk-applied as safe.

Amazon:
- Shows ambiguity warning unless history is strong.
- Requires review if uncertain.

Zelle received:
- Requires review unless known safe history supports it.
- Does not assume income type from sender alone.

Zelle sent:
- Requires review.
- Does not assume expense type from Zelle alone.

ACH / wire:
- Requires review unless vendor/history clearly supports safe category.
- Does not assume transfer/payment/income blindly.

Payroll / Gusto / ADP:
- Payroll category may be high confidence.
- Payroll tax/treatment still may require review depending context.

Bank fee:
- Can be high confidence if description clearly indicates service fee.

Refund:
- Requires review and should usually map back to original transaction/category.

## Soft Delete / Void / Restore Checklist

- Deleted entries do not affect active totals.
- Soft-deleted entries do not affect active totals.
- Voided entries do not affect active totals.
- Removed entries do not affect active totals.
- Inactive generated entries do not affect active totals.
- Restore returns item to active truth only if app action succeeds.
- History/audit visibility is preserved where intended.

## Destructive Action Checklist

- Delete requires confirmation.
- Void requires confirmation if present.
- Revert requires confirmation.
- Bulk operations require confirmation.
- No destructive action is hidden inside AI suggestion apply.
- Major destructive actions use typed confirmation if current app pattern supports it.
- Failed destructive actions do not fake success.

## Totals And Balance Checklist

- Ledger totals are correct.
- Reconcile totals/counts are correct.
- Running balance fallback excludes inactive records.
- Backend ledger summary excludes inactive records.
- Backend ledger summary excludes non-INCOME/EXPENSE records.
- Print/export totals, if present, match active truth.
- Reports/summaries, if affected by same helper, match active truth.

## Production-Safe Smoke Checklist

For production deployment or production smoke checks, use:
docs/qa/production-readiness-smoke-gate.md

Optional read-only preflight helper:
scripts/bynkbook-production-preflight.ps1

Only run after explicit approval.

First:

```powershell
$env:AWS_PROFILE="ledrigo-dev"
aws sts get-caller-identity
```

Confirm account:
116846786465

Then, and only then:
- Visit https://app.bynkbook.com
- Confirm app loads.
- Confirm login works if test account available.
- Confirm Ledger page loads.
- Confirm Reconcile page loads.
- Confirm Category Review page loads.
- Do not mutate production financial data unless using approved test business/test records.
- Do not deploy from this checklist unless deployment is explicitly approved.

## Pass / Fail Decision

PASS:
- Validation commands pass or known tool limitations are documented.
- Ledger/Reconcile/Category Review manual checks pass.
- No wrong-account AWS usage.
- No production mutation without approval.
- No unsafe AI auto-apply behavior.

FAIL:
- Totals include inactive records.
- AI bulk apply includes risky/review-required suggestions.
- Destructive actions bypass confirmation.
- Matched records clutter review queue.
- Wrong AWS account is used.
- Production API checks are run without identity confirmation.
