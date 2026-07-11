# Frontend UX and State Audit

## Relevant surfaces

- Settings: manual account creation, new Plaid institution/account review, multi-account selection, status, disconnect, archive.
- `PlaidConnectButton`: existing-account Link, initial sync, opening preview, Apply/Keep Manual/Cancel, update-mode reconnect, repair selection.
- Reconcile page: connection status, manual refresh, update warning, expected/unmatched/matched sections, manual match, auto-reconcile dialog, revert.
- Ledger: derives and displays matched activity and date ordering.

Loading and error states are generally explicit: buttons disable while operations run, API errors surface, reconnect-required state has an action, and opening balance requires a visible choice. Automatic match suggestions require Apply. Expected and matched lists are separated and sorted.

UX defects and gaps:

- The opening modal sends its displayed amount back as authoritative input; devtools/direct API can alter it (BYNK-PLAID-AUDIT-001).
- Repair lets the user choose any returned live account without a blocking compatibility check (BYNK-PLAID-AUDIT-005).
- Manual sync makes one API request and does not continue on `hasMore/capped` (BYNK-PLAID-AUDIT-007).
- Disconnect wording does not explain that Plaid authorization may remain active (BYNK-PLAID-AUDIT-009).
- New-account success can be reported even when the nested sync response is an error object (BYNK-PLAID-AUDIT-012).
- Auto-reconcile silently limits expected candidates to 250 (BYNK-PLAID-AUDIT-015).
- The deployed change-opening-date endpoint has no frontend caller. It is a backend exposure, not a normal UI workflow.
- No frontend automated test suite exists (existing BYNK-AUDIT-020), and no authenticated production UI flow was exercised (BYNK-AUDIT-021).

The production frontend compiled successfully with 34 routes. TypeScript and lint passed.
