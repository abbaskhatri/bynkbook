# Full Deduplicated Remediation List

This is the combined list requested by the founder: unresolved findings from the complete-system audit plus new Plaid/account/reconciliation findings. It preserves original IDs. BYNK-PLAID-AUDIT-013 expands BYNK-AUDIT-007 and is listed as one combined remediation item, not counted twice.

## Open — High (8)

1. **BYNK-AUDIT-002** — Production legal/privacy content contains placeholders.
2. **BYNK-AUDIT-004** — Backend dependency advisories remain.
3. **BYNK-AUDIT-005** — Supplied/operational material references a stale production API hostname.
4. **BYNK-PLAID-AUDIT-001** — Opening application trusts client-supplied amount.
5. **BYNK-PLAID-AUDIT-002** — Opening-date change can orphan active match links.
6. **BYNK-PLAID-AUDIT-003** — Credit-card balance sign is not normalized.
7. **BYNK-PLAID-AUDIT-004** — Active match exclusivity is not database-enforced.
8. **BYNK-PLAID-AUDIT-005** — Reconnect repair permits incompatible account remapping.

## Open — Medium (15)

1. **BYNK-AUDIT-006** — Role policies are not dependable across backend paths.
2. **BYNK-AUDIT-007 + BYNK-PLAID-AUDIT-013** — Write/Plaid financial handlers permit membership/view-level mutation instead of dependable write policy.
3. **BYNK-AUDIT-008** — Accounts-payable uniqueness/integrity is incomplete.
4. **BYNK-AUDIT-009** — CSV export formula injection is possible.
5. **BYNK-AUDIT-010** — Recommended browser security headers are missing/incomplete.
6. **BYNK-AUDIT-011** — Environment/template values contain placeholders.
7. **BYNK-AUDIT-012** — Operational controls/runbooks/monitoring are incomplete.
8. **BYNK-AUDIT-014** — Production resources retain dev-oriented names.
9. **BYNK-PLAID-AUDIT-006** — Webhook sets a flag but does not trigger durable sync.
10. **BYNK-PLAID-AUDIT-007** — Capped sync clears update flag without automatic continuation.
11. **BYNK-PLAID-AUDIT-008** — Historical cutoff can preserve transaction gaps.
12. **BYNK-PLAID-AUDIT-009** — Disconnect does not remove the final Plaid Item.
13. **BYNK-PLAID-AUDIT-010** — Multi-account creation is not atomic.
14. **BYNK-PLAID-AUDIT-011** — Replacement heuristic can transfer durable identity incorrectly.
15. **BYNK-PLAID-AUDIT-012** — New-account route can report sync success on nested error.

## Open — Low (7)

1. **BYNK-AUDIT-015** — Named business/demo data remains in repository or UX fixtures.
2. **BYNK-AUDIT-016** — Some touch targets are below the desired accessible size.
3. **BYNK-AUDIT-017** — Handler shims/legacy structure remain.
4. **BYNK-AUDIT-018** — Development-oriented dialogs remain in production UX paths.
5. **BYNK-AUDIT-019** — Large monolithic frontend pages increase change risk.
6. **BYNK-PLAID-AUDIT-014** — Matched Plaid removals lack a separate source-removal state.
7. **BYNK-PLAID-AUDIT-015** — Auto-reconcile considers only the first 250 expected entries.

## Open — Informational / verification debt (4)

1. **BYNK-AUDIT-020** — No frontend automated test suite.
2. **BYNK-AUDIT-021** — Authenticated production workflows remain untested.
3. **BYNK-AUDIT-022** — A dependable SST synth/build-equivalent verification remains unavailable/documented incorrectly; current SST has no `build` command.
4. **BYNK-PLAID-AUDIT-016** — Legacy partial matching and current full-match groups coexist without a declared migration rule.

Open deduplicated total: **34** (8 High, 15 Medium, 7 Low, 4 Informational).

## Previously resolved baseline findings (3)

- **BYNK-AUDIT-001** — Vendor statement issue fixed.
- **BYNK-AUDIT-003** — Frontend dependency advisories fixed.
- **BYNK-AUDIT-013** — AWS profile/access blocker resolved for this audit.

Source baseline: `docs/audits/bynkbook-complete-system-audit/03-complete-findings-register.md` and `audit-findings.json`. Plaid details: `11-complete-findings-register.md` in this folder.
