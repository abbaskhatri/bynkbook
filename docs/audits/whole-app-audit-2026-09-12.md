# BynkBook app audit — September 12, 2026

**Follow-up:** [V3 implementation and verification](bynkbook-v3-2026-09-12.md) addresses many priorities below. This document preserves the original audit findings and baseline; use the V3 report for current implementation and remaining release work.

## Assessment

BynkBook has useful accounting workflows, a consistent visual foundation, and substantial regression coverage. The largest remaining opportunity is to make everyday review shorter and clearer: preserve account context, show trustworthy loading/error states, make mobile tasks directly actionable, and avoid fetching or rendering large workspaces before they are needed.

This audit includes local improvements, not a production deployment. Existing edits to Ledger, Issues, Category Review, Settings, and older screenshot artifacts were present before this audit and have been preserved. Only the small, documented additions to Ledger and Category Review in this change belong to this audit.

## Scope and evidence

- Reviewed route structure, shared components, authentication/session handling, query caching, API transport, ledger pagination, search, reporting, uploads, bank synchronization, Operations, role authorization, database access/indexes, dependency advisories, and CI.
- Ran the existing frontend and backend regression suites, type checks, lint, and production build; added regressions for changed request, query, and search behavior.
- Inspected the local production build against the existing QA business using authenticated, read-only requests. Browser interception blocked financial writes, bank sync, uploads, and AI/category-suggestion POSTs. Deterministic search and placement-summary lookups were permitted.
- The initial local API configuration rejected the local browser origin through CORS. The audit browser forwarded allowed reads to the canonical API recorded in `.env.production`, adding local-only response headers. No deployed CORS, environment settings, infrastructure, or production data were changed. These measurements are **not** a measurement of the deployed site's network path.
- Baseline checks covered Dashboard, Operations, Ledger, Reconcile, Issues, Category Review, Closed Periods, Planning, Reports, Vendors, Checks, Settings, Receipt Upload, and Invoice Upload at desktop and mobile widths. Follow-up checks and public-flow results are recorded with the evidence below.
- An inspected route means its default screen was loaded; it does not mean every dialog, role, bank integration, destructive action, or edge case was exercised.

Evidence directory: [`output/playwright/whole-app-audit-2026-09-12`](../../output/playwright/whole-app-audit-2026-09-12) (repository root). Browser measurements, screenshots, and dependency scans are stored there. The QA session itself remains in ignored local files.

## Implemented improvements

| Change | User benefit | Main implementation |
|---|---|---|
| Updated Next.js and aligned Next tooling to 16.3.5; removed the outdated PostCSS override; refreshed compatible transitive dependencies | Addresses current frontend dependency advisories | `bynkbook-web/package.json`, `package-lock.json` |
| Scoped placeholder data by business/account | Previous workspace rows, balances, activity, and dashboard results no longer appear under a newly selected workspace while it loads | `src/lib/queries/keepScopedData.ts`, query hooks, Dashboard, Ledger, app shell |
| Cancelled superseded search requests and invalidated late responses | Clearing or replacing a search no longer allows an old result to win; irrelevant requests can stop | `src/components/app/global-search.tsx`, `src/lib/api/ai.ts` |
| Corrected “under $500” amount filtering on both financial sources | Larger positive and negative transactions are excluded as intended | `infra-sst/packages/functions/src/searchQuery.ts` |
| Preserved business/account in result links and displayed bank result name/date fields correctly | Search results are understandable and lead to the correct workspace | Search handler and global search component |
| Ran independent ledger/bank search queries concurrently | Removes one sequential database wait from search | Search handler |
| Added combobox/listbox semantics, result state announcements, and contextual category/budget labels | Improves keyboard and assistive-technology use | Global search, CategoryCombobox, Category Review, Planning |
| Kept request timeouts active through response-body reading; removed completed abort listeners | A stalled response body cannot leave the request waiting indefinitely; cancelled requests do not start after auth completes | `src/lib/api/client.ts` |
| Preserved HTTP status/code/payload on general API errors | Existing UI error helpers can reliably distinguish validation, permissions, and other failures | API client |
| Allowed the existing upload bucket's exact regional origin in CSP | The browser policy now permits the direct signed upload used by the app | `next.config.ts` |
| Added a recoverable workspace error screen | A render failure offers retry and a dashboard route, with careful guidance for uncertain saves | `src/app/(app)/error.tsx` |
| Fixed logo sizing and respected reduced-motion preferences | Removes clipped branding and unnecessary motion for users who request it | `BrandLogo.tsx`, `globals.css` |
| Kept vendor Back navigation inside the client router | Avoids a full document reload when returning to the vendor list | Vendor detail screen |
| Enabled all frontend and backend unit tests in CI | Existing regressions are actually checked on future changes | `.github/workflows/ci.yml` |

