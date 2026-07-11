# Full Finding Status List

This is the complete 20-item finding register from the July 11 exhaustive pass. “Fixed” requires production evidence. “Open” means the evidence still exists or the required external/user decision has not happened.

## Fixed and production-verified (7)

| ID | Finding | Verification |
|---|---|---|
| BYNK-EXH-QA-001 | Earlier audit conclusions exceeded evidence | This audit records explicit evidence levels and carries limitations forward. |
| BYNK-EXH-ISSUES-001 | Opening Issues automatically wrote a scan | Production navigation generated zero non-GET Issues requests. |
| BYNK-EXH-ISSUES-002 | Issues KPIs counted only loaded pages | First page now shows authoritative totals: 325 / 141 / 59. |
| BYNK-EXH-ISSUES-003 | Duplicate groups counted rows | Production shows 60 unique groups rather than 125 affected rows. |
| BYNK-EXH-CATEGORY-001 | Category Review headline used loaded count | Production headline/queue show 141 while status separately says 100 of 141 loaded. |
| BYNK-EXH-LEDGER-001 | Ledger footer padding/alignment collapsed | Production dark desktop renders separate padded navigation/totals rows; responsive shells have no page overflow. |
| BYNK-EXH-CATEGORY-002 | Sidebar category badge included a non-actionable type | Production sidebar, headline, queue, and total all show 141. |

## Open product/data work (6)

| ID | Finding | Why it is still open / safe next action |
|---|---|---|
| BYNK-EXH-DATA-001 | 16 exact active-entry and 14 exact active-bank fingerprint groups | Same-day equal transactions can be legitimate. Review each evidence group; do not bulk-delete financial records. |
| BYNK-EXH-DATA-002 | 13 transfers violate the two-leg/balanced invariant | Requires transaction-by-transaction historical review and an accountant-approved reversible repair. |
| BYNK-EXH-DATA-003 | Historical issue rows are referentially unclean | UI/counts now exclude invalid/deleted rows, but historical cleanup and same-scope database constraints remain. |
| BYNK-EXH-DATA-004 | One bank connection outlives its business | Provider Item must be identified/revoked before deleting encrypted connection state. |
| BYNK-EXH-PLAID-001 | Existing same-login accounts have not converged to shared Items | Code is deployed, but three missing mappings require one controlled real Plaid recovery Link and post-Link verification. |
| BYNK-EXH-OPS-002 | One Plaid sync returned 502 in the prior 24-hour window | Correlate the request with release time and monitor for post-fix recurrence; a historical event cannot be erased. |

## Open quality/operations work (7)

| ID | Finding | Required action |
|---|---|---|
| BYNK-EXH-QA-002 | Local authenticated harnesses contain retired API targets | Consolidate ignored/local probes behind one canonical target resolver and fail on hostname mismatch. |
| BYNK-EXH-ARCH-001 | Core page clients are monolithic | Add behavior tests, then extract state machines/hooks incrementally. |
| BYNK-EXH-PERF-001 | Cold-load completion lacks a reliable deadline metric | Measure time to terminal content; current evidence does not prove a permanent-loading defect. |
| BYNK-EXH-QA-003 | Test-like production fixtures contain 199 invalid match references | Rebuild disposable versioned QA fixtures and validate invariants after seeding. |
| BYNK-EXH-OPS-001 | Plaid alarms have zero subscribers | Needs an approved email/on-call integration, confirmation, and delivery test. |
| BYNK-EXH-QA-004 | Core authenticated workflows lack mounted regression tests | Add stateful Ledger, Reconcile, Issues, Category, Settings, Plaid, and duplicate-dialog suites. |
| BYNK-EXH-QA-005 | Playwright-managed Next dev server hangs on Windows shutdown | Standardize the externally managed server lifecycle that completed successfully. |

## Release evidence

- Application release: `93d1ca130d3a7cdded4e11ab25dafade3e8a8616`
- Category-summary correction: `c4bfa55`
- Canonical API: `https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com`
- Production UI: `https://app.bynkbook.com`
- No unresolved customer financial candidates were auto-deleted or rewritten during this remediation.
