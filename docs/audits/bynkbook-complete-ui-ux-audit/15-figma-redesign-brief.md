# Figma Redesign Brief

No Figma file was created because current authenticated frames could not be safely rendered. These five concepts are ready for a dedicated file once synthetic access is restored.

## Concept 1 — Role-aware application navigation

- Findings: 004,005; roles: all.
- Objective: one responsive IA with clear daily work, payables, reports and role-aware administration.
- Required states: desktop expanded/collapsed, mobile bottom tabs/More, no account, no permission, badge/loading, keyboard focus.
- Constraints: backend remains authoritative; preserve business/account URL scope and deep links.

## Concept 2 — Canonical financial dialog and side panel

- Findings: 002,006,013,016.
- Objective: safe focused editing/confirmation with source, consequence and recovery.
- States: default, destructive, warning, validation error, server error, busy, success, unsaved, mobile bottom-sheet.
- Accessibility: labelled title/description, initial/return focus, focus trap, inert background, Escape rules, live success.
- Constraints: reusable across 51 instances; no business-rule changes.

## Concept 3 — Account and Plaid connection health

- Findings: 003.
- Objective: separate connection freshness, bank state and ledger balance concepts.
- Content/data: institution, masked account, connection state, last successful sync, pending drain, error/reconnect, ledger balance/as-of, optional bank current/available with source.
- States: never connected, connecting, syncing, healthy, stale, update required, error, disconnected, archived, source-removed warning.

## Concept 4 — Reconciliation command hierarchy

- Findings: 002,003,009,013,014.
- Objective: keep bank and ledger context visible while reducing overlay dependence.
- Desktop: persistent scope/freshness header, two-pane queues, inline suggestion preview, audit side panel.
- Mobile/tablet: stacked queues with explicit current side and task drawer.
- States: empty, loading, pending, candidate, matched, source removed, error, closed period, read-only.
- Constraints: MatchGroup full-match model, pagination/virtualization, no false optimistic completion.

## Concept 5 — Unified mobile operations

- Findings: 005,008,012.
- Objective: reconcile the responsive full app with focused receipt/invoice capture.
- Navigation: Home, Ledger, Reconcile/Review, Issues, More; capture available as prominent contextual action.
- Required states: safe area, offline/error, no account, read-only, large text, 320px width, keyboard/tablet.

## File structure when created

Use the 13-page structure requested in the audit brief. Include before/after annotations, finding IDs, responsive variants, component dependencies and implementation notes. Do not call frames implementation-ready until all states above are represented and validated against a fresh synthetic tenant.
