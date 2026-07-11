# Complete UI/UX Findings Register

## Summary

| ID | Severity | Category | Title |
|---|---|---|---|
| BYNK-UIUX-AUDIT-001 | HIGH | trust/copy | Launch claims conflict with placeholder legal pages |
| 002 | HIGH | accessibility/dialog | Shared overlays do not contain or restore focus |
| 003 | HIGH | financial trust/Plaid | Sync freshness and balance provenance are not visible |
| 004 | MEDIUM | navigation/permissions | Navigation is not role-aware |
| 005 | MEDIUM | information architecture/responsive | Two competing mobile architectures |
| 006 | MEDIUM | form/accessibility | Signup and recovery controls are outside semantic forms |
| 007 | MEDIUM | accessibility/design token | Primary button contrast is 3.77:1 |
| 008 | MEDIUM | accessibility/responsive | Many interactive targets are below 44px |
| 009 | MEDIUM | accessibility/visual hierarchy | Micro typography is pervasive |
| 010 | MEDIUM | copy/security | Activity exposes raw JSON payloads |
| 011 | MEDIUM | trust/copy | Numeric marketing claims are unsupported in the UI |
| 012 | MEDIUM | state/perceived speed | Sixteen routes have blank Suspense fallbacks |
| 013 | MEDIUM | interaction/dialog | Overlay density causes context switching and confirmation fatigue |
| 014 | MEDIUM | performance/maintainability | Core page clients are monolithic |
| 015 | MEDIUM | quality/accessibility | Frontend tests do not cover workflows/components/accessibility |
| 016 | MEDIUM | accessibility/state | Skip navigation and async announcements are incomplete |
| 017 | LOW | dead UI | Orphan dev-dialog client remains |
| 018 | LOW | consistency/design system | Duplicate component patterns remain |
| 019 | LOW | navigation | `/accounts` is only a hidden compatibility redirect |
| 020 | LOW | developer experience | Production CSP breaks Next development eval/HMR |
| 021 | INFO | verification blocker | Current authenticated browser audit is unavailable |
| 022 | INFO | Figma blocker | Figma-ready specs produced without claiming current authenticated frames |

## Detailed findings

### BYNK-UIUX-AUDIT-001 — Launch claims conflict with placeholder legal pages

- Severity/confidence/category: **HIGH / High / confirmed content and trust defect**.
- Role/page/route/device/workflow/frequency: Public; landing, Privacy, Terms; `/`, `/privacy`, `/terms`; all devices; acquisition/signup; every visitor.
- Current vs expected: Landing says “Launch-ready” and “Ready for real books,” while legal pages explicitly instruct replacement before launch. Release claims should match approved legal readiness.
- Evidence: Browser screenshot/text search; `page.tsx`; privacy line 112; terms lines 34/112.
- Impact: Material trust/compliance risk; financial users may infer readiness that the product itself contradicts. No responsive/performance impact.
- Cause/recommendation/Figma: Placeholder legal dependency plus marketing copy drift. Obtain approved text and temporarily remove launch-ready claims. Figma not required.
- Complexity/dependencies/risk/validation/blocking: Medium external, low code; counsel/business dependency; low UI regression; legal approval/content assertions; **blocks public release and requires immediate action**. Related: BYNK-AUDIT-002.

### BYNK-UIUX-AUDIT-002 — Shared overlays do not contain or restore focus

- Severity/confidence/category: **HIGH / High / confirmed accessibility and interaction defect**.
- Scope: All roles; AppDialog/AppSidePanel; 51 reachable instances; all viewports; frequent financial/destructive workflows.
- Current vs expected: Container receives focus and Escape closes, but Tab can escape; trigger is not restored; background is not inert or scroll-locked; side panels lack labelled-title linkage. Modal context must be isolated and recover focus.
- Evidence: `AppDialog.tsx:34-94`, `AppSidePanel.tsx:31-78`; static inventory (Reconcile 12, Settings 11, Ledger 7, Vendor detail 7).
- Impact: Keyboard/screen-reader task failure, accidental background interaction and lost context; high financial-trust impact for delete/disconnect/match/close actions; mobile overlays are especially affected.
- Cause/recommendation/Figma: Hand-rolled modal behavior. Adopt one Radix-backed canonical FinancialDialog/SidePanel with trap, inert background, scroll lock, initial/return focus and busy dismissal rules. Figma recommended: canonical dialog states.
- Complexity/dependencies/risk/validation/blocking: Medium; design-system dependency, no backend; medium regression across 51 instances; keyboard + NVDA/VoiceOver + mobile tests; **can block accessible completion, immediate action**.

### BYNK-UIUX-AUDIT-003 — Sync freshness and balance provenance are not visible

