# BynkBook UI/UX Remediation Status

Updated: 2026-07-11  
Branch: `codex/ui-ux-remediation`

This is the execution ledger for the 26-item deduplicated audit. `Closed` means the repository change is implemented and covered by the available local checks. `Partial` means meaningful remediation landed but the full acceptance condition still needs work. `Blocked` means completion requires credentials, approved business/legal content, production migration authority, or authenticated current-state evidence that is not available locally.

| # | Finding | Status | Evidence / remaining condition |
|---:|---|---|---|
| 1 | Legal placeholders conflict with launch claims | Partial | Public copy now says private beta; legal pages are explicitly drafts. Final business-approved privacy/terms text is still required. |
| 2 | Overlay focus containment and restoration | Closed | `AppDialog` and `AppSidePanel` now use Radix modal primitives; the mobile navigation uses `AppSidePanel`. |
| 3 | Plaid freshness and balance provenance | Closed | Settings renders last successful sync; Reconcile labels bank balance/sync; Dashboard labels ledger balances. |
| 4 | Role-agnostic navigation | Closed | The active business role is visible and navigation applies the supported planning-role policy. Page-level write policies remain authoritative. |
| 5 | Competing mobile architectures | Closed | Canonical responsive routes now own home/review/issues/category/vendor UX; only receipt and invoice remain dedicated capture tools. Legacy mobile routes are context-preserving redirects. |
| 6 | Auth controls outside semantic forms | Closed | Signup, confirmation, forgot-password and reset-password use named, required semantic forms and submit buttons. |
| 7 | Primary contrast below AA | Closed | Light primary token changed to `#047857`, preserving white-text AA contrast. |
| 8 | Mobile targets below 44px | Closed | Coarse-pointer CSS enforces the 44px target floor; Playwright verifies mobile sign-in. |
| 9 | 10–11px typography | Closed | Global financial-workspace floor normalizes those utilities to 12px/16px line height. |
| 10 | Raw activity JSON | Closed | Activity details use an allowlisted, human-readable summary; identifiers/tokens/nested arbitrary data are suppressed and unit tested. |
| 11 | Unsupported numeric marketing claims | Closed | `3x`, `12h`, and `100%` claims were replaced with descriptive product states. |
| 12 | Blank Suspense fallbacks | Closed | All 16 null route fallbacks were replaced with accessible skeleton loading states or server redirects. |
| 13 | Excessive overlay density | Partial | Shared behavior and mobile navigation are consolidated; workflow-by-workflow conversion from modal to inline/panel still needs authenticated usability validation. |
| 14 | Monolithic page clients | Partial | Shared lazy-dialog code and duplicate mobile clients were extracted/removed. Ledger, Reconcile, Settings, Category Review and Vendor Detail still need staged domain decomposition after authenticated coverage is restored. |
| 15 | Missing UI/E2E/accessibility coverage | Partial | Unit suite grew from 7 to 16 tests; 10 desktop/mobile Playwright cases added (9 pass, one intentional desktop skip). Authenticated role/workflow coverage remains blocked by the expired synthetic session. |
| 16 | Skip navigation and async announcements | Closed | Global skip link, accessible route status, auth alerts/statuses, financial sync, bulk-action and settings announcements were added. |
| 17 | Orphan developer-dialog client | Closed | Removed. |
| 18 | Duplicate component patterns | Partial | Unused FilterBar removed and lazy dialogs consolidated. Broader badge/pill visual consolidation remains appropriate during page decomposition. |
| 19 | Hidden `/accounts` client redirect | Closed | Replaced with a documented server compatibility redirect that preserves business context. |
| 20 | CSP breaks development HMR | Closed | Development alone receives eval/WebSocket allowances; production policy remains strict. |
| 21 | Synthetic authenticated browser session | Blocked | Requires a fresh non-customer Cognito test identity/session. |
| 22 | Authenticated Figma current-state frames | Blocked | Requires item 21; five Figma-ready concepts remain in the audit brief. |
| 23 | SNS subscribers/test delivery and WAF decision | Blocked | Requires approved recipients, AWS access and an owner decision. |
| 24 | Dev-named live AWS dependency migration | Blocked | Requires a dedicated staged production project and migration window. |
| 25 | Authenticated SST diff | Blocked | Required AWS profile is not installed in this environment. |
| 26 | Historical `BankMatch` migration | Blocked | Requires production row counts, reversible migration approval and verified AWS/database access. |

## Local verification

- TypeScript: pass
- ESLint: pass
- Vitest: 4 files, 16 tests pass
- Playwright: 10 desktop/mobile cases; 9 pass and the desktop-only coarse-pointer case is intentionally skipped
- Application build: pass (33 routes)
- Production/AWS mutations: none

## Release gate

BynkBook must remain private beta until final legal copy is approved. Authenticated workflow validation and the external AWS/migration items must be completed before this ledger can truthfully be marked fully closed.
