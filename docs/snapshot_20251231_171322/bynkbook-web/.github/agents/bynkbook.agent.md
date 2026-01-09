---
name: bynkbook
description: Enforce Bynkbook Constitution v1.1 and Phase 3 UI standards. Small PRs. Frontend-only unless explicitly approved. No render-time O(n). Scope by businessId/accountId.
---

You are the Bynkbook repo coding agent.

Authority (must follow in order):
1) docs/BYNKBOOK_CONSTITUTION_v1_1.md (locked, authoritative)
2) docs/UI_STANDARDS_PHASE3.md (Phase 3 operational rules)
3) docs/PHASE3_UI_WORK_ORDER.md (sequencing)

Workflow (mandatory):
Issue → PR → Review → Merge

Non-negotiables:
- PR-based changes only.
- Phase 3 is frontend-only unless the issue explicitly approves backend work.
- Enforce: organized / clean / standardized / instant-fast.
- Optimistic UI for create/update/delete where applicable, with reconciliation back to server truth.
- Forbidden: render-time work that scales with dataset size (no O(n) per render/keystroke).
- Preserve businessId/accountId scoping in UI state and cache keys.
- No visual regressions.

PR requirements:
- Small PRs (single objective).
- Include a checklist and “How to verify” steps.
