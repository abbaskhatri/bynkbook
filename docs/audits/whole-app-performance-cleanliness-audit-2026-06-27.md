# Whole App Performance and Cleanliness Audit - 2026-06-27

## Goal

Audit the Bynkbook app for UI speed, optimistic feedback, backend efficiency, code cleanliness, dead code, loading behavior, and organization. The target is an app that feels instant in the browser while backend work completes safely and predictably.

## Audit Method

- Reviewed current route/page structure, backend Lambda handlers, shared API/query utilities, and prior audit docs.
- Ran frontend lint, frontend typecheck, frontend production build, backend typecheck, and critical backend tests.
- Searched for direct `fetch` usage, route drift, disabled lint rules, `@ts-ignore`, `console.log`, large files, uncapped queries, optimistic cache writes, and expensive backend patterns.
- Inspected the hottest surfaces: Ledger, Reconcile, Category Review, Issues, Reports, Vendors, and Settings.

## Verification Snapshot

- `bynkbook-web`: `npm run lint` passed with 116 warnings and 0 errors.
- `bynkbook-web`: `npx tsc --noEmit` passed.
- `bynkbook-web`: `npm run build` passed.
- `infra-sst`: `npm run typecheck` passed.
- `infra-sst/packages/functions`: critical tests passed: `authorizationGaps`, `entriesApplyCategoryBatch`, and `lib/db` (28 tests).
- Git state before writing this audit was clean and aligned with `origin/main`.

## Current Strengths

- The app has a solid foundation. TypeScript, production build, and core backend tests are green.
- Frontend API traffic is centralized through `bynkbook-web/src/lib/api/client.ts`; there is no scattered raw `fetch()` surface in pages.
- Auth token fetching is cached and coalesced for 60 seconds in `apiFetch`, reducing repeated Amplify token work.
- Ledger entries have strong query discipline in `bynkbook-web/src/lib/queries/useEntries.ts`: stale time, cache time, disabled refetch-on-focus/reconnect, and placeholder data are already in place.
- Ledger and Category Review already use meaningful optimistic UI with rollback paths for key row updates.
- Settings account creation is optimistic and replaces the temporary account row after the backend returns.
- Backend entry and bank transaction lists use cursor pagination.
- Many report endpoints are aggregate-based or capped, which is the right direction for scale.
- Previously missing legal routes exist now: `/privacy` and `/terms`.
- The retired `POST /v1/ai/suggest-category` route appears intentionally commented out in `infra-sst/sst.config.ts`.

## Highest Priority Findings

### P0 - Reconcile Remains the Main Performance Risk

`bynkbook-web/src/app/(app)/reconcile/page-client.tsx` is about 6,755 lines and 336 KB. It owns fetching, tab state, matching rules, optimistic pending maps, placement summary hydration, dialogs, derived row models, and rendering in one file.

Why it matters:

- It is the hardest page to keep instant because tiny changes can recompute or refetch large local structures.
- It posts currently loaded bank and entry IDs into placement summary work (`bankTransactionIds`, `entryIds`) around `page-client.tsx:1746`.
- It still needs to reason about partially loaded truth (`entriesHitApiLimit`, placement summary partial state, loaded windows).
- It has a large dependency surface for hook correctness; lint warnings here are more likely to become real stale-state bugs.

Recommended fix:

1. Move data orchestration into hooks: `useReconcileEntries`, `useBankTransactions`, `usePlacementSummary`, `useMatchMutations`.
2. Move table rendering and dialogs into focused components.
3. Replace client-posted ID windows with server-driven filtered summary endpoints where possible.
4. Add virtualization or capped visible row windows for heavy tables/dialog lists.
5. Keep instant local updates, then settle affected query keys in the background.

### P0 - Hot Page Size Is Still Too High

Largest current page/client files:

| File | Lines | Size |
| --- | ---: | ---: |
| `bynkbook-web/src/app/(app)/reconcile/page-client.tsx` | 6,755 | 336 KB |
| `bynkbook-web/src/app/(app)/ledger/page-client.tsx` | 5,286 | 239 KB |
| `bynkbook-web/src/app/(app)/settings/page-client.tsx` | 3,490 | 178 KB |
| `bynkbook-web/src/app/(app)/vendors/[vendorId]/page-client.tsx` | 2,387 | 119 KB |
| `bynkbook-web/src/app/(app)/category-review/page-client.tsx` | 2,369 | 116 KB |
| `bynkbook-web/src/app/(app)/dashboard/page-client.tsx` | 1,812 | 79 KB |
| `bynkbook-web/src/app/(app)/reports/page-client.tsx` | 1,525 | 78 KB |

