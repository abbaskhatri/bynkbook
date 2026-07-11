# Recommended Design System

## Principles

1. Financial state is explicit, sourced and dated.
2. Consequential actions are calm, specific and reversible where possible.
3. Dense data is scannable without micro typography.
4. Backend permissions remain authoritative; UI explains available actions.
5. One responsive component model serves desktop and mobile unless capture genuinely requires a focused flow.

## Foundations

- Typography: 14px body/control, 12px metadata minimum, 16/20/24/32 headings; tabular numerals for money.
- Spacing: 4px base; prefer 8, 12, 16, 24, 32.
- Radius: 6 compact control, 10 card/dialog, pill only for statuses/toggles.
- Elevation: base, sticky, popover, overlay, toast.
- Breakpoints: mobile <640, tablet 640–1023, desktop ≥1024; test 320/390/768/1024/1440.
- Grid: 12-column desktop, 8 tablet, 4 mobile; max reading width for prose.

## Color

- Keep semantic success/warning/danger/info/amount tokens.
- Correct light primary pair to ≥4.5:1 for normal text.
- Never use color alone; pair icon/text/border.
- Charts require accessible labels/data summary and documented series colors.

## Components

- Button/IconButton: 44px touch target, 36px desktop standard, explicit busy/destructive states.
- Field: visible label, optional/required text, hint, error, name, autocomplete, `aria-describedby`, `aria-invalid`.
- DataTable: keyboard-readable header, visible sort, responsive record-card alternative, sticky actions only when needed.
- FinancialDialog: Radix focus management, source/consequence copy, busy dismissal lock, trigger restoration.
- Navigation: role-aware metadata, active state, badge count with accessible label, one mobile model.
- Status: StatusChip with a finite vocabulary and tooltip only for supplemental detail.
- AsyncState: skeleton, stale indicator, empty next action, scoped error/retry, success/live announcement.
- AccountConnectionHealth: institution/account, status, last success, pending/error, reconnect/sync, ledger-vs-bank sources.

## Accessibility rules

- Skip link and landmark IDs.
- Visible focus, logical DOM/tab order, no title-only names.
- Dialog/panel focus trap, inert background, return focus.
- Minimum AA contrast; 200/400% zoom; reduced-motion support.
- Announce async mutations without stealing focus.
- Every icon control has a programmatic name and 44px touch hit area.
