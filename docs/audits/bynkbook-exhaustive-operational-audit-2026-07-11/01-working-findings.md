# Working Findings

These findings are provisional until the complete matrix is rerun. Confirmed means evidence exists; it does not mean remediation is complete.

## BYNK-EXH-QA-001 — Previous audit conclusions exceeded their evidence

- Severity: HIGH (quality-control / release confidence)
- Status: Confirmed; corrected by the evidence-level controls in this audit
- Evidence: Prior Plaid matrix states “None was authenticated end-to-end in production”; prior limitations state no production database tunnel and no production mutations. Later remediation summaries used “resolved” and “verified” without consistently carrying that limitation forward.
- Impact: Stateful, repeated-action, real-data-shape, and cross-page defects were not exercised before release claims.
- Required correction: Every result must carry one of the evidence levels in `00-audit-control.md`.

## BYNK-EXH-QA-002 — Authenticated audit harnesses target retired APIs

- Severity: HIGH (quality-control)
- Status: Confirmed
- Evidence:
  - `.qa/deep-audit.mjs` targets `lmvoixj337...`.
  - `.qa/live-api-probe.mjs` targets `actwy6st05...`.
  - `.codex-tmp/final-authenticated-qa-smoke.mjs` and multiple fixture scripts target `actwy6st05...`.
  - Production uses `cpjh7t19u1...`.
- Impact: Tests labeled production could exercise a retired backend or fail to validate the deployed API.
- Required correction: One canonical target resolver, hard failure on hostname mismatch, and removal/replacement of stale harnesses.

## BYNK-EXH-ISSUES-001 — Opening Issues can mutate production by automatically scanning

- Severity: MEDIUM
- Status: Corrected in code; production verification pending
- Evidence: `issues/page-client.tsx` automatically calls the POST scan endpoint when a browser-local timestamp is missing or older than six hours. Fresh audit browser contexts triggered POST `/issues/scan` merely by navigating to the page.
- Impact: A supposedly read-only visit performs writes and expensive detection work. A new browser/device repeats scans because freshness is localStorage-only rather than server-authoritative.
- Required correction: Define intentional product behavior. If auto-scan remains, use server scan freshness, one in-flight lease, accurate copy, and explicit operational evidence. Otherwise keep scan manual.

## BYNK-EXH-ISSUES-002 — Issues page KPIs count only loaded pages

- Severity: MEDIUM
- Status: Corrected in code; production verification pending
- Evidence: `issues/page-client.tsx` computes Open/Duplicates/Stale/Missing from `issues.length`. Canonical production-QA evidence changed from `Open 67 / Duplicates 67 / Categories 0 / Stale 0` on first load to `Open 325 / Duplicates 125 / Categories 141 / Stale 59` after seven Load More actions. The sidebar showed `Issues 184`, a separate duplicate-plus-stale metric.
- Impact: Page KPI cards understate outstanding work and disagree with sidebar badges until every page is loaded.
- Required correction: Use authoritative totals, or label all counters as loaded/visible and provide full pagination totals by type.

## BYNK-EXH-ISSUES-003 — “Duplicate groups” counts entries, not groups

- Severity: MEDIUM
- Status: Corrected in code; production verification pending
- Evidence: The Duplicate groups card uses `issues.filter(kind === "DUPLICATE").length`; it does not count unique `group_key` values. Production-QA showed 125 duplicate issue rows after full pagination.
- Impact: Users cannot tell how many decisions are required because a two-entry group counts as two and overlapping peer hydration can change loaded counts nonlinearly.
- Required correction: Count unique active duplicate group keys for group labels and separately show affected entry count where useful.

## BYNK-EXH-CATEGORY-001 — Category Review headline count uses loaded rows instead of total queue

- Severity: MEDIUM
- Status: Corrected in code; production verification pending
- Evidence: Production displayed `100 Uncategorized` and `Showing 100 of 141 uncategorized entries` simultaneously. The headline uses `loadedCount`; the API metadata exposes `totalCount`.
- Impact: Users underestimate work remaining and cannot trust the page summary.
- Required correction: Show total queue in the primary KPI and separately label loaded/visible rows.

