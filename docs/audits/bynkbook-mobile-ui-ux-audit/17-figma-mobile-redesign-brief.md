# Figma mobile redesign brief

Target: [Bynkbook Mobile UX and Entry Redesign](https://www.figma.com/design/s6HSWVI2JiWF3K4sp4WYC9) (`s6HSWVI2JiWF3K4sp4WYC9`).

## Completion record

All 20 required pages are populated. The file provides representative concept screens for each audited area, reusable component masters, responsive edge cases, and a clickable four-step Reconcile flow. The broader state/flow matrix below remains the implementation-phase design and QA backlog; items not represented as standalone frames are specified in the audit documents rather than implied as production-ready UI.

## Required pages

`00 Audit Overview`, `01 Current Mobile Experience`, `02 Mobile Information Architecture`, `03 Mobile Design Foundations`, `04 Navigation`, `05 Entry and Record Patterns`, `06 Accounts and Plaid`, `07 Transactions`, `08 Reconciliation`, `09 Ledger`, `10 Invoices and Payments`, `11 Customers and Vendors`, `12 Forms`, `13 Dialogs and Bottom Sheets`, `14 Dashboard`, `15 Empty Loading Error Success`, `16 Accessibility`, `17 Responsive Edge Cases`, `18 Interactive Prototypes`, `19 Developer Handoff`.

`11 Customers and Vendors` must document that Customers are not a current repository entity/route. Create Vendor screens only; reserve a clearly labeled future/unknown section rather than inventing customer behavior.

## Foundations/components

Create the token and component families in `16-mobile-design-system-specification.md`, including local Bynkbook variables with explicit scopes/code syntax, text/effect styles, documentation frames, component variants/properties, and validation screenshots. Material/SDS library assets were inspected but are not API/visual matches; local components are required.

## Screen matrix

| Area | Required screens | Required non-ideal states |
|---|---|---|
| Auth/onboarding | Login reference, signup, create business | Error, loading, keyboard, long name |
| Dashboard | Attention-first home | Healthy, urgent, loading, partial error, empty, stale |
| Accounts/Plaid | Account list/detail, connect entry, selection, map/link existing, sync, reconnect | Multi-account, delayed, login required, failed, disconnected, archived |
| Transactions | List, detail, filter/sort | Empty, loading, offline, active filters, long text, large/negative amount |
| Reconciliation | Queue, expected detail, suggestion, manual picker, partial allocation, success | No suggestions, partial, source removed, network failure, permission denied |
| Ledger | Grouped list, entry detail, create/edit | Unmatched/matched/deleted/issue, empty, selected, keyboard |
| AP/uploads | Vendor list/detail, bill detail, payment allocation, invoice upload review | Draft/open/partial/paid/voided, parse/duplicate/failure |
| Forms/overlays | Short form, complex full-screen form, sheet, confirmation | Error, disabled, pending, unsaved, keyboard |
| Settings/attention | Settings index, Accounts, notifications/attention | Restricted role, empty, error |

## Prototype flows

1. Entry list → detail → action → preserved return.
2. Reconcile queue → suggestion → linked record → confirm/reject → success → next.
3. Partial match → allocation → remaining review → confirm → updated partial state.
4. Accounts → Plaid → select → map/create → sync → success.
5. Action required → reconnect explanation → update mode → syncing → restored.
6. Transaction list → filter sheet → chips → record → preserved return.

Prototype notes must specify route/state transitions, focus destination, back behavior, persistence, and backend calls conceptually without changing backend contracts.

## Before/after frame annotation

Each major redesign pairs current redacted screenshot/source excerpt with finding IDs, current problem, retained/removed/reprioritized information, interaction change, mobile/accessibility benefit, implementation impact, backend dependency, and validation criteria.

## Handoff constraints

- 390px primary frames plus 320px edge variants.
- Auto layout and token bindings; no flat one-off repeated rows.
- All reusable rows/buttons/statuses are instances.
- Text uses Inter as the renderer-verified Figma proxy for the product's `system-ui` stack; this is a design-file decision only.
- No customer or production financial data; synthetic names/amounts only.
