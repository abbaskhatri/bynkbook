# Bynkbook AI + Performance + Ledger/Reconcile Audit

## Date

May 21, 2026

## Scope

Inspected the Next app and SST backend paths most relevant to AI knowledge, Ledger, Reconcile, totals, soft-delete handling, category suggestions, Plaid status, destructive actions, and large-list behavior.

Key files inspected:

- `bynkbook-web/src/app/(app)/ledger/page-client.tsx`
- `bynkbook-web/src/app/(app)/reconcile/page-client.tsx`
- `bynkbook-web/src/lib/queries/useEntries.ts`
- `bynkbook-web/src/lib/api/entries.ts`
- `bynkbook-web/src/lib/api/ai.ts`
- `bynkbook-web/src/lib/api/bankTransactions.ts`
- `bynkbook-web/src/lib/api/plaid.ts`
- `bynkbook-web/src/components/reconcile/auto-reconcile-dialog.tsx`
- `infra-sst/packages/functions/src/entries.ts`
- `infra-sst/packages/functions/src/bankTransactions.ts`
- `infra-sst/packages/functions/src/matches.ts`
- `infra-sst/packages/functions/src/matchGroups.ts`
- `infra-sst/packages/functions/src/ledgerSummary.ts`
- `infra-sst/packages/functions/src/aiCategorySuggestions.ts`
- `infra-sst/packages/functions/src/lib/categoryMemory.ts`
- `infra-sst/packages/functions/src/lib/categoryMemoryWriteback.ts`
- `infra-sst/packages/functions/src/lib/plaidService.ts`
- `infra-sst/packages/functions/src/reports.ts`
- `infra-sst/packages/functions/src/attentionSummary.ts`
- `infra-sst/packages/functions/src/issuesList.ts`
- `infra-sst/packages/functions/src/issuesScan.ts`
- `infra-sst/packages/functions/src/searchQuery.ts`
- `infra-sst/packages/functions/src/ai.ts`
- `infra-sst/packages/functions/src/insightsDashboard.ts`
- `infra-sst/prisma/schema.prisma`

## Executive Summary

The app already has several strong foundations: backend entry list endpoints exclude `deleted_at` by default, reports and summaries mostly filter soft-deleted records, category suggestions use active entry history, Reconcile has confirmation-first match flows, and Plaid status exposes last sync information.

The main risks are scale and product-truth drift rather than a single catastrophic bug. Ledger and Reconcile are very large client components with many derived lists, local filters, and refresh paths. Reconcile currently makes decisions from capped entry and bank transaction windows, so older expected/matched items can be absent from the visible truth. The codebase also still has Transfer and Adjustment entry paths even though the AI-facing PR 1 rules should treat active ledger guidance as `INCOME` and `EXPENSE` only.

PR 1 intentionally documents these findings without implementing behavior changes.

## Highest Priority Findings

| ID | Area | Severity | Finding | Why it matters | Recommended fix | Suggested PR |
| --- | --- | --- | --- | --- | --- | --- |
| F-01 | Reconcile truth window | High | Reconcile loads entries with `ENTRIES_API_LIMIT = 200` and derives expected/matched counts from that loaded subset. | Older expected or matched entries can be missing from Reconcile counts and review queues, especially for busy accounts. | Add server-backed reconciliation counts/search and cursor-based loading for entries; avoid presenting capped client data as complete truth. | PR 2 |
| F-02 | Bank transaction scale | High | Bank matched/unmatched filtering depends on loading active matched IDs and client/server windows. | Large accounts can hit slow queries, incomplete lists, or misleading counts when many matched records exist. | Add indexed backend endpoints for matched/unmatched counts and pages without large `notIn` ID lists. | PR 2 |
| F-03 | Product truth drift | Medium | Frontend/backend still expose `TRANSFER` and `ADJUSTMENT` entry types in several Ledger paths, while PR 1 AI rules require AI-facing guidance to remain `INCOME`/`EXPENSE` only. | Future AI could suggest unsupported or undesired accounting actions if it follows existing code affordances instead of product rules. | Keep AI prompt/context restricted to `INCOME` and `EXPENSE`; separately decide product direction for existing transfer/adjustment flows. | PR 2 or later |
| F-04 | Destructive safety | Medium | Soft delete has a confirm dialog, matched delete uses typed confirmation, but hard delete is available from deleted rows with a simple confirmation. | Permanent deletion is high risk for bookkeeping auditability. | Require typed confirmation or hide hard delete behind admin-only/audit-safe policy. | PR 2 |
| F-05 | Reconcile placement refresh cost | Medium | Placement summary posts all loaded bank transaction IDs and entry IDs after relevant array changes. | This can become expensive and UI-blocking as loaded rows grow. | Debounce, page, and server-compute placement summaries; only refresh affected IDs after mutations. | PR 2 |
| F-06 | Plaid freshness semantics | Medium | UI shows `lastSyncAt` and sync messages, but there is no consistent stale-data warning threshold for AI/help/totals. | Users and future AI may over-trust bank-derived numbers when Plaid data is old or fresh refresh is unavailable. | Add a stale-sync policy and surface it to AI context, Reconcile, and summaries. | PR 2 |
| F-07 | Large component risk | Medium | Ledger and Reconcile are multi-thousand-line client components with mixed data orchestration, rendering, and mutation logic. | Behavior is hard to reason about and easy to regress. | Extract read-only selectors/hooks and table row components after behavior tests exist. | PR 2 or PR 3 |

