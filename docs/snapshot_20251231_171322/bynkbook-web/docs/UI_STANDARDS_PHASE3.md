# Phase 3 UI Standards — Operationally Binding (Manual GitOps Mode)

This document is binding for Phase 3 UI work and must be referenced in every Phase 3 UI change.
It derives from Bynkbook Constitution v1.1 (authoritative) and adds strict UI implementation rules.

If a change deviates from these standards, it must be explicitly justified in the PR description
(or commit message in Manual GitOps Mode) with risk and follow-up to remove the exception.

---
## Ledger Table Non-Negotiables (Pixel-perfect)

- Use a <colgroup> with fixed widths so header + add-row + body align exactly.
- Default widths:
  - checkbox 32
  - date 110
  - ref 90
  - payee min 240 (flex)
  - type 150
  - method 150
  - category 180
  - amount 130 (right aligned)
  - balance 130 (right aligned)
  - status 110
  - actions 110
- All inputs + SelectTriggers must share the exact same height and focus style.
- h-7 is the standard height.
- No cell text clipping. Use truncation on text cells.
- No horizontal scroll in normal desktop widths.

## 1) Canonical UI Primitives (Must Not Be Duplicated)
The following primitives are canonical. New UI must use them. “Near-duplicate” variants are forbidden:

- PageHeader
- ActiveAccountPill
- FilterBar
- LedgerTableShell
- StatusChip
- AppDialog
- AppSidePanel

Rule: If you need a variant, extend the canonical primitive. Do not create a parallel implementation.

---

## 2) Optimistic UI Scope (Clarification)
Optimistic UI applies to user-visible mutations by default, not just clicks.

Required for (default):
- Create mutations
- Update mutations
- Delete mutations
- Merge / match / unmatch actions
- “Mark resolved” / “close entry” type actions

Minimum behavior:
- UI updates immediately (<100ms feedback).
- On failure: rollback or reconcile to server truth with an actionable error.
- On success: reconcile to server-confirmed state.

Exceptions:
- Allowed only with explicit justification + a UX pattern that still shows immediate feedback and progress.

---

## 3) No Local State Shadowing Server Truth (Mandatory Rule)
Optimistic UI is allowed and required, but local state must never permanently diverge from server truth.

Allowed local state:
- Draft form inputs
- Transient UI state (open/closed, focus, sort UI selection)
- Pending mutation state (temporary optimistic projection)

Forbidden:
- Maintaining a separate “authoritative ledger list” in local component state that can diverge long-term.
- “Fixing” inconsistencies by preserving local state when server data disagrees.

Required:
- Every optimistic projection must reconcile back to server truth.
- Cache invalidation / reconciliation must be scope-aware (businessId + accountId).

---

## 4) Render-Time Complexity Prohibition (Reinforced)
Render-time O(n) work that scales with dataset size is forbidden, including:
- Sorting full datasets in render
- Filtering/grouping/deduping in render
- Issue detection across all rows in render
- Running balance recomputation across all rows in render
- Per-keystroke O(n) transforms on large lists

Allowed patterns:
- Server-provided computed fields (preferred)
- Incremental updates (mutation-driven)
- Memoized selectors with stable dependencies (bounded)
- Virtualized rendering with stable row models

Any bounded O(n) claim must document the bound and why it is safe.

---

## 5) Ledger UI Contract (Phase 3 Summary)
Ledger must uphold:
- Deterministic ordering: entryDate desc → createdAt desc → deterministic tie-breaker
- Instant mutation UX: new items appear immediately in correct position
- Issues update immediately (optimistic + reconcile)
- Async scans show progress and never block the UI

---

## 6) Phase 3 PR/Commit Checklist
Every Phase 3 UI PR/commit must state:
- Which primitives were used/extended
- How optimistic UI + reconciliation was handled for touched mutations
- Confirmation: no render-time O(n) introduced
- Confirmation: businessId/accountId scoping preserved in UI state and cache keys
- Preview verification steps (when preview exists); otherwise local verification steps
