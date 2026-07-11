# New Deduplicated Issue List

Implementation status is tracked in [`../../remediation/bynkbook-ui-ux-remediation-status.md`](../../remediation/bynkbook-ui-ux-remediation-status.md).

## Combined status

This list carries the seven unresolved/partial items from the prior 37-finding register and adds 20 actionable UI/UX findings plus two verification/design limitations. The legal and monolith items overlap prior findings and are deduplicated below.

### Immediate/high priority

1. **BYNK-UIUX-AUDIT-001 / BYNK-AUDIT-002** — Replace placeholder legal pages and remove conflicting launch-ready claims.
2. **BYNK-UIUX-AUDIT-002** — Fix focus containment/restoration/background isolation in the shared overlay primitives.
3. **BYNK-UIUX-AUDIT-003** — Show Plaid last-success freshness and label bank versus ledger balance provenance.

### Medium priority

4. BYNK-UIUX-AUDIT-004 — Make navigation role-aware.
5. BYNK-UIUX-AUDIT-005 — Choose one mobile information architecture.
6. BYNK-UIUX-AUDIT-006 — Convert signup/confirmation/recovery controls to semantic forms.
7. BYNK-UIUX-AUDIT-007 — Correct primary token contrast.
8. BYNK-UIUX-AUDIT-008 — Raise touch hit areas to 44px.
9. BYNK-UIUX-AUDIT-009 — Normalize the micro typography floor.
10. BYNK-UIUX-AUDIT-010 — Replace raw activity JSON with redacted human summaries.
11. BYNK-UIUX-AUDIT-011 — Remove or substantiate numeric marketing claims.
12. BYNK-UIUX-AUDIT-012 — Replace 16 blank route fallbacks.
13. BYNK-UIUX-AUDIT-013 — Reduce overlay density using inline/sidepanel/dialog rules.
14. **BYNK-UIUX-AUDIT-014 / BYNK-AUDIT-019** — Decompose monolithic pages after test coverage exists.
15. BYNK-UIUX-AUDIT-015 — Add component, role, E2E, responsive and accessibility tests.
16. BYNK-UIUX-AUDIT-016 — Add skip navigation and consistent async announcements.

### Low priority cleanup

17. BYNK-UIUX-AUDIT-017 — Remove orphan dev-dialog client.
18. BYNK-UIUX-AUDIT-018 — Consolidate duplicate component patterns.
19. BYNK-UIUX-AUDIT-019 — Document/retire the `/accounts` compatibility redirect.
20. BYNK-UIUX-AUDIT-020 — Apply development-only CSP allowances for React/HMR.

### Verification/design limitations

21. **BYNK-UIUX-AUDIT-021 / BYNK-AUDIT-021** — Restore a fresh synthetic authenticated test tenant/session.
22. BYNK-UIUX-AUDIT-022 — Create Figma frames only after authenticated current-state capture is restored.

### Carried non-UI items still open or partial

23. **BYNK-AUDIT-012** — Supply approved SNS alarm topic/subscribers, test delivery, and decide WAF adoption.
24. **BYNK-AUDIT-014** — Migrate dev-named live AWS dependencies through a dedicated staged production project.
25. **BYNK-AUDIT-022** — Run authenticated `sst diff` after a verified AWS profile is provided.
26. **BYNK-PLAID-AUDIT-016** — Count and migrate historical BankMatch rows after reversible production migration approval.

Deduplicated actionable/blocked total: **26** — 3 high/immediate, 13 medium, 4 low, 2 UI verification/design limitations, and 4 carried non-UI items.
