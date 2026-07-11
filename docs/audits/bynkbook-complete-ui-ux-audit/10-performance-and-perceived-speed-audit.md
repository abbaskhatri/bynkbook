# Performance and Perceived-Speed Audit

## Build evidence

- Next.js 16.2.10 production build passed in 15.2s.
- 33 routes generated.
- 76 static chunk files total approximately 3.94 MB uncompressed; two largest JS chunks are approximately 398 KB each.
- The configured Next Bundle Analyzer cannot analyze Turbopack, so no route-level bundle graph was produced.

## Strengths

- Dynamic imports for charts, Plaid, uploads, global search and major dialogs.
- TanStack Query stale/placeholder data patterns.
- Reconcile list virtualization and server paging.
- Refresh coalescing/epoch guards on vendor pages and targeted background refresh on Ledger.
- Busy/disabled states prevent many duplicate submissions.

## Risks

- Reconcile (7,556 lines), Ledger (5,951), Settings (4,012), Category Review (2,843) and Vendor detail (2,679) concentrate state and derived calculations.
- Sixteen pages render no Suspense fallback; users may see blank transitions.
- Dashboard coordinates eight query surfaces.
- Dialog-heavy pages dynamically load some primitives but still carry large page modules.
- Current authenticated timings could not be measured.

## Recommendations

Add route-level interaction traces and Web Vitals in a synthetic tenant; replace null fallbacks; introduce page-section boundaries/state machines; retain virtualization; use route-level bundle analysis via `next experimental-analyze` or a webpack analysis build; measure before changing queries.