## Ledger Findings

Files inspected:

- `bynkbook-web/src/app/(app)/ledger/page-client.tsx`
- `bynkbook-web/src/lib/queries/useEntries.ts`
- `bynkbook-web/src/lib/api/entries.ts`
- `infra-sst/packages/functions/src/entries.ts`
- `infra-sst/packages/functions/src/ledgerSummary.ts`

Findings:

- Ledger fetches entries through `useEntries`, with default active-only behavior unless `showDeleted` is enabled.
- Backend `GET /entries` excludes `deleted_at` by default and includes deleted rows only with `include_deleted=true`.
- Running balance excludes soft-deleted entries in both backend and frontend fallback calculations.
- Footer totals are WYSIWYG page totals and explicitly exclude deleted rows and opening rows. They also exclude `TRANSFER` rows.
- Ledger has local filtering/search over loaded rows; it does not represent full-account totals unless all relevant rows are loaded.
- `showDeleted` is persisted per business/account in local storage and deleted rows are visually struck through.
- Ledger supports optimistic create/update/delete paths and delayed background refresh. This is good for responsiveness but requires careful cache invalidation after financial mutations.
- Existing code supports `TRANSFER` and `ADJUSTMENT` in UI/backend flows. PR 1 does not change this, but AI guidance should not introduce or recommend these types.

## Reconcile Findings

Files inspected:

- `bynkbook-web/src/app/(app)/reconcile/page-client.tsx`
- `bynkbook-web/src/components/reconcile/auto-reconcile-dialog.tsx`
- `bynkbook-web/src/lib/api/bankTransactions.ts`
- `bynkbook-web/src/lib/api/matches.ts`
- `bynkbook-web/src/lib/api/match-groups.ts`
- `infra-sst/packages/functions/src/bankTransactions.ts`
- `infra-sst/packages/functions/src/matches.ts`
- `infra-sst/packages/functions/src/matchGroups.ts`
- `infra-sst/packages/functions/src/reconcileSnapshots.ts`

Findings:

- Reconcile uses MatchGroups as the primary full-match model and treats active groups as matched truth.
- Legacy `BankMatch` is still retained for fallback/export/diagnostic paths.
- Voided groups and voided legacy matches are treated as inactive in the UI.
- Expected ledger rows are unmatched active entries that are not opening-like, adjusted, or cash-account exempt.
- Matched rows are entries/bank transactions in active groups or active legacy matches.
- The page intentionally caps rendered rows for responsiveness, but counts are computed from the loaded window.
- Reconcile loads only `ENTRIES_API_LIMIT = 200` ledger entries for the selected date range, so older expected/matched records may not be represented.
- Bank transactions are paged with a larger limit, but matched/unmatched truth still depends on active matched IDs and loaded pages.
- Deterministic auto-reconcile suggestions require review and confirmation before applying.
- AI match suggestions rank visible candidates; they do not force matches without user action.

## AI Suggestion Findings

Files inspected:

- `bynkbook-web/src/lib/api/ai.ts`
- `bynkbook-web/src/app/(app)/ledger/page-client.tsx`
- `bynkbook-web/src/app/(app)/reconcile/page-client.tsx`
- `infra-sst/packages/functions/src/aiCategorySuggestions.ts`
- `infra-sst/packages/functions/src/lib/categoryMemory.ts`
- `infra-sst/packages/functions/src/lib/categoryMemoryWriteback.ts`
- `infra-sst/packages/functions/src/ai.ts`

