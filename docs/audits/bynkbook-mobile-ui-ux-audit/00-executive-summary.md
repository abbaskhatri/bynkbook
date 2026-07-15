# Bynkbook mobile UI/UX audit — executive summary

Audit date: 2026-07-15
Audited commit: `df8b0f9` (`origin/main`)
Branch: `audit/bynkbook-mobile-ui-ux-figma`
Status: audit and Figma concept complete; no implementation

## Outcome

Bynkbook’s public authentication experience is mobile-usable, and the protected application has good foundations: semantic status labels, a global coarse-pointer target rule, safe accounting copy, virtualization in Reconcile, keep-last-good loading behavior, and an existing mobile bottom navigation. However, the core bookkeeping product is not mobile release-ready.

The dominant defect is structural rather than cosmetic. Ledger, reconciliation, category review, AP, uploads, planning, accounts, and reports retain desktop tables from 520px to 1,260px wide. Phones show one slice at a time, so identity, amount, state, and action often cannot be evaluated together. Fifty-two-plus generic dialog instances then carry complex edit, match, Plaid, allocation, and destructive flows. This makes technically available workflows slow and risky on small screens.

Core workflows can usually be completed with horizontal scrolling and repeated dialogs, but not with the visibility and confidence expected of a professional mobile financial product. Reconciliation, ledger review, vendor AP, and account recovery are the highest-priority areas.

## Ratings

| Area | Rating | Release view |
|---|---:|---|
| Overall mobile usability | 2/5 | Major redesign required |
| Entry readability | 1/5 | Amount/status/context fragment across columns |
| Mobile navigation | 2/5 | Two conflicting navigation models |
| Transactions and reconciliation | 1/5 | Guided mobile flow absent |
| Accessibility | 2/5 | Strong auth baseline; protected dense layouts need manual AT validation |
| Mobile performance | 3/5 | Reconcile virtualization is good; monoliths and long secondary lists remain risks |
| Core workflow completion | Conditional | Possible, but high friction/risk below 430px |
| Release readiness | No | Immediate action recommended |

## Findings by severity

| Severity | Count |
|---|---:|
| CRITICAL | 0 |
| HIGH | 9 |
| MEDIUM | 11 |
| LOW | 2 |
| INFO | 3 |

The absence of a CRITICAL finding does not make the experience release-ready: HIGH findings block safe, efficient mobile use even when a workaround exists.

## Highest priorities

1. Replace the mobile Reconcile dual-table workspace with a guided unresolved queue and detail flow (`001`).
2. Replace the mobile Ledger spreadsheet with date-grouped financial rows and an entry detail route (`002`, `005`, `007`).
3. Consolidate mobile navigation into one route model (`006`).
4. Transform AP/vendor, account/Plaid, category review, and upload tables (`003`, `008`, `010`–`012`).
5. Route complex forms out of generic sheets and make all mobile targets explicitly 44px (`004`, `015`, `020`).

## Strong patterns to preserve

- Login: one semantic form, visible labels, 16px inputs, 44px controls, skip link, no horizontal overflow (`022`).
- Reconcile: list virtualization and keep-last-good refresh behavior (`023`).
- Accounting safety language: uploads saved for review; audit history preserved; destructive effects described.
- Status semantics: text labels accompany most color treatments.
- Protected route redirect works in production; public content did not reveal protected data.

## Recommended implementation order

1. Mobile foundations, navigation, and record/detail primitives.
2. Reconcile queue/detail/partial-match flow.
3. Ledger list/detail/edit and selection mode.
4. Accounts/Plaid lifecycle and sync-state model.
5. Vendor AP, uploads, category review, planning, and reports.
6. Accessibility, keyboard, performance, and device-matrix regression gate.

## Figma status

The dedicated file is populated: [Bynkbook Mobile UX and Entry Redesign](https://www.figma.com/design/s6HSWVI2JiWF3K4sp4WYC9). It contains all 20 requested pages, 42 local variables across four collections, six text styles, two effect styles, reusable navigation/button/status/financial-row components, responsive 320/390/430/landscape examples, and a four-step clickable reconciliation prototype. Every page returned a final render and no page is blank.

Figma uses Inter as the renderer-safe proxy for the product's `system-ui` stack. SF Pro was available to the editor but produced invalid black-tile text exports; the application font and code are unchanged.

## Safety and validation

- Application code changed: no.
- Production data changed: no.
- AWS resources changed: no.
- Deployments: none.
- Required AWS profile: unavailable; inspection stopped before resource access.
- Frontend: build pass, lint pass, 52/52 unit tests pass.
- Playwright public suite: 7 pass, 1 skipped, 2 blocked by missing local `NEXT_PUBLIC_API_URL`.
