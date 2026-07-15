# Mobile design system specification

## Foundations

| Token group | Specification |
|---|---|
| Base viewport | Design at 390x844; validate 320–430 portrait and landscape |
| Grid | 4px base; page margin 16px (12px at 320); 4 columns; 12px gutter |
| Spacing | 4, 8, 12, 16, 20, 24, 32, 40 |
| Safe areas | Header/top and bottom action/nav include environment insets |
| Touch targets | 44px minimum; 48px preferred primary rows/actions |
| Typography | Product resolves to `system-ui`; Figma uses renderer-verified Inter as its cross-platform proxy. Styles: Display 28/34, Heading 22/28, Title 17/22, Body 16/22, Body strong 16/22, Caption 13/18 |
| Number typography | Tabular numerals; right-aligned; no ambiguous currency |
| Radius | 6, 8, 12; full only for pills/status |
| Elevation | Prefer borders/surface contrast; one restrained sheet/menu shadow |
| Divider | 1px semantic border; never sole grouping at large text |
| Density | Compact row 72px min; contextual row 88–104px; avoid giant cards |

## Semantic color roles

Bind to existing `--bb-*` semantics: app background, surface card/soft/elevated, border/muted, text/muted/subtle, input, table/header, navigation, overlay/dialog, status default/success/warning/danger/info, amount positive/negative/neutral. Status meaning is never color-only.

## Canonical components and variants

| Family | Required variants/states |
|---|---|
| App/back header | Default, scoped account/business, action, long title, offline |
| Bottom navigation | 4/5 items; default/active/badge/disabled/safe-area |
| Search/filter/sort | Empty/filled/focused/disabled/error; chips active/removable; sheets default/loading |
| Compact entry row | Default/pressed/selected/disabled/loading; one/two/three metadata lines |
| Financial entry row | Inflow/outflow/zero; pending/posted/expected/unmatched/partial/matched/excluded/action-required |
| Summary/account card | Healthy/syncing/stale/action-required/error/disconnected/archived |
| Reconciliation row/card | Expected/bank; suggestion; partial; selected; source removed |
| Status badge | Default/success/warning/danger/info; icon/no icon |
| Amount display | Positive/negative/neutral/missing; currency code; large value |
| Metadata line | Icon/no icon; wrap/truncate; accessible full value |
| Expandable section | Collapsed/expanded/loading/error |
| Buttons | Primary/secondary/ghost/destructive; default/pressed/focus/disabled/loading |
| Icon button | 44/48; label required in accessibility; badge |
| Form controls | Text/email/password/currency/date/select/textarea; default/focus/filled/error/disabled/loading |
| Tabs/segments | 2–4 visible items; overflow becomes page/list, not clipped tab strip |
| Overlay | Simple sheet; confirmation dialog; full-screen flow; keyboard-open |
| Feedback | Toast/banner/skeleton/empty/error/success/offline/stale |
| Bottom action bar | One primary; optional secondary; safe-area; pending/disabled |

## Interaction constraints

- Whole record row is tappable; nested overflow has a separate 44px target.
- Destructive actions are never the default row tap or swipe-only action.
- Amount/status/account remain visible together before detail.
- Filter count and active chips remain visible after apply.
- Screens specify loading, empty, populated, partial error, offline/stale, permission denied, long text, high/negative amount, selected, keyboard-open, and 320px states.
