# Mobile accessibility audit

Automated checks are evidence, not a compliance claim. Manual screen-reader, keyboard, zoom, contrast, and real-device testing remain required.

## Findings

| Area | Current evidence | Risk | Requirement |
|---|---|---|---|
| Touch targets | Public auth 44px; protected tokens often 28–36px plus pointer override | Hybrid/fine-pointer and form controls can remain small (`015`, `024`) | Explicit 44px mobile variants |
| Spacing | Tables/cells dense | Precision taps and accidental actions | 8px minimum between unrelated actions; one primary action |
| Accessible names | Many icon buttons have `aria-label`; titles widely used | Title/tooltip not a touch explanation (`016`) | Accessible name + visible action-sheet label |
| Headings/landmarks | Root skip link and page headers exist | Dialog/full-screen flow hierarchy varies | One h1; named sections; main/nav landmarks |
| Focus | Radix dialog traps focus | Browser back/focus return unverified | Return focus to opener or detail heading |
| Status announcements | Alerts and loading copy exist | Async financial status may not be announced consistently | Polite live regions for save/sync; assertive for blocking errors |
| Contrast | Semantic tokens exist | Exact contrast not measured in all modes/states | WCAG AA measurement for text, status, focus, charts |
| Color reliance | Most chips include text | Amount direction/status can still separate from label | Sign/icon/text plus color |
| Text scaling/zoom | Fixed tables/truncation | Loss/reflow at 200–400% (`018`) | One-dimensional reflow with all facts reachable |
| Reduced motion | Dialog animations present | Preference handling not evident | `prefers-reduced-motion` variants |
| Dialog semantics | Radix title/description used | One pattern hosts incompatible complexity | Use correct sheet/dialog/page semantics |
| Gesture alternatives | No required swipe found | Future swipe designs can exclude users | Visible action alternative mandatory |
| Charts | Recharts used | Visual-only trends/legends | Text summary and data-table alternative |
| Tables | Semantic markup | Horizontal reading order is burdensome | Semantic mobile list/detail alternative (`017`) |

## Positive evidence

- Production login has a working skip link, semantic textboxes, visible labels, 16px inputs, and 44px interactive controls at 320x568.
- Public landing had no horizontal overflow at all seven required portrait widths.
- Status chips use visible text, and destructive flows commonly include explicit explanatory copy.

## Manual test script

For each priority flow, test VoiceOver and TalkBack: traverse headings/landmarks; scan three records without changing mode; open detail; identify amount/account/status; complete or cancel an action; return to the same row. Repeat at large text and with a hardware keyboard. Any action available only by hover, swipe, drag, chart color, or spatial table position fails.
