# Mobile performance and perceived-speed audit

## Current evidence

| Surface | Evidence | Assessment | Mobile requirement |
|---|---|---|---|
| Reconcile lists | TanStack `useVirtualizer`; thresholded row virtualization | Strong; preserve (`023`) | Verify dynamic row heights and AT |
| Reconcile refresh | `preserveOnEmpty`/bounded post-sync refresh | Strong trust/perceived speed | Keep last-good rows with freshness label |
| Dashboard | Keep-last-good period data; chart panels | Positive, but card/chart cost remains | Prioritize and lazy-load below-fold analytics |
| Ledger | 5,957-line client component; all queue rows visible/loaded path | Rerender and bundle risk | Split presentation/detail; measure 50/500/5,000 rows |
| Reconcile | 8,050-line client component and 12 dialogs | State coupling/bundle risk despite virtualization | Route-level code splitting for complex flows |
| Settings | 4,105-line component; five tables/11 dialogs | Eager admin complexity | Split settings subroutes and lazy-load panels |
| Vendor detail | 2,679-line component; five tables/seven dialogs | Large workspace cost | Segmented routes and per-section queries |
| Charts | Recharts on dashboard/reports | Mobile parse/render cost | Lazy-load; avoid offscreen animation |
| Images/files | Upload previews | Oversized/failed preview risk | Thumbnail sizing, progressive loading, failure state |

## Interaction budget

- Tap feedback: visible within 100ms.
- Navigation skeleton/last-good state: within 200ms.
- Search/filter local response: within 100ms after input debounce.
- Network mutations: immediately show pending state and block duplicates.
- Route/detail opening: preserve existing list rather than full reload.
- Layout shift: reserve headers, rows, charts, and bottom action bars.

## Required traces

Capture Lighthouse/Web Vitals or equivalent for cold dashboard, Ledger list, Reconcile queue, account switch, detail open/back, filter apply, dialog/sheet open, and form typing. Record LCP, INP, CLS, JS size, query counts, rerender counts, and long tasks. The audit did not run authenticated performance traces because no synthetic authenticated session was available.

## Large-list validation

Use synthetic records at 50, 500, and 5,000 items with long names and mixed states. Validate scroll FPS, memory, filter time, row expansion, screen-reader navigation, and return-to-anchor. Never load or expose production customer records for performance testing.