- Severity/confidence/category: **HIGH / High / financial trust, Plaid UX**.
- Scope: All financial roles; Settings accounts, Reconcile, Dashboard; desktop/mobile; every balance/sync review.
- Current vs expected: API supplies `last_sync_at`, but no UI renders it. Connection shows Connected/Needs attention only. Dashboard shows Cash/Account Balances “as of” without consistently saying ledger-derived versus bank current/available.
- Evidence: `api/accounts.ts` includes `last_sync_at`; repository-wide UI search has no rendering; Reconcile status lines 3295-3385; dashboard balance cards lines 1378-1531.
- Impact: Users cannot judge staleness or compare bank versus ledger concepts; numbers are not proven incorrect, but confidence and recovery decisions are impaired.
- Cause/recommendation/Figma: Data contract outpaces presentation. Add AccountConnectionHealth and explicit “Ledger balance”/“Bank sync” source labels. Figma recommended.
- Complexity/dependencies/risk/validation/blocking: Medium; existing backend data mostly sufficient; low-medium regression; stale/pending/error/never-synced tests; **does not always block completion but merits immediate financial-trust action**.

### BYNK-UIUX-AUDIT-004 — Navigation is not role-aware

- Severity/confidence/category: **MEDIUM / High / navigation, permissions**.
- Scope: Five roles; AppShell and settings; all app routes/devices; every session.
- Behavior: One `NAV_GROUPS` array renders for all roles. Users can navigate to destinations where actions are unavailable. Expected: role/policy-aware guidance while backend remains authoritative.
- Evidence: `app-shell-inner.tsx` NAV_GROUPS/rendering; no role filter. User impact is confusion/failed actions, not proven data exposure.
- Recommendation: define route metadata with minimum static role plus effective change-policy hints; explain read-only state. Figma: role-aware navigation states.
- Complexity/dependencies/risk/validation/blocking: Medium, auth/business-role data dependency, medium nav regression; role×route browser matrix; may block efficient completion but not security. No immediate emergency.

### BYNK-UIUX-AUDIT-005 — Two competing mobile architectures

- Severity/confidence/category: **MEDIUM / High / IA, responsive design limitation**.
- Scope: All authenticated roles; responsive AppShell plus seven `/mobile*` routes; phone; frequent work.
- Behavior: Full app mobile tabs are Home/Ledger/Reconcile/Issues/More; dedicated mobile tabs are Home/Review/Receipt/Vendors/Invoice. Expected: one predictable task model.
- Evidence: `app-shell-inner.tsx:1138+`, `mobile-shell.tsx`, route inventory.
- Impact: Feature discovery, deep-link consistency and maintenance suffer; no financial calculation impact.
- Recommendation: product decision on canonical mobile architecture; preserve focused capture flows. Figma recommended for unified IA.
- Complexity/dependencies/risk/validation/blocking: High product/design, backend low; high navigation regression; mobile role/workflow tests; **product decision, not immediate blocker**.

### BYNK-UIUX-AUDIT-006 — Signup and recovery controls are outside semantic forms

- Severity/confidence/category: **MEDIUM / High / form accessibility defect**.
- Scope: Public users; signup, confirmation, forgot/reset; all devices; account access; frequent for new/recovering users.
- Behavior: Only login/business creation use semantic forms. Signup inputs have no form or name; Chromium logs password-outside-form. Expected: form submission, stable names, error relationships.
- Evidence: production-mode browser eval/log and three `<form>` source occurrences.
- Impact: Enter submission, autofill/password managers and assistive error handling are inconsistent; can impede access.
- Recommendation: canonical AuthForm/Field; Figma not required. Low backend dependency.
- Complexity/risk/validation/blocking: Low-medium; Cognito flow regression medium; keyboard/password-manager/screen-reader tests; **may block some users, prompt correction recommended**.

### BYNK-UIUX-AUDIT-007 — Primary button contrast is 3.77:1

- Severity/confidence/category: **MEDIUM / High / accessibility, design token**.
- Scope: All roles/pages using light primary; normal 14px button labels; frequent.
- Behavior: white foreground on `#059669` is 3.77:1, below 4.5:1 for normal text. Expected WCAG AA token pair.
- Evidence: computed production-mode landing/login styles and token values in `globals.css`.
- Impact: low-vision readability; no financial/responsive/performance impact.
- Recommendation: darken light primary or use darker foreground; verify states/charts separately. Figma/design-system recommended.
- Complexity/risk/validation/blocking: Low token change, medium visual regression; automated contrast + screenshots; accessibility release blocker depending conformance target.

### BYNK-UIUX-AUDIT-008 — Interactive targets are below 44px