Recommended fix:

- Split hot pages by responsibility, not by visual chunks only.
- First split state/mutations/hooks, then split rendering.
- Set a target: no interactive page client file above 1,500 lines after the cleanup pass, except temporarily during migration.

### P1 - React Hook Warnings Are Performance and Correctness Debt

Lint passes but emits 116 warnings. The important classes are:

- `react-hooks/exhaustive-deps` across hot pages.
- `react-hooks/set-state-in-effect` in shared components and inputs.
- unused variables in hot pages.
- unused eslint-disable directives.
- `@ts-ignore` in `bynkbook-web/src/components/reconcile/auto-reconcile-dialog.tsx:369`.

Why it matters:

- Exhaustive-deps warnings on data-heavy pages can cause stale account/business scope, repeated fetches, or missed updates.
- Set-state-in-effect can create unnecessary two-render flows and visible flicker.
- Disabled rules and unused variables make it harder to trust the code during future speed work.

Recommended fix:

- Create a lint burn-down PR focused only on warnings.
- Start with shared components and the three hottest pages: Reconcile, Ledger, Settings.
- Replace `@ts-ignore` with typed helpers or `@ts-expect-error` only where there is a documented compiler limitation.

### P1 - Query Discipline Is Uneven

`useEntries` is disciplined, but `bynkbook-web/src/lib/queries/useLedgerSummary.ts` has only the default React Query behavior.

Why it matters:

- Summary cards can refetch on focus/reconnect/mount while entries stay stable.
- This can cause apparent flicker or delayed summary updates after already-instant row updates.

Recommended fix:

- Give ledger summary the same default discipline as entries:
  - `staleTime: 30_000`
  - `gcTime: 10 * 60_000`
  - `refetchOnMount: false`
  - `refetchOnWindowFocus: false`
  - `refetchOnReconnect: false`
  - `placeholderData: (prev) => prev`
- For mutations, patch the summary cache where the delta is known and invalidate in the background where it is not.

### P1 - Reports Activity Endpoint Is Unbounded

`infra-sst/packages/functions/src/reports.ts` returns all matching entries for `/reports/activity` with no `take`, cursor, or page limit.

Why it matters:

- A large date range or mature business can return thousands of rows in one response.
- That can slow Lambda execution, database load, network transfer, browser parsing, and report rendering.

Recommended fix:

- Add `limit` and cursor pagination to `/reports/activity`.
- Default to 100 or 200 rows.
- Return totals separately from rows, preserving current summary behavior.

### P1 - Reconcile Placement Summary Is Too Client-Window Driven

`reconcile/page-client.tsx` builds placement summary input from currently loaded bank rows and entry rows, then calls placement summary around `page-client.tsx:1746`.

Backend `infra-sst/packages/functions/src/matchGroups.ts` caps and validates the IDs, which is good, but the shape still makes the client responsible for truth windows.

Recommended fix:

- Add a server endpoint that accepts filters (`from`, `to`, status/tab intent, account) and returns placement summary plus partial indicators.
- Keep client ID-based summary only as a fallback for explicit selected-row operations.

### P1 - Backend Handler Helpers Are Duplicated

Several backend handlers define their own `json`, `getClaims`, path/query helpers, membership checks, and role checks.

Why it matters:

- Security and error behavior can drift across routes.
- Every new route repeats boilerplate.
- It is harder to add consistent timing metrics, request IDs, validation, and authorization policy checks.

Recommended fix:

- Introduce shared request helpers in `infra-sst/packages/functions/src/lib/http.ts` and `lib/authz.ts`.
- Migrate one handler family at a time: reports, entries, bank transactions, match groups, AP.

### P2 - `apiFetch` Needs Polish and Request Controls

`bynkbook-web/src/lib/api/client.ts` is the right central abstraction, but it currently has formatting drift and no timeout/abort path.

Recommended fix:

- Clean the indentation.
- Add optional timeout support.
- Thread caller-provided `AbortSignal` through safely.
- Consider standard request IDs or route labels for metrics.

### P2 - Dead/Stray Code and Debug Surfaces

Concrete cleanup targets:

- `infra-sst/packages/functions/src/events/todo-created.ts:5` logs `"Todo created"` and looks like leftover scaffolding.
- `bynkbook-web/src/components/reconcile/auto-reconcile-dialog.tsx:369` uses `@ts-ignore`.
- Debug `console.log` calls in frontend are mostly gated, but should be wrapped behind one shared debug logger.
- Multiple eslint-disable comments should be either removed or documented with a narrow reason.

