# Component and Design-System Audit

## Inventory

- 52 files under `src/components`, 111 TSX files overall.
- 397 button invocations and 163 input/select/textarea invocations.
- Core UI: Button, Card, Input, Label, Select, Skeleton, Table, Tooltip.
- App primitives: AppDialog, AppSidePanel, AppActionMenu, AppDatePicker, BusyButton, DialogFooter, HintWrap, PillToggle, StatusChip.
- Domain components: ledger shell/inputs/totals/dialogs, Plaid connect, uploads, reconciliation cards/dialog, dashboard charts, mobile cards/shell.

## Strengths

- A meaningful semantic token layer covers application, surface, text, border, input, table, navigation, status, amounts and charts in light/dark modes.
- Financial positive/negative/warning/danger colors are named semantically.
- Radix Select/Dialog dependencies and custom focus-ring tokens provide a reasonable base.
- Heavy charts, Plaid, upload and dialog surfaces are dynamically loaded.

## Confirmed inconsistencies

- Both `components/app/filter-bar.tsx` and `components/primitives/FilterBar.tsx` solve the same pattern.
- `Pill`, `StatusChip`, inline badges and page-specific status spans overlap.
- Page-specific input/button height constants coexist with canonical UI primitives.
- 113 hardcoded hex occurrences remain across TSX/TS/CSS; many are legitimate root tokens, but auth/marketing pages also bypass Bynkbook semantic tokens.
- Six arbitrary z-index utilities and a tooltip at `z-[10000]` indicate an undocumented elevation scale.
- 471 occurrences of `text-[10px]` or `text-[11px]` make micro typography a dominant visual pattern.
- Primary foreground on light primary is 3.77:1 for normal 14px text, below 4.5:1.

## Proposed canonical component set

1. Button (44px touch default, 36px compact desktop, explicit destructive/loading variants)
2. IconButton (accessible name required; touch hit-area wrapper)
3. Field / FieldGroup (label, hint, error, required/optional, `aria-describedby`)
4. CurrencyField
5. DateField
6. SearchField
7. FilterBar
8. StatusChip
9. DataTable / ResponsiveRecordList
10. FinancialDialog / ConfirmationDialog
11. SidePanel
12. AsyncState (loading, stale, empty, error, success, `aria-live`)
13. AccountConnectionHealth
14. PageHeader / CommandBar
15. EmptyState / InlineBanner

## Token normalization

- Base spacing: 4px scale, with 8/12/16/24/32 as default composition steps.
- Interactive heights: 44px touch, 36px standard desktop, 32px only inside dense non-touch tables with an expanded hit area.
- Type floor: 12px for secondary metadata, 14px for controls/body; reserve 10–11px for nonessential uppercase labels only after contrast review.
- Elevation: base, sticky, popover, overlay, toast; no page-owned arbitrary z-index.
- Colors: adjust light primary or primary foreground to reach 4.5:1; document chart exceptions separately.