- Severity/confidence/category: **MEDIUM / High / responsive accessibility**.
- Scope: All roles; landing, shell, tables, reconciliation/planning/settings; touch devices; high frequency.
- Behavior/evidence: Landing Sign in measured 76×32 at 390px; source has 20 28px icon-control patterns and 14 32px patterns (some matches decorative). Expected 44px touch hit area.
- Impact: motor/touch errors, especially near consequential financial actions.
- Recommendation: separate compact visual size from 44px hit area; canonical IconButton. Figma/component dependency.
- Complexity/risk/validation/blocking: Medium due dense tables; responsive regression medium; automated bounding-box audit; does not universally block but is immediate accessibility work.

### BYNK-UIUX-AUDIT-009 — Micro typography is pervasive

- Severity/confidence/category: **MEDIUM / High / visual hierarchy, accessibility risk**.
- Scope: All roles; dashboard/tables/status metadata; all devices; constant.
- Behavior/evidence: 471 `text-[10px]`/`text-[11px]` occurrences. Expected 12px metadata floor and 14px controls/body except exceptional labels.
- Impact: scanning, zoom and cognitive burden; dense financial content loses hierarchy.
- Recommendation: normalize type scale and reduce uppercase micro labels. Figma/design-system recommended.
- Complexity/risk/validation/blocking: Medium-high reflow risk; visual regression and 200% zoom tests; not immediate task blocker.

### BYNK-UIUX-AUDIT-010 — Activity exposes raw JSON payloads

- Severity/confidence/category: **MEDIUM / High / copy, developer leakage**.
- Scope: Authenticated members with Settings access; Activity tab; desktop/tablet; occasional audit workflow.
- Behavior: Event names are humanized, but Details expands `JSON.stringify(payload_json)` in `<pre>`. Expected allowlisted human summaries and privileged redacted technical detail.
- Evidence: Settings lines 1300-1360; activity API returns payload JSON.
- Impact: confusion, internal IDs/implementation detail exposure within tenant; no cross-tenant evidence.
- Recommendation: event-specific presenter/redaction. Figma optional.
- Complexity/risk/validation/blocking: Medium mapping work; backend optional; low financial regression; fixture tests; not immediate blocker.

### BYNK-UIUX-AUDIT-011 — Numeric marketing claims are unsupported

- Severity/confidence/category: **MEDIUM / High / trust and copy**.
- Scope: Public landing; all visitors/devices; acquisition.
- Behavior: `3x fewer clicks`, `12h max age`, `100% Audit trail` are hardcoded without methodology; 12h is a real session policy but phrasing is marketing-like. Expected verifiable/qualified claims.
- Evidence: landing constants/browser screenshot.
- Impact: credibility and potential marketing/compliance risk; no workflow impact.
- Recommendation: remove or qualify with evidence. No Figma needed; trivial code, business approval; copy assertion.

### BYNK-UIUX-AUDIT-012 — Sixteen routes have blank Suspense fallbacks

- Severity/confidence/category: **MEDIUM / High / missing state, perceived speed**.
- Scope: Public invite and most authenticated/mobile pages; route transitions; frequent.
- Behavior/evidence: 16 page files use `fallback={null}`; only Dashboard/Ledger have structured skeletons and two routes use generic Loading text.
- Impact: blank content can look broken/slow, especially on mobile or cold load.
- Recommendation: route-specific stable skeleton/redirect state with accessible status. Figma: loading patterns.
- Complexity/risk/validation/blocking: Low-medium; no backend; low regression; throttled navigation/visual tests; not a data blocker.

### BYNK-UIUX-AUDIT-013 — Overlay density causes context switching

- Severity/confidence/category: **MEDIUM / High / interaction friction**.
- Scope: Financial roles; Reconcile 12, Settings 11, Ledger 7, Vendor detail 7; high-frequency desktop/mobile workflows.
- Behavior: 37 overlays across four pages; many are valid, but inspection/edit/confirmation repeatedly removes page context. Expected inline/sidepanel/dialog selection by task duration/consequence.
- Evidence: static component instance inventory.
- Impact: learning cost, accidental dismissal risk and confirmation fatigue.
- Recommendation: overlay decision matrix and progressive disclosure; Figma recommended for reconcile/settings. High design complexity, no necessary backend; task-time usability tests.

### BYNK-UIUX-AUDIT-014 — Core page clients are monolithic

- Severity/confidence/category: **MEDIUM / High / performance and maintainability risk**.
- Scope: All users/developers; Reconcile 7,556, Ledger 5,951, Settings 4,012, Category Review 2,843, Vendor detail 2,679 lines.
- Behavior: query/state/dialog/derived calculations and view code coexist. Expected tested feature sections/state machines.
- Impact: regression/perceived performance risk; no current accounting defect proven.
- Recommendation: decompose after component/E2E coverage; no broad visual rewrite. High complexity/risk; performance traces and parity tests. Related BYNK-AUDIT-019.