The request timeout applies to each network attempt, including its body. Authentication has its own deadline, and a 401 may cause one refreshed attempt; this is not a single total end-to-end deadline. Search cancellation cannot guarantee that an already received backend request stops its database work.

## Remaining priorities

### 1. Finish backend dependency triage before a release

The baseline production-dependency scan reported 9 backend findings: 5 high and 4 moderate. The affected tree includes Prisma/config/dev tooling, `deepmerge-ts`, `mysql2`, `fast-uri`, `valibot`, Hono, and its Node adapter. A root dependency audit does not prove that each package is included in a deployed Lambda or that an advisory is exploitable through BynkBook.

**Next:** inspect deployed bundle dependency paths, update the compatible affected transitive packages, and plan a supported Prisma update with generated-client, migration, and database compatibility checks. Do not apply the audit tool's proposed Prisma 7 → 6 downgrade automatically. This audit does not modify the backend dependency graph.

**Acceptance:** no untriaged critical/high findings in shipped runtime packages; tooling findings have a documented disposition; backend type checks, all tests, Prisma validation, and an isolated database migration rehearsal pass.

### 2. Make the mobile ledger a complete workflow

The mobile Ledger renders `pageRows` as read-only cards without an `onClick`. Its full editing controls sit in a closed disclosure after the list. Paging and load-more controls are in the desktop-only table footer, while the mobile table explicitly receives `footer={null}`. Users can inspect the initial rows but do not get an equivalent way to navigate older pages or open a card to edit it.

The baseline full-page Ledger screenshot is roughly 10,000 CSS pixels tall. Rendering a desktop table inside a closed disclosure still builds a large component tree.

**Next:** show 20–25 cards per batch, add a visible “Load older entries” control, open a record detail sheet on tap, and mount detailed table controls only when requested. Keep the established desktop new-entry row unchanged.

**Acceptance:** users can find an old transaction, inspect it, and make an authorized edit on a 390px screen without using a desktop spreadsheet; the first screen renders a bounded record set.

### 3. Complete mobile reconciliation beyond the first 50 records

The mobile Reconcile lists each use `.slice(0, 50)`. The bank and ledger sections form a very long stacked page. Default route loading does not prove that every older unmatched record is reachable or that the best match is visible across the two lists.

**Next:** a “Bank / Ledger” switch, counts and explicit pagination, and a single selected transaction with its best candidate matches. Keep amount/date/payee differences visible before confirmation.

**Acceptance:** complete a review involving records beyond the first 50 without switching devices; preserve existing match, closed-period, and confirmation rules.

### 4. Replace cumulative ledger pagination

`src/lib/api/entries.ts:listEntries` starts from a null cursor and re-fetches every page up to `pageCount`. `useEntries` includes that count in its query key. Loading page N therefore re-requests earlier pages and creates another cumulative cache entry. Rapid account/search changes also do not propagate React Query's abort signal into this list API.

**Next:** use cursor-based incremental pages, retain each already loaded page, and pass query cancellation through to the fetch. Avoid rewriting the new-entry row.

**Acceptance:** loading page 5 requests one additional page rather than pages 1–5; switching account cancels unused reads; filters and running balances remain correct on a large test ledger.

### 5. Define a freshness policy instead of disabling all automatic refresh

`providers.tsx` disables refetch-on-mount, focus, and reconnect. The ledger hooks repeat those overrides. A short `staleTime` marks a value stale but does not itself trigger a request. Another person/device can update the books while a revisited screen keeps cached data until a manual refresh or local invalidation occurs.

**Next:** retain cached content while refreshing stale data on deliberate revisits/reconnect; show “Updated …” and a subtle refreshing indicator. Coalesce requests and tune freshness per resource. Do not replace all of these flags with aggressive polling.

**Acceptance:** a second user's change appears on return to the page within a documented freshness window, without a blank loading screen or request storm.

### 6. Align report date labels and onboarding truth

In the QA Dashboard, the selected period was July–September while the cash-flow chart displayed earlier months. The backend cash-flow series intentionally defaults to the last 12 months ending on `to`, rather than the selected `from`. That behavior needs its own visible date label or an explicit period-aligned query.

The setup checklist infers whether transactions/categories exist from period report output. A business with historical entries can be asked to import its first transactions when the selected period is empty.

**Next:** label each chart's actual range and derive onboarding from durable setup facts (accounts/categories/any entries), not current-period totals.

**Acceptance:** selecting an empty month does not reset setup progress; each chart range is unambiguous and zero/no-data/failed states are distinct.

### 7. Complete search navigation and parsing