Findings:

- Category suggestions are suggestion-only in Ledger and Reconcile; user action is required to apply them.
- Ledger requests top category suggestions in batch for uncategorized active visible targets and avoids per-row AI calls.
- Reconcile requests category suggestions when creating a ledger entry from a bank transaction.
- Backend category history excludes soft-deleted entries and only uses `INCOME`/`EXPENSE` history.
- Category memory is business-scoped and direction-aware.
- Writeback is called from create/update flows where active entry guards generally exist. The writeback helper itself does not know whether an entry is soft-deleted, so future callers must preserve the active-entry guard.
- AI fallback can be disabled by callers; current Ledger/Reconcile suggestion calls pass `includeAiFallback: false` for deterministic suggestions.
- The new AI Knowledge Pack should become the source of product-safety context before broader AI wiring.

## Performance Findings

Likely slow render sources:

- Ledger and Reconcile each perform many `useMemo` passes over loaded rows for sorting, filtering, status derivation, issue maps, match maps, totals, and visible row shaping.
- Ledger has a large table body and many inline controls per row.
- Reconcile builds multiple maps and filtered lists for entries, bank transactions, active groups, legacy matches, issues, audit events, and candidate ranking.

Repeated calculations:

- Ledger derives row models, issue markers, category suggestion targets, filtered rows, reconcile queues, page rows, and footer totals from similar loaded-row inputs.
- Reconcile computes sorted/newest-first variants, match maps, expected/matched lists, bank unmatched/matched lists, counts, issue diagnostics, and AI candidates.

Repeated API calls:

- Reconcile refreshes bank rows, placement summary, entries, Plaid status, snapshots, and match groups through multiple event paths.
- The page has coalescing and epoch guards, which reduce refresh storms, but placement summary and list refreshes remain potentially heavy.

Full-page blockers:

- Reconcile shows updating overlays for financial mutations and Plaid sync. This is safer than faking truth, but can block review workflows during long network calls.

Table/list rendering concerns:

- Ledger paginates loaded rows and Reconcile caps rendered rows, which helps. However, neither page has true virtualization for very large tables.
- Long payee/category/memo text is often truncated or break-wrapped, but some dense dialogs and table layouts have fixed pixel columns that may squeeze on mobile.

Expensive filters/sorts:

- Client-side filters and searches operate over loaded rows, not full server truth.
- Reconcile AI candidate builders sort visible candidates and slice top candidates, which is acceptable for the cap but may become costly with higher caps.

Memoization opportunities:

- Extract selector hooks for active rows, row models, match maps, and totals.
- Server-returned counts can replace several client count passes.
- Post-mutation refresh can target affected IDs rather than broad page refreshes.

## Backend / Background Work Findings

- Ledger uses optimistic mutation and delayed/coalesced refresh for common entry changes.
- Reconcile has refresh epoch guards and coalescing to prevent stale refreshes from committing state.
- Backend endpoints generally preserve truth by requiring active entries for update/delete/match operations.
- Optimistic UI is safe for reversible visual states such as pending rows and deleted markers if backend refresh corrects failures.
- Optimistic UI is unsafe for bank/Plaid truth, match truth, and totals when sync or reconciliation state is stale.
- Background refresh would help after category suggestion application, create-entry-from-bank, match-group creation, and Plaid sync, but the UI must label stale or partial truth rather than silently trusting it.

## Totals and Soft Delete Findings

Checked whether soft-deleted entries may be included in:

- Ledger totals: visible footer totals exclude `isDeleted` rows. Backend `ledgerSummary` also filters `deleted_at: null`.
- Reconcile totals/counts: active entry queries exclude deleted rows by default. Reconcile derived lists use `useEntries` without `includeDeleted`, so soft-deleted entries are excluded from active review lists.
- Reports: inspected report queries consistently filter `deleted_at IS NULL` / `deleted_at: null` for entry-based totals.
- AI suggestions: category history and entry snapshots filter `deleted_at: null`; Ledger does not request suggestions for deleted rows.
- Summaries: attention summary, insights, search, and AI aggregate paths inspected use active-entry filters.
- Category learning/history: category suggestion history excludes deleted entries. Category memory writeback depends on callers preserving active-entry guards.
- Account balances: entry list running balance and ledger summary exclude soft-deleted entries. Plaid/bank balances are separate bank truth and must not be inferred from deleted ledger entries.

