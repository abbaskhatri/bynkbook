# Mobile remediation roadmap — no implementation

No code changes are part of this audit. Each phase below is a recommended PR boundary after Figma approval and implementation authorization.

| Phase | Findings/screens | Components | Dependencies | Risk/tests | Recommended PR boundary |
|---|---|---|---|---|---|
| 0 Emergency blockers | `001`,`002`,`004`,`005` | Financial row, detail header, full-screen flow, bottom action bar | Figma mandatory; no backend expected | High regression; synthetic accounting states; all viewports | Foundations + non-functional mobile presentation primitives only |
| 1 Navigation | `006`,`007`,`009` | App header, bottom nav, More, search/chips/sheets | Route/persistence decisions | Deep-link/back/role tests | One mobile shell and route-state contract |
| 2 Entry visibility | `002`,`005`,`010`,`017`,`018` | Entry/transaction/status/amount rows | Figma mandatory | Long text, scaling, AT | Shared record primitives + list adapters |
| 3 Reconciliation | `001`,`004`,`007`,`009` | Queue, suggestion, partial summary, candidate list | Existing matching endpoints; possible detail payload review | Highest risk; full match matrix | Reconcile list/detail, then partial/manual as separate PRs |
| 4 Ledger | `002`,`005`,`007`,`015`,`016` | Ledger list/detail/form/selection | Existing entry APIs | Closed period, delete, match, issue regression | Read-only list/detail first; edits/actions second |
| 5 Plaid/accounts | `008`,`011` | Account card, sync banner, mapping/reconnect flows | Existing Plaid/account endpoints | Multi-account/update/disconnect/archived | Read-only account states; connect; reconnect/disconnect separately |
| 6 AP/uploads | `003`,`012`,`020` | Vendor/bill/payment/file rows, allocation, review | Existing bills/uploads APIs | Allocation, void, parse, duplicate | Vendor read-only; bill/payment flows; upload review |
| 7 Forms/dialogs | `004`,`014`,`020` | Form system, confirmation, sheet | No backend | Keyboard/back/error/double submit | Migrate low-risk dialogs, then complex flows |
| 8 Dashboard/reports | `013`,`019` | Attention cards, account summary, statement rows | Existing queries | Stale/empty/partial error/charts | Dashboard ordering; report detail transformations |
| 9 Accessibility/performance | `015`–`018`,`024`,`023` | All | Synthetic auth/roles and device lab | Manual AT, 200/400%, traces, 5k rows | Dedicated hardening PRs by surface |
| 10 Lower polish | `021` | Public content | Content decision | Public e2e | Landing condensation |

## Required tests per implementation PR

Build, TypeScript, lint, unit/component tests, screenshot regression at 320/360/390/430, portrait/landscape, keyboard open, browser back, active-filter persistence, screen-reader smoke, touch-target audit, contrast, reduced motion, error/offline/stale states, role permission, and no new horizontal page overflow.

## Backend policy

Preserve the existing data model and mutation semantics. A backend change is justified only if a dedicated detail route cannot safely obtain required fields from current APIs; such a change must be a separate reviewed PR. Never hide accounting fields to avoid a backend dependency.
