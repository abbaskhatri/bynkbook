# Unknowns, decisions, and blockers

## Confirmed blockers/limitations

| ID | Item | Impact | Resolution needed |
|---|---|---|---|
| BYNK-MOBILE-BLOCKER-001 | AWS profile `ledrigo-dev` is absent | AWS verification could not return account; all AWS inspection stopped | Install/configure the named profile, then rerun exact STS command |
| BYNK-MOBILE-BLOCKER-002 | No authenticated production test session/account | Protected runtime states/roles could not be re-audited at every viewport | Provide an approved synthetic test account/environment, never customer access |
| BYNK-MOBILE-BLOCKER-003 | Local E2E lacks `NEXT_PUBLIC_API_URL` | Two protected redirect tests fail before auth guard | Document safe local test env or provide deterministic API stub |
| BYNK-MOBILE-BLOCKER-005 | Browser cannot emulate OS text scaling/virtual keyboard/offline/roles | Several accessibility/resilience states remain unverified | Real-device/device-lab and synthetic-role validation |

## Product decisions required

1. Confirm the recommended single mobile IA and whether `Issues` is top-level or an Attention destination/badge.
2. Confirm `Activity` as the parent for Ledger and Bank transactions, while preserving the accounting distinction.
3. Confirm dedicated entry/transaction detail routes and the required return-state contract.
4. Define the canonical accounting date shown in each row when transaction, posted, expected, and effective dates differ.
5. Confirm currency scope. Repository UI is USD-centric; do not design multi-currency as supported without product/backend confirmation.
6. Confirm whether Customer management is planned. No Customer model/route exists, so the audit does not invent it.
7. Define institution-vs-account scope for each reconnect/disconnect action from actual Plaid/backend capabilities.
8. Confirm which bulk actions are allowed on mobile and which remain desktop-only.
9. Define whether automatic next-unresolved navigation is default or optional after reconciliation.
10. Define permitted use of relative dates; financial records should always retain accessible absolute dates.

## Assumptions that are not facts

- Source-visible OWNER/ADMIN/MEMBER policy hints were not runtime-validated for every route.
- Existing tracked authenticated screenshots are representative but predate `df8b0f9`; the intervening commits are primarily Plaid/dashboard/accounting fixes, not a complete mobile redesign.
- A dedicated detail route may reuse existing list payloads, but endpoint sufficiency must be checked during implementation planning.
- System sans is the rendered product font. Inter is the validated Figma-only proxy because SF Pro produced invalid text exports in the connected renderer.

## Audit decisions already locked

- No implementation, backend, deploy, AWS mutation, production record mutation, or merge.
- Preserve all accounting fields and workflow semantics.
- Use local Bynkbook Figma tokens/components because available generic libraries do not match the code/API/financial semantics.
- Use synthetic data only.
- Figma Phase 1–4 proceeded after the user reported the file was blank; all 20 pages are now populated and final renders completed.
