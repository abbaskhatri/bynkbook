# Reconcile Loading, Alignment, Padding, and Responsive Audit

## Runtime method

Production was opened with the repository's synthetic QA identity at 390×844, 768×1024, and 1440×1000. The run was read-only: no Plaid sync/refresh, no imports, and no customer-data mutation. Screenshots and sanitized network evidence are under `output/playwright/re-audit-2026-07-11/`.

## Permanent ledger loader

The background entries effect includes `entriesBackgroundLoading` in its dependency array. Its timer callback calls `setEntriesBackgroundLoading(true)`. That rerender runs the effect cleanup, setting its local `cancelled=true`. When the successful API request returns, the callback exits before updating rows/cursor, and its `finally` also skips `setEntriesBackgroundLoading(false)` because the request is marked cancelled.

Observed in production after 34 seconds:

- API entry pages returned HTTP 200.
- Skeleton count reached zero.
- The visible UI still said `Loading older ledger entries…` and `Loading older history`.
- Only the first 200 rows were committed even though the second page had returned.

This is deterministic and directly explains the user's constant Reconcile loading report.

## Permanent history skeleton after error

`loadAllMatchGroups` sets `allMatchGroupsLoadedScope=""` on failure. The history view shows a skeleton whenever `!allMatchGroupsHydrated`. There is no terminal error or retry state on that branch, so one failed request can leave the history dialog displaying a loader indefinitely.

## Request amplification

Placement-summary requests rerun as each background entries page changes `allEntriesSorted`. Production aggregate telemetry over 14 days showed:

- placement summary: 353 successful requests, average 745 ms, p95 3.014 s;
- bank transactions: 215 successful requests, average 867 ms, p95 3.156 s;
- entries: 211 successful requests, average 937 ms, p95 3.622 s.

The synthetic runtime made two placement-summary calls during a single initial load. This is not an API failure, but it extends the period in which `matchGroupsLoading` can keep section activity indicators active.

## Responsive alignment and padding

### 390px mobile

- No page-level horizontal overflow.
- Command surface was consistently inset 12px on both sides.
- No clipped or off-viewport controls were detected.
- Filters stack cleanly; bottom navigation remains reachable.
- The permanent ledger-loading copy is visible and misleading.

### 768px tablet

- Confirmed page width: 949px in a 768px viewport.
- The sidebar switches on at `md` while the desktop topbar search/actions also switch on at `md`.
- Global search, recent activity, and account menu are pushed outside the viewport.
- The Reconcile command surface itself remains within the remaining content column, but the shell breakpoint combination creates global horizontal overflow.

### 1440px desktop

- No page-level horizontal overflow.
- Command surface alignment is consistent with the content inset.
- The two-column ledger/bank grid is dense but aligned.
- Table padding is internally consistent; sticky action columns remain visible.

## Alignment conclusion

The primary padding issue is not arbitrary per-card spacing. It is a global breakpoint collision at tablet width. The sidebar/topbar desktop controls should not activate together until enough width exists, or the search/actions must collapse between 768px and the desktop threshold.