### BYNK-UIUX-AUDIT-015 — Frontend tests do not cover workflows/components/accessibility

- Severity/confidence/category: **MEDIUM / High / missing validation**.
- Scope: Entire UI; all roles/devices.
- Behavior: Vitest exists, but only seven CSV-security unit tests. Expected component, role, dialog, responsive, accessibility and safe E2E suites.
- Evidence: test inventory/package scripts.
- Impact: regressions in 31 pages/51 overlays can ship despite build/lint success.
- Recommendation: prioritized test pyramid before major refactor. Medium effort, low product risk; correction is tests. Not a direct task blocker.

### BYNK-UIUX-AUDIT-016 — Skip navigation and async announcements are incomplete

- Severity/confidence/category: **MEDIUM / Medium-high / accessibility, state management**.
- Scope: Keyboard/screen-reader users; shell and async pages; frequent.
- Behavior/evidence: First landing Tab is Product, no skip link found; source inventory has one live/status, one aria-busy and four explicit alerts across a large async UI.
- Impact: repetitive navigation and silent loading/success changes. Visual messages may still exist.
- Recommendation: skip link, main target, canonical AsyncState/live regions, busy/invalid semantics. No Figma necessary; medium regression; screen-reader tests.

### BYNK-UIUX-AUDIT-017 — Orphan dev-dialog client remains

- Severity/confidence/category: **LOW / High / dead UI**.
- Scope: Developers only; unreachable file.
- Behavior/evidence: route page was removed, but `src/app/(app)/dev/dialogs/page-client.tsx` remains and contains dialog/panel examples.
- Impact: audit/build maintenance noise, no user task impact.
- Recommendation: delete after import proof. Trivial, low risk, typecheck/build validation.

### BYNK-UIUX-AUDIT-018 — Duplicate component patterns remain

- Severity/confidence/category: **LOW / High / design consistency**.
- Scope: Developers/all pages; frequent changes.
- Behavior: two FilterBars plus Pill/StatusChip/inline badges and page-owned control classes. Expected canonical patterns.
- Evidence: component inventory.
- Impact: visual/state drift; no direct task blocker.
- Recommendation: consolidate incrementally under visual tests. Medium effort/risk; design-system dependency.

### BYNK-UIUX-AUDIT-019 — `/accounts` is only a hidden compatibility redirect

- Severity/confidence/category: **LOW / High / navigation cleanup**.
- Scope: Deep links; `/accounts`; occasional.
- Behavior: built route renders a redirect client to Settings accounts but is absent from navigation. Expected documented redirect/retirement.
- Evidence: `accounts/page.tsx` and redirect client.
- Impact: extra route/analytics ambiguity; no broken task.
- Recommendation: retain documented redirect with canonical URL or retire after link telemetry. Low complexity/risk.

### BYNK-UIUX-AUDIT-020 — Production CSP breaks Next development eval/HMR

- Severity/confidence/category: **LOW / High / developer experience**.
- Scope: Local developers/auditors; all dev routes.
- Behavior: CSP omits unsafe-eval and WebSocket connect; dev browser logs React eval and HMR handshake errors. Production-mode server logs zero errors.
- Evidence: Playwright dev console; `next.config.ts` applies headers to all environments.
- Impact: slower UI iteration/false console noise, not production user impact.
- Recommendation: development-only CSP allowances/headers while preserving production policy. Low effort/risk; dev console/HMR test.

### BYNK-UIUX-AUDIT-021 — Current authenticated browser audit is unavailable

- Severity/confidence/category: **INFO / High / verification blocker**.
- Scope: Five roles and all authenticated workflows/viewports.
- Behavior/evidence: Existing synthetic QA storage exists, but read-only refresh returned Cognito HTTP 400. No customer credentials were used.
- Impact: current runtime role, dialog, responsive, console and performance states remain NOT_TESTABLE; code tracing still completed.
- Recommendation: issue a fresh synthetic tenant/session with read-only and reversible test limits. External dependency, no implementation/Figma.

### BYNK-UIUX-AUDIT-022 — Figma-ready specs produced without current authenticated frames

- Severity/confidence/category: **INFO / High / design-process limitation**.
- Scope: Founder/design/engineering; proposed redesign work.
- Behavior: Current public screens were captured, but authenticated current-state frames could not be safely rendered. Expected proposals tied to verified state.
- Recommendation: use `15-figma-redesign-brief.md` now; create the Figma file after fresh synthetic access. This prevents a disconnected concept and does not block code-only accessibility primitives.