## BYNK-EXH-ARCH-001 — Core page clients remain too large for reliable stateful regression coverage

- Severity: MEDIUM (maintainability / regression risk)
- Status: Confirmed risk
- Evidence: Reconcile 7,760 lines; Ledger 5,949; Settings 4,025; Category Review 2,699; Vendor detail 2,679. Most automated frontend coverage is pure-helper tests rather than mounted page workflows.
- Impact: Scope changes, loading flags, dialogs, caches, and mutation recovery interact inside monolithic components; targeted fixes can miss adjacent sequences.
- Required correction: Add behavior-level tests first, then extract scoped state machines/hooks behind those tests.

## BYNK-EXH-PERF-001 — Cold-load completion is not measured reliably

- Severity: LOW
- Status: Confirmed audit gap; app defect not yet confirmed
- Evidence: Desktop-first cold executions showed skeleton/loading states at 2.5 seconds for Category Review, Planning, Closed Periods, and mobile Vendors; subsequent warm executions completed. Prior audits sometimes treated a snapshot as either success or permanent loading without a completion deadline.
- Required correction: Record time-to-terminal-content and classify timeout versus slow completion separately.

## BYNK-EXH-DATA-001 — Non-test data contains unresolved exact duplicate fingerprints

- Severity: HIGH (financial-data risk)
- Status: Confirmed candidates; individual legitimacy still requires review
- Evidence: Aggregate production SQL found 16 exact active-entry fingerprint groups affecting 34 active entries and 14 exact active-bank fingerprint groups affecting 31 active bank rows in non-test-like businesses. Fingerprints use business, account, date, signed amount, type, and normalized full payee/name.
- Impact: Some may be legitimate repeated same-day transactions, but the counts prove that duplicate prevention/cleanup has not produced a clean invariant. User screenshots independently confirm at least one real replay shape.
- Required correction: Review through evidence-safe duplicate groups, preserve source/match audit history, and add a post-sync invariant monitor. Do not bulk-delete based on fingerprints alone.

## BYNK-EXH-DATA-002 — Non-test transfers violate the two-leg balanced-transfer contract

- Severity: HIGH
- Status: Confirmed aggregate defect
- Evidence: 13 production transfer records in non-test-like businesses have a leg count other than two and/or do not sum to zero. None is merely partially soft-deleted.
- Impact: Ledger and report totals can represent incomplete transfers as ordinary financial activity.
- Required correction: Inventory each transfer without exposing contents, determine creation/deletion history, repair with an accountant-approved reversible migration, and prevent partial transfer writes/deletes transactionally.

## BYNK-EXH-DATA-003 — Issue records are not referentially clean

- Severity: MEDIUM
- Status: Confirmed
- Evidence: Aggregate production SQL found 45 issue rows in non-test-like businesses with no entry in the same business/account scope; nine more point to a missing business scope. One open issue points to a soft-deleted entry.
- Impact: Counts can disagree, dead issues can consume pagination, and review dialogs may have missing context.
- Required correction: Add same-scope relations/invariants, clean historical orphan rows reversibly, and exclude/resolve deleted-entry issues atomically.

## BYNK-EXH-DATA-004 — A bank connection outlives its business scope

- Severity: HIGH (data lifecycle / secret retention)
- Status: Confirmed aggregate defect
- Evidence: One `bank_connection` has no account in its recorded business scope, and its business ID no longer exists.
- Impact: Encrypted provider credentials and connection metadata can survive business deletion/reset without an owning tenant.
- Required correction: Identify lifecycle origin, revoke/remove the provider Item if still valid, delete the orphan through an audited migration, and enforce relational cascade/same-scope constraints.

## BYNK-EXH-PLAID-001 — Existing production mappings have not converged to shared Items

