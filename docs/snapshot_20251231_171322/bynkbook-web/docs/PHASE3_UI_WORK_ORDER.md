# Phase 3 UI Work Order (Manual GitOps Mode)

This is the Phase 3 UI sequencing plan. One objective per PR/commit. No backend changes unless explicitly approved.

## Work Order
1) UI Primitives Registry + Tokens (structure first)
2) LedgerTableShell standardization (layout + column discipline)
3) Ledger mutations UX contract (create/update/delete/merge optimistic + reconcile)
4) Issues UI contract (deterministic + async scan + progress)
5) ActiveAccountPill behavior + scope-safe switching
6) Reconcile page table parity using LedgerTableShell

## Required discipline
- Additive changes first; migrate page-by-page.
- No “cleanup” refactors unless required for correctness/performance.
- Any exception must be explicitly justified with follow-up plan.
