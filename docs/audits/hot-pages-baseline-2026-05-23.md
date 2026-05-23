# Hot Pages Baseline — 2026-05-23

Captured at the start of the Phase 2 hot-page performance work. Numbers below are the **before** values; subsequent PRs that touch these pages should reduce them.

## Source size per page (TypeScript only)

| Page              | Size (bytes) | Lines | Biggest file                                     |
|-------------------|-------------:|------:|--------------------------------------------------|
| ledger            |      264,374 | 6,724 | `ledger/page-client.tsx` (263,171 bytes)         |
| reconcile         |      348,296 | 7,742 | `reconcile/page-client.tsx` (348,075 bytes)      |
| issues            |       44,367 | 1,164 | `issues/page-client.tsx` (44,145 bytes)          |
| category-review   |      113,956 | 2,584 | `category-review/page-client.tsx` (113,720 bytes)|
| dashboard         |       87,405 | 2,325 | `dashboard/page-client.tsx` (74,914 bytes)       |
| reports           |       91,656 | 2,122 | `reports/page-client.tsx` (79,782 bytes)         |
| planning          |       24,421 |   600 | `planning/page-client.tsx` (24,291 bytes)        |
| vendors (combined)|      145,110 | 3,250 | `vendors/[vendorId]/page-client.tsx` (121,918 b) |
| settings          |      197,321 | 4,293 | `settings/page-client.tsx` (182,163 bytes)       |
| closed-periods    |       31,949 |   709 | `closed-periods/page-client.tsx` (31,716 bytes)  |

**Observations:**
- The four hottest user-facing pages (per the product owner) are ledger, reconcile, issues, category-review.
- Reconcile (348 KB) is the single largest screen and ~30% bigger than ledger.
- Reconcile + ledger together total ~613 KB of TS — most of it in one file each.
- Issues at 44 KB is comparatively healthy.

## How to re-measure

```bash
# From repo root
cd bynkbook-web/src/app/\(app\)
for p in ledger reconcile issues category-review dashboard; do
  bytes=$(find "$p" -type f \( -name "*.tsx" -o -name "*.ts" \) -exec cat {} + | wc -c)
  lines=$(find "$p" -type f \( -name "*.tsx" -o -name "*.ts" \) -exec cat {} + | wc -l)
  echo "$p $bytes $lines"
done
```

## How to inspect client bundle composition

Bundle analyzer is wired into `next.config.ts` and triggered by `ANALYZE=1`. Next 16 uses Turbopack by default; the analyzer currently requires webpack, so use `--webpack`:

```bash
# Windows PowerShell
$env:ANALYZE='1'; npx next build --webpack

# bash / macOS
ANALYZE=1 npx next build --webpack
```

Output:
- `.next/analyze/client.html` — what users download
- `.next/analyze/nodejs.html` — server-side bundle
- `.next/analyze/edge.html` — edge runtime bundle

Open `client.html` in a browser. Look for the page-specific chunk (under `app/(app)/<page>/page`) and the modules included.

**Note:** The webpack build may crash at the static-page generation step with "Division by zero" — this is a known Next 16 issue when both webpack and Turbopack runs coexist in the same `.next` directory. The HTML reports are written **before** the crash, so they are still usable. Workaround: `rm -rf .next` between Turbopack and webpack builds.

## How to use the dev-only Perf Overlay

Added in this PR (`src/components/app/perf-overlay.tsx`).

- Runs only when `NODE_ENV !== "production"` — entire component returns `null` in prod
- Press **Alt+P** to toggle (state persisted in `localStorage["bynkbook.debug.perfOverlay"]`)
- Shows:
  - Last route transition time (ms)
  - React Query cache size + active fetches/mutations
  - Slowest API calls by p95 (top 6)
  - Slowest UI work by p95 (top 4)
- Click ↻ to reset samples
- Click − to collapse, × to hide

Existing `metrics.api()` calls in `lib/api/client.ts` feed it automatically.

## What this baseline informs

Subsequent PRs in Phase 2 will:

1. Split ledger and reconcile page-clients into smaller files (toolbar / row / actions / dialogs).
2. Lazy-load dialog code paths so they don't ship on initial page load.
3. Virtualize ledger / reconcile / issues tables.
4. Audit `@/components/ui/*` dynamic imports to remove unnecessary ones.

Each PR should reduce the numbers above. We re-measure after each merge.

## Update — Phase 2b (reconcile pure-helper extraction)

Extracted pure helper functions and presentational sub-components out of
`reconcile/page-client.tsx` to new modules. No logic changed; every function
behaves identically.

| Page         | Before (bytes) | After (bytes) | Δ          |
|--------------|---------------:|--------------:|-----------:|
| reconcile    |        348,296 |       326,153 | **−22 KB** |
| └─ page-client.tsx |  348,075 |       325,932 | **−6.4%**  |

New modules (importable / reusable):
- `lib/reconcile/helpers.ts` (512 lines, 17 KB) — pure functions: BigInt math, date helpers, scoring, signatures, comparators, signal-chip builders.
- `components/reconcile/match-cards.tsx` (179 lines, 7 KB) — pure presentational: TinySpinner, UpdatingOverlay, MatchSignalChip, MatchSideCard, MatchPairPreview.

Modest size win, but the main `ReconcilePageClient` function lost ~600 lines from its body — meaningfully reducing render and JIT cost. Sets up the pattern for Phase 2c (dialog extraction with lazy loading), where the real bundle-size wins live.