- Severity: HIGH
- Status: Confirmed production state; provider recovery still required
- Evidence: Nine bank connections exist: six `CONNECTED`, three `PLAID_ACCOUNT_MISSING`. There are zero `(business, plaid_item_id)` groups shared by more than one local account. Earlier account-specific inspection showed the three missing Bank of America ledgers on separate Items.
- Impact: The deployed consolidation code has not yet repaired existing same-login mappings; sequential reauthorization can still appear broken until a successful all-accounts recovery Link completes.
- Required correction: Complete one controlled real-provider recovery with all same-login accounts selected, verify shared Item plus per-ledger account mappings afterward, and add an explicit post-repair invariant check.

## BYNK-EXH-QA-003 — Production QA fixtures contain invalid historical match state

- Severity: MEDIUM (test reliability)
- Status: Confirmed; isolated to test-like businesses
- Evidence: 199 active entries reference missing bank rows and 199 active match groups have one entry side but zero bank sides. All are in test-like businesses.
- Impact: QA screens and counts are polluted, and end-to-end tests can pass/fail for fixture-corruption reasons instead of application behavior.
- Required correction: Rebuild a versioned disposable fixture set from APIs, validate invariants after seeding, and reset/expire fixtures between mutation suites.

## BYNK-EXH-OPS-001 — Plaid alarms have no human delivery subscriber

- Severity: HIGH (operational detection gap)
- Status: Confirmed
- Evidence: Both Plaid backlog and dead-letter alarms are `OK`, actions are enabled, and they target the production SNS topic. `list-subscriptions-by-topic` returned no subscriptions.
- Impact: An alarm can enter ALARM state without notifying an operator.
- Required correction: Add and confirm an approved on-call recipient/integration, then execute a controlled delivery test.

## BYNK-EXH-OPS-002 — A Plaid sync 502 occurred in the last 24 hours

- Severity: MEDIUM pending temporal attribution
- Status: Confirmed occurrence; may predate the latest Plaid fixes
- Evidence: Canonical API metrics show 3,384 requests, six 4xx responses, and one 5xx in the last 24 hours. Access logs identify the 5xx as `POST .../plaid/sync` returning 502 at `2026-07-11 18:25:03Z`.
- Impact: At least one real sync failed during the period. The event must be correlated with deployment timestamps before deciding whether the latest code regressed.
- Required correction: Correlate Lambda logs/request ID with the release timeline and verify no post-fix recurrence.

## BYNK-EXH-QA-004 — Core authenticated workflows have no mounted browser/component regression tests

- Severity: HIGH (regression-control gap)
- Status: Confirmed
- Evidence: The frontend has seven unit-test files (24 tests), all focused on helpers/API normalization, plus one public-route E2E spec. There are 31 application routes and 17 page clients. No mounted workflow test covers Ledger, Reconcile, Issues, Category Review, Settings, Vendor detail, `PlaidConnectButton`, or `FixIssueDialog`.
- Impact: Account switching, stale component state, pagination totals, cross-page invalidation, repeated clicks, modal sequencing, and failure recovery can regress while all frontend tests pass.
- Required correction: Add authenticated behavior suites around stateful workflows before further broad refactors.

## BYNK-EXH-QA-005 — Playwright-managed dev server does not terminate reliably on Windows

- Severity: LOW
- Status: Confirmed test-harness defect
- Evidence: The public accessibility suite executed all listed cases twice but timed out while Playwright managed the Next.js server. With an externally managed server, the same suite completed in 11.5 seconds with nine passes and one expected desktop skip.
- Impact: CI/local audits can report timeout instead of the real test outcome.
- Required correction: Use a reliable external-server lifecycle on Windows or correct the Playwright webServer shutdown configuration.

## BYNK-EXH-LEDGER-001 — Ledger footer controls and totals collapse into a cramped clipped layout

- Severity: MEDIUM
- Status: Corrected in code; production visual verification pending
- Evidence: User screenshot at 100 rows shows pagination, the older-row explanation, two actions, and all financial totals competing in one wrapping flex container. The totals fall to an unstructured second line against the bottom border and the explanation truncates despite available vertical space.
- Impact: Important totals are visually detached from their scope, controls are difficult to scan, and the footer looks broken at a normal desktop width.
- Required correction: Give navigation/loading and totals separate padded rows, preserve complete monetary values, allow explanatory text to wrap, and verify desktop/tablet/mobile layouts in both themes.
