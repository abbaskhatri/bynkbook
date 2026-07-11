# UI/UX Remediation Roadmap — No Implementation

| Phase | Findings | Scope / dependencies | Risk and required validation | PR boundary |
|---|---|---|---|---|
| 1. Release trust | 001,011 | Legal pages + landing copy; counsel/business input | Low code, high legal; content approval, route assertions | Legal/content only |
| 2. Overlay accessibility | 002,013,016 | AppDialog/AppSidePanel + representative consumers | Medium-high regression; keyboard, SR, mobile, destructive flows | Primitive + tests, then consumer fixes |
| 3. Financial freshness | 003 | Accounts/Plaid/Reconcile/Dashboard | Medium; data contracts and state fixtures | Health component/API presentation |
| 4. Auth forms and tokens | 006,007,008,009 | Auth forms, primary token, control/type scales | Medium visual/reflow; contrast, password managers, responsive snapshots | Auth semantics; token/accessibility separately |
| 5. Navigation/IA | 004,005,019 | Shell, Settings grouping, mobile decision | High product/navigation regression; role×route×viewport tests | IA decision, shell PR, mobile consolidation PRs |
| 6. Async states | 012,016 | 16 route fallbacks, live/busy/error patterns | Low-medium; throttled visual/SR tests | Async primitive + route adoption |
| 7. Activity presentation | 010 | Event summary/redaction map | Medium data/content; fixture coverage | Activity presenter |
| 8. Test foundation | 015,021 | Fresh synthetic tenant, component/E2E/a11y | Low production risk | Test infrastructure, then role/workflow suites |
| 9. Page decomposition | 014,018 | Reconcile, Ledger, Settings, Vendor detail | High regression; parity/perf/browser tests | One bounded page section per PR |
| 10. Cleanup | 017,020 | Dead file, dev-only CSP | Low | Separate cleanup PR |

Figma is required before phases 3 and 5 and recommended for representative phase-2 and phase-9 work. Backend changes are not required for most findings; production/test access is required for trustworthy validation.