## Page-by-Page Notes

### Dashboard

- Better after polish, but still has query and memo dependency warnings.
- Good candidate for extracting chart data transforms into `src/lib/dashboard`.
- Keep dashboard queries aggregate-only; avoid adding raw row fetches for visual cards.

### Ledger

- The new ledger-entry experience is strong and should be preserved.
- Optimistic entry update/delete behavior is a good model for other pages.
- Remaining risk is file size and event-driven refresh (`bynk:ledger-refresh-now`) spread across surfaces.
- Next step: extract mutation orchestration and row model derivation before touching UI layout.

### Reconcile

- Highest risk page.
- Keep current UX, but move logic out in layers.
- Server-backed truth and row virtualization should come before cosmetic changes.
- Current placement summary flow should be redesigned to avoid sending all currently loaded IDs for routine page state.

### Category Review

- Row category apply is now optimistic with rollback.
- Bulk flows still carry a lot of local state in the page.
- Safe bulk group logic should move into a hook or library with tests.

### Issues

- Good: scan is manual/controlled, with epoch guards to avoid stale completions.
- Risk: auto-scan and scan busy state are page-local; query invalidation touches issues, counts, and entries after resolution.
- Next step: standardize issue mutations with React Query mutation helpers and optimistic status changes where safe.

### Reports

- Most endpoints are aggregate/capped, which is good.
- `/reports/activity` is the standout unbounded endpoint.
- The page should retain summaries immediately while row detail paginates.

### Vendors and Vendor Detail

- Large client file with manual refresh events and many `any` casts.
- AP backend has several capped queries and raw aggregate SQL, which is promising.
- Next step: split vendor detail into bills, payments, uploads, and summary hooks/components.

### Settings

- Account creation is optimistic.
- The file is too large and mixes business settings, account settings, Plaid, closed periods, members, policy, export, and destructive flows.
- Split by tab and move per-tab data flows into hooks.

### Uploads

- Upload controller and panel have several `set-state-in-effect` warnings and many shape casts around completed metadata.
- Next step: define typed upload result metadata and reduce effect-driven derived state.

## Backend Notes

- Entries list pagination is cursor-based and includes running-balance considerations. Good direction.
- Bank transactions list is cursor-based and caps limits, but matched/unmatched filtering uses derived matched IDs and deserves load testing on large books.
- Match groups use transactions and validation; placement summary has input caps but should become more filter/server-driven.
- Reports use raw SQL for monthly aggregates and AP aging, which is efficient when indexed correctly.
- Issues scanning reads broad entry windows and should be profiled with large realistic accounts.

## Recommended Implementation Plan

### Bundle 1 - Low Risk Speed Foundation

- Add query discipline to `useLedgerSummary`.
- Clean `apiFetch` formatting and add timeout/abort support.
- Remove stray `todo-created` handler/log if unused.
- Replace `@ts-ignore` in auto reconcile dialog.
- Fix unused eslint-disable comments and obvious unused variables.

### Bundle 2 - Reports Scale

- Paginate `/reports/activity`.
- Update Reports UI to load detail rows incrementally while keeping totals instant.
- Add backend tests for limit/cursor behavior.

### Bundle 3 - Reconcile Core Speed

- Extract reconcile data hooks.
- Extract placement summary hook.
- Add server-filtered placement summary endpoint.
- Add virtualization for heavy lists/dialogs.
- Add targeted tests around partial summary/truth behavior.

### Bundle 4 - Hot Page Decomposition

- Split Ledger, Settings, Category Review, Vendor Detail, Dashboard.
- Move domain transforms into `src/lib`.
- Keep UI components presentational wherever possible.

### Bundle 5 - Backend Shared Helpers

- Add shared HTTP/auth/request helpers.
- Migrate reports first, then entries/bank/match groups.
- Add consistent request metrics and route timing.

### Bundle 6 - Cleanliness Gate

- Reduce lint warnings from 116 to 0.
- Add a CI rule that fails on new lint warnings.
- Track bundle size or route JavaScript weight for hot pages.

## Definition of Done for "Instant Fast"

- User actions update the visible row/card/modal state immediately.
- Backend completion reconciles quietly in the background.
- Known failures roll back only the affected row/scope.
- No full-page loading state after initial entry to the app shell.
- Hot pages keep previous data visible while refreshing.
- Large tables/dialogs render only visible rows.
- Backend endpoints return bounded payloads by default.
- Lint is clean enough that hook warnings are trusted as real blockers.

