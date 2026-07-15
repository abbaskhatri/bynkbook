# Screenshot and Figma index

## Repository evidence

| Evidence ID | Path/link | Viewport | Content | Related findings |
|---|---|---:|---|---|
| BYNK-MOBILE-EVIDENCE-001 | `evidence/prod-login-320x568.png` | 320x568 | Production login; no entered credentials | `022` |
| BYNK-MOBILE-EVIDENCE-002 | `evidence/prod-landing-390x844.png` | 390x844 | Production public landing | `021` |
| BYNK-MOBILE-EVIDENCE-003 | `output/playwright/re-audit-2026-07-11/reconcile-mobile.png` | phone portrait | Redacted/synthetic authenticated Reconcile | `001`,`009` |
| BYNK-MOBILE-EVIDENCE-004 | `output/playwright/re-audit-2026-07-11/reconcile-tablet.png` | tablet | Redacted/synthetic Reconcile | `001` |
| BYNK-MOBILE-EVIDENCE-005 | `output/playwright/re-audit-2026-07-11/reconcile-runtime-audit.json` | multi | Prior safe runtime audit data | `001`,`023` |
| BYNK-MOBILE-EVIDENCE-006 | `mobile-ui-ux-audit-findings.json` | n/a | Machine-readable findings | all |

## Figma

File: [Bynkbook Mobile UX and Entry Redesign](https://www.figma.com/design/s6HSWVI2JiWF3K4sp4WYC9)
File key: `s6HSWVI2JiWF3K4sp4WYC9`

The file contains the complete 20-page audit structure from `00 Audit Overview` through `19 Developer Handoff`; no page is blank. It includes four token collections (42 variables), six text styles, two effect styles, reusable navigation/button/status/financial-row component families, 320/390/430/landscape layouts, and four clickable Reconcile prototype frames.

Final page-level renders succeeded for all 20 pages. Isolated screen validation was used for visual sign-off because Figma's wide multi-frame page compositor intermittently produced black tiles; isolated frames rendered correctly. Verified examples include `08 Reconciliation / Queue` (390x844) and `18 Interactive Prototypes / Reconcile queue` (320x568).

Typography decision: Inter is the validated Figma proxy for the codebase's `system-ui` stack. SF Pro was rejected after screenshot exports rasterized its text as black blocks.

## Redaction policy

All new images show public pages only. Existing authenticated evidence uses the repository’s named QA test business and synthetic amounts. No credential, token, customer document, real bank identity, or production financial record is included.