Result links now keep the correct workspace, but Ledger and Reconcile do not consume `focusEntryId` / `focusBankTxnId`. A matching record can still be outside the loaded page. The search parser is a small heuristic parser: it expects currency-style amount phrases and defaults to 90 days, not a fully natural-language search engine.

**Next:** load and highlight the target record explicitly, preserve back-navigation to the query, and test supported examples including dates, amounts, punctuation, and empty results. The misleading “Expenses over 500” hint was replaced by supported “Over $500”.

**Acceptance:** selecting a result visibly opens/highlights that record, including records outside the first page; every displayed example is covered by parser tests.

### 8. Continue accessibility beyond the repaired controls

The baseline scan found missing explicit labels in category review, planning, settings, filters, and selectors. Repeated Category Review checkboxes/category inputs and budget amount fields were repaired. The scan is a heuristic, not a full accessibility conformance assessment; it counts explicit labeling mechanisms and can miss a control's contextual accessibility behavior.

**Next:** associate Settings labels with their inputs; name all business/account/report filters; verify dialog focus restoration, error announcements, contrast, keyboard traversal, and 200% zoom. Test with a screen reader. Keep visible labels as well as programmatic names.

**Acceptance:** no unnamed interactive fields in critical flows; keyboard-only completion of login, add entry, category review, and reconciliation; no clipped controls at zoom.

### 9. Review custom role restrictions on read endpoints

Search, Reports, and the Operations overview check membership, while the shared fine-grained role policy mechanism is oriented toward writes. If a configured `NONE` policy is intended to hide data, route/navigation restrictions alone do not enforce that boundary on these APIs.

**Next:** define whether business membership intentionally grants all financial reads. If not, centralize read authorization and cover Reports, Search, Operations, exports, and direct URLs with a role/endpoint matrix.

**Acceptance:** every role's permitted reads match the product's policy labels; denied users cannot recover hidden data by calling an alternate endpoint. This is a policy-enforcement gap to resolve, not evidence of cross-business access.

### 10. Split heavy Operations work and expose partial results

The overview performs 11 parallel reads/work units, including up to 5,000 category-memory records and 5,000 historical entries. The frontend polls the entire overview every minute. The history query takes the oldest 5,000 rows in its window; truncation can omit newer recurring activity. Category quality metrics are also based on a bounded set without an explicit sampled/completeness marker.

**Next:** separate lightweight bank/close health from forecast and learning analytics; cache by data version; use aggregate counts and expose incomplete-history status; refresh expensive panels on demand or on relevant changes.

**Acceptance:** health remains quick at 100,000+ entries; partial coverage is visible; forecast windows contain the intended history; no silent partial metrics are presented as full-business totals.

### 11. Strengthen backend connection and query budgets

`lib/db.ts` caches the constructed Prisma client but not an in-flight initialization promise. Concurrent initialization can build more than one pool. Pool size, connection acquisition timeout, and statement timeout are not explicitly set in `buildPgPoolConfig`; defaults are relied upon. Several report aggregates are sequential.

**Next:** coalesce initialization, set measured per-Lambda connection/query budgets, and parallelize or combine independent aggregates where the DB can support it. Profile query plans against realistic cardinality before adding indexes; useful scope/date indexes already exist.

**Acceptance:** one pool per warm runtime, bounded acquisition failures, an explicit database connection budget across Lambda concurrency, and measured hot-query latency under load.

### 12. Make uploads resilient through the whole lifecycle

The CSP defect was corrected for the current documented upload bucket. The upload controller still uses XMLHttpRequest without a transfer timeout. Active-upload cleanup and context changes deserve dedicated testing. In `useUploadsList`, previous items can remain visible when a new scope starts loading or has no business ID.

**Next:** add per-file timeout/cancellation/unmount cleanup, scope-owned upload state, clear failure recovery, and a review-before-import contract test using isolated files. Validate signed upload/download URLs and bucket CORS in a staging environment.

**Acceptance:** leaving a workspace cannot show another workspace's files; a stalled transfer reaches a recoverable state; retries do not create duplicate imports. No live upload was performed in this audit.

### 13. Reduce duplicate navigation and review surfaces

Dashboard, Operations, Issues, Category Review, and Reconcile each expose part of the same review workload. A new owner has to learn where to start and what “done” means.

**Next:** choose one default home for each role, lead with “Your next task”, keep consistent counts and scope, and provide a short guided sequence: connect/import → categorize → reconcile → resolve exceptions → close. Keep expert shortcuts and bulk actions one level deeper.

**Acceptance:** a first-time user can identify the next useful action without opening several screens; the same account shows consistent counts across views.

### 14. Make changes easier to maintain and measure

The largest client files are approximately 8,000 lines (Reconcile), 6,000 (Ledger), 4,100 (Settings), and 2,700 (Category Review). The current performance utility records samples only in local memory, keyed by full API path; it does not provide production field measurements or a bounded set of route names.

