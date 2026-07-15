# Validation results

| Command/check | Exit | Result | Warning/limitation |
|---|---:|---|---|
| `git fetch origin --prune` | 0 | Latest `origin/main` fetched | Audit target `df8b0f9` |
| `aws sts get-caller-identity --profile ledrigo-dev --query Account --output text` | 1 | Stopped AWS inspection | Profile not found; account not verified |
| `npm install` (frontend) | 0 | 842 packages installed; 0 vulnerabilities | Node modules not committed |
| `npm run lint` | 0 | Pass | None |
| `npm test` | 0 | 12 files, 52 tests pass | None |
| `npm run build` | 0 | Next.js production build and TypeScript pass; 34 routes generated | Uses `.env.production`; no deploy |
| `npm run test:e2e` sandbox run | 1 | Could not start | Sandbox denied temporary `.next`/results writes |
| `npm run test:e2e` approved rerun | 1 | 7 pass, 1 skipped, 2 fail | Protected route module throws because local `NEXT_PUBLIC_API_URL` is missing; public mobile checks pass |
| Production public viewport matrix | n/a | All seven portrait widths had no horizontal page overflow | Public pages only; no authenticated session |
| Production login 320x568 | n/a | Visible labels; 16px inputs; 44px controls; no horizontal overflow | Virtual keyboard not exposed |
| Protected production routes | n/a | Auth guard redirected to login with `next` path | Protected content not inspected live |
| Static table/dialog inventory | n/a | 20+ financial table surfaces; 52+ dialogs; two mobile shells | Source at audited commit |
| Figma file/library discovery | n/a | Material 3/SDS inspected; no Code Connect/existing screens; local Bynkbook system selected | Code Connect N/A on audit-only branch |
| Figma foundations | n/a | 4 collections, 42 variables, 6 text styles, 2 effect styles; zero invalid scopes/code syntax | Inter is the Figma-only `system-ui` proxy |
| Figma page coverage | n/a | 20/20 requested pages populated; 0 blank pages; all returned final renders | Wide multi-frame page exports can show compositor tiles; isolated frames are clean |
| Figma component QA | n/a | Navigation/button/status/record components have no invalid text boxes, undersized interactive masters, or unbound solid paints | Status badges are informational, not standalone targets |
| Figma prototype QA | n/a | 4 Reconcile frames; 4 click reactions; every destination resolves; Inter-only text; 0 invalid text boxes | Concept prototype; no backend calls |

Skipped: authenticated accessibility automation, visual regression, protected console checks, performance traces, offline injection, role matrix, real keyboard, OS text scaling, browser zoom, landscape runtime, and large synthetic protected datasets. These are recorded as mandatory implementation-phase checks, not passes.
