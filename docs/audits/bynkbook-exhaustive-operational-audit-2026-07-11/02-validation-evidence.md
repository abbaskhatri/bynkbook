# Validation Evidence

Baseline: `e4d111db30079ae622e7a9cb22a3c4790cd01c6c`

## Repository checks

| Check | Result |
|---|---|
| Frontend Vitest | 7 files, 24 tests passed |
| Frontend ESLint | Passed |
| Next.js production build | Passed; 33 built routes |
| Backend Vitest | 26 files, 309 tests passed |
| Infrastructure/backend TypeScript | Passed |
| Frontend production dependency audit | 0 vulnerabilities across 365 production dependencies |
| Public accessibility Playwright | 9 passed, 1 expected desktop skip |

## Canonical authenticated production checks

| Check | Result |
|---|---|
| Canonical API health | 200 |
| Authenticated API resources | Businesses, accounts, entries, bank transactions, issues, vendors, categories all returned 200 |
| Authenticated routes | 19 routes × desktop/tablet/mobile = 57 executions |
| Browser HTTP failures | 0 in broad route pass |
| Browser console/page errors | 0 in broad route pass |
| Page-level horizontal overflow | 0 in broad route pass |
| Ledger → scan → Issues → Category Review | Scan 200; shared timestamp refreshed; counter inconsistencies confirmed |
| Issues full pagination | 325 unique loaded issues after seven Load More actions |

## AWS and data checks

| Check | Result |
|---|---|
| AWS account | `116846786465`, verified |
| Canonical API | `cpjh7t19u1`, access logs and throttling configured |
| API 24-hour traffic | 3,384 requests; 6×4xx; 1×5xx |
| Identified 5xx route | Plaid sync, 502 at 2026-07-11 18:25:03Z |
| Plaid SQS / DLQ | Both empty at inspection |
| Plaid alarms | Two alarms, both OK, actions enabled |
| Alarm subscribers | Zero |
| Production Lambdas / log groups | 146 / 146 |
| Production database inspection | Aggregate-only, transaction read-only, no customer content returned |

## Important interpretation

These passing commands prove compilation and isolated logic, not complete workflow correctness. The audit findings register documents production-state and sequence failures that exist despite the green test baseline.

## Current remediation batch

| Check | Result |
|---|---|
| Issues summary contract | 17 focused tests passed, including deleted-entry and singleton-duplicate exclusion |
| Frontend Vitest after corrections | 7 files, 24 tests passed |
| Backend full Vitest after corrections | 26 files, 309 tests passed |
| Frontend ESLint after corrections | Passed |
| Backend TypeScript after corrections | Passed |
| Next.js production build after corrections | Passed; 33 built routes |
| Local authenticated visual attempt | Inconclusive by design: production API rejected the localhost origin through CORS; no visual-pass claim recorded |

## Production remediation verification

| Check | Result |
|---|---|
| Backend deployment | SST production deploy completed on canonical API |
| Frontend deployment | Amplify job 333 succeeded for commit `93d1ca130d3a7cdded4e11ab25dafade3e8a8616` |
| Ledger footer, desktop dark | Separate navigation and totals rows rendered; complete monetary values; note uses normal wrapping with no ellipsis |
| Ledger footer, tablet/mobile shells | No document-level horizontal overflow; the wide ledger remains inside its table scroller |
| Issues authoritative totals | `Open 325`, `Duplicate groups 60`, `Categories 141`, `Stale 59` on first page |
| Issues navigation side effect | Zero non-GET `/issues` requests while opening the page; scan remains explicit |
| Category Review counts | Sidebar 141, headline 141, queue 141, status `Showing 100 of 141` |
| Final category summary deploy | SST production deploy completed after 14 focused tests and backend typecheck passed |