**Next:** extract one workflow at a time into query/state hooks and separately loaded dialogs. Add privacy-conscious field measurements for route readiness, interaction latency, and failed saves; normalize metric names and bound cardinality. Add build and browser regression jobs to CI after the expanded unit-test gates.

**Acceptance:** agreed performance budgets are measured at p50/p95 on representative devices/data; changes to one workflow can be tested without loading the whole page implementation.

### 15. Verify operational readiness separately

Queue/backlog alarms and an SNS topic are declared, but their existence does not prove that notifications reach an operator. Live backup retention, successful restore drills, deployed database migrations, production error rates, Google sign-in, MFA challenges, and the end-to-end Plaid webhook-to-worker path were not verified here. Privacy and Terms screens remain marked as drafts.

**Next:** run the existing production-readiness process with an explicit rollout/rollback plan; demonstrate alert delivery and an isolated restore; finish approved product/legal copy before broader availability. Keep the documented live infrastructure bridge intact during any cleanup.

## Suggested delivery order

1. **Release preparation:** validate this change, triage backend dependencies, and settle read-policy semantics.
2. **Daily-work improvements:** incremental Ledger pagination, complete mobile Ledger/Reconcile navigation, dependable stale-data refresh, accurate onboarding/date labels.
3. **Performance and scale:** split Operations payloads, set database budgets, defer heavy dialogs, establish large-ledger and slow-device benchmarks.
4. **Product polish:** guided review tasks, remaining accessibility fixes, consistent empty/error states, comprehensive CI browser flows and production monitoring.

Do not measure success by fewer cards alone. Measure time to the first useful screen, time to find an old transaction, time to complete a review, avoidable errors, and whether users can explain the balance and next step.

## Verification results

Baseline: 58 frontend tests, 362 backend tests, backend typecheck, frontend lint, and production build passed. The local baseline scan found 6 frontend production-dependency findings (1 critical, 4 high, 1 moderate) and 9 backend findings (5 high, 4 moderate).

After the improvements:

- **68 frontend tests and 366 backend tests passed** (434 total). The search amount tests also cover amounts exactly on the threshold, which are excluded by “under” and “over”.
- **Production build passed on Next.js 16.3.5**, including TypeScript and generation of 35 static pages.
- **Backend typecheck and Prisma schema validation passed.** Prisma warns that the existing `driverAdapters` preview flag is deprecated; no schema/migration change was made.
- **Frontend lint passed.** The upgraded lint rules identified a vendor Back link that used a full document navigation; it was changed to the existing client router and the affected file rechecked cleanly.
- **Public browser suite: 9 passed, 1 intentionally skipped** (the coarse-pointer test is mobile-only). Includes landing-page keyboard access, signup form semantics, draft legal-page labeling, auth redirect, and a mobile target-size check.
- **Final frontend dependency audit: 0 advisories**, including development dependencies, after a clean installation of the lockfile. See `web-dependency-audit-final.json`. The backend's 9 findings remain for triage; they are not silently treated as resolved.
- **42 authenticated route/viewport checks:** 14 default screens at 1440px, 768px, and 390px, with zero page-level horizontal-overflow candidates and no unexpected failed API reads. Category suggestions returned the audit guard's deliberate 409 in each viewport and were not exercised. See `route-audit.json`; viewport-only checks are distinct from the device-emulated public browser suite.
- **Focused interaction checks passed:** named/keyboard-accessible search options, correct bank name/date display with a synthetic response, clearing a delayed search without reopening it, a 136px sidebar logo, and a reduced-motion transition duration of 0.00001 seconds. The upload-origin check used an intercepted synthetic PUT; no bytes reached S3. See `interaction-checks.txt`.
- **Visual inspection:** checked desktop and mobile screenshots and a settled, persisted dark-mode Dashboard. `dashboard-dark-settled.png` is the completed dark-theme state; the earlier `dashboard-dark-after.png` captured an in-progress theme transition and is not a contrast verdict.

The more precise follow-up visibility scan excludes controls inside closed disclosures. In the mobile Ledger, the original heuristic counted 332 mounted/layout-candidate buttons, while 13 were actually exposed outside closed disclosures. This difference is a measurement correction, **not** a claimed 96% rendering optimization. The very long read-only card list and missing mobile pagination remain real workflow problems.

Category Review's mobile scan improved from 202 explicitly unnamed fields to **1**; Planning improved from 20 to **0**. These checks do not replace a screen-reader audit. Initial and follow-up timing samples use different warm-cache states and the local audit forwarding path; they do not establish a before/after speed percentage.

No claim is made that the entire app is defect-free, that these local timings are production p95 measurements, or that unexercised banking/accounting mutations have passed an end-to-end test.