No PR 1 behavior change was made. The main follow-up is to keep soft-delete exclusion explicit in future AI prompt/context wiring and add tests around AI learning from deleted rows.

## UI / Dark Mode / Layout Findings

- The app uses Bynkbook design tokens such as `bg-bb-surface-card`, `text-bb-text`, `border-bb-border`, and status tokens across Ledger/Reconcile.
- Some warning/error blocks still use direct Tailwind color families such as amber/red/emerald. These may be acceptable but should be checked in dark mode.
- Ledger table controls use compact fixed widths and truncation. Long payee/category/vendor text is mostly handled with truncate or break-words, but dense row action menus and dialogs may compress on narrow screens.
- Reconcile tables use fixed min widths such as `min-w-[820px]`, so mobile likely relies on horizontal scrolling. This should be verified with screenshots before UI fixes.
- Several dialogs contain dense grids and tables that may not fit small screens cleanly.
- Hidden actions are a risk because Ledger has many row-level actions in compact action areas; verify focus/hover/touch affordances before PR 2 UI work.

## Safety Findings

- Matched entry delete has strong safety: typed confirmation is required before unmatching and soft-deleting.
- Normal soft delete has an explicit confirmation dialog.
- Bulk delete does not silently delete; it is initiated by selected rows and still uses backend safety checks.
- Hard delete exists for deleted rows and is only protected by a simple confirmation dialog. This is the highest destructive-action safety gap found.
- Backend blocks normal delete of active matched entries and redirects to safer unmatch-and-delete behavior.
- Generated-entry revert in MatchGroups requires explicit confirmation before soft-deleting generated entries.
- Auto-reconcile is deterministic, review-first, and applies only selected suggestions.
- Plaid status includes `lastSyncAt`, errors, and attention states, but the product needs a consistent stale-sync warning threshold before AI relies on sync freshness.
- AI category application has an undo window in Ledger, but future bulk AI apply must stay review-first.

## Ledger/Reconcile Status Behavior

- `MATCHED`: Active MatchGroups are treated as matched. Legacy active matches are still considered in fallback paths.
- `EXPECTED`: Active unmatched ledger entries are shown in expected/review queues unless opening, cash-exempt, adjusted, or filtered out.
- `PARTIALLY_MATCHED`: Legacy match code supports partial matches, but current MatchGroups model is full-match only. UI labels partial only from legacy matched amount comparisons in Ledger.
- `UNMATCHED`: Bank transactions not in active groups or active legacy matches are shown as unmatched.
- `SOFT_DELETED` / `VOIDED`: Soft-deleted entries and voided match groups are historical/audit context only and should not count as active truth.

## Hardcoded / Placeholder / Route Findings

- No obvious broken core route was found by code inspection.
- Existing docs include `docs/page.tsx`, but no top-level docs index was updated for PR 1 to avoid touching app behavior or unrelated docs rendering.
- The UI includes copy for placeholder/loading/empty states throughout Ledger/Reconcile.
- The app has existing Transfer/Adjustment product paths; this audit does not remove them, but future AI behavior should not introduce them as category/entry-type suggestions.

## Recommended PR 2 Bundle

Recommended next implementation bundle:

- Wire the AI Knowledge Pack into category suggestion prompts/context in a read-only, testable way.
- Add category suggestion safety tests for IRS, Zelle, Amazon, card payments, refunds, bank fees, soft-deleted entries, and stale sync warnings.
- Add server-backed Reconcile counts and pages for expected/matched entries and unmatched/matched bank transactions.
- Fix Reconcile capped-window truth so counts and review priorities are not limited to the first 200 entries.
- Optimize bank matched/unmatched queries to avoid large `notIn` ID lists.
- Add stale Plaid sync policy and user-visible warning surfaces.
- Add typed confirmation or stronger policy for hard delete.
- Improve local loading/background refresh behavior after match/category/create-entry mutations.
- Add expected/partially matched review-priority sorting after server-backed truth is available.
- Verify and polish Ledger/Reconcile table layout in dark mode and mobile screenshots.

## Explicit Non-Changes in PR 1

PR 1 intentionally did not:

- Redesign the app.
- Change app behavior.
- Implement performance fixes.
- Refactor major code paths.
- Change backend contracts.
- Change database schema.
- Change Plaid behavior.
- Change ledger or reconcile sorting.
- Change totals logic.
- Add Transfer or Adjustment entry types.
- Remove existing Transfer or Adjustment code paths.
- Change soft-delete, void, or reconciliation behavior.
