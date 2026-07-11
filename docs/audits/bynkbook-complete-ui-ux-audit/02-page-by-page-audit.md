# Page-by-Page Audit

The route inventory in `01` is the canonical page list. Every source page was inspected; public/auth pages were browser-rendered, while authenticated pages were code/data-flow traced because the synthetic QA refresh returned HTTP 400.

## Public and authentication

- **Landing:** polished, responsive, no horizontal overflow, clear calls to action. Trust is undermined by unsupported “Launch-ready,” “Ready for real books,” `3x`, and `100%` claims while legal pages remain placeholders. Header Sign in measures 76×32 at 390px.
- **Login:** semantic form, correct labels and autocomplete, clean keyboard order, no production console errors. Primary button contrast inherits the global 3.77:1 token issue.
- **Signup / confirmation / recovery:** visually consistent and labeled, but controls are not inside `<form>` elements and lack `name`; browser reports the signup password is not contained in a form. Enter submission and password-manager behavior are therefore inconsistent.
- **Business creation:** the strongest auth-side form: semantic form, grouped fields, safe next step. It is long and asks business profile, logo, currency, timezone, and fiscal settings in one step; progressive disclosure is preferable.
- **Privacy / Terms:** attractive presentation but legally incomplete and release-blocking.

## Daily work

- **Dashboard:** useful hierarchy of period, KPIs, charts, account balances, attention and AI. Eight query surfaces and dense microcopy increase perceived complexity. Cash/account balances show “as of” but not provenance.
- **Ledger:** extremely capable but combines entry creation, filters, running balances, AP, transfers, deletion, restoration, uploads and seven overlays. Preserve virtualization/search guardrails; split task sections and standardize progressive disclosure.
- **Reconcile:** financial state handling, pagination, virtualization and action blocking are strengths. The 7,556-line client and 12 overlays create the highest cognitive/regression risk. Sync status lacks visible last-success time.
- **Issues / Category Review:** action-oriented and scoped, but terminology overlaps (“Issues,” “Review,” “Uncategorized”) and high-density controls use small type/targets.
- **Closed Periods:** clear financial consequence and owner/admin boundaries; closing/reopening should use the corrected canonical modal pattern.
- **Planning / Reports:** coherent domains. Reports use explicit Run report behavior and date/scope; blank route fallback and balance provenance should improve.
- **Vendors / Vendor detail:** directory is focused; vendor detail has seven overlays and combines profile, bills, credits, payments, applications, files, void/delete flows. It should be split into stable sub-sections.
- **Settings:** comprehensive but 4,012 lines and 11 overlays. Activity raw JSON is developer-facing. Role-independent navigation sends users here even if they cannot modify sections.

## Mobile routes

The dedicated `/mobile/*` pages are touch-oriented and capped at 480px, but coexist with a responsive version of the full app. The two systems use different labels and primary tasks. Product must choose one canonical mobile architecture before further polish.

## Loading, empty, error, and permission states

- Dashboard and Ledger have representative skeletons.
- Reports and vendor detail show generic Loading text.
- Sixteen other routes use `Suspense fallback={null}`, permitting blank transitions.
- Several data pages preserve last-good data and show scoped retry banners—retain this behavior.
- Backend policies are enforced for changes, but the shell does not filter navigation by role; users can reach screens whose actions are unavailable.
