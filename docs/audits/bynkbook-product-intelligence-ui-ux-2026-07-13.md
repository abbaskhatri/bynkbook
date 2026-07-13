# BynkBook product intelligence and UI/UX audit — 2026-07-13

## Outcome

The production application was audited across 57 routes at desktop, tablet, and mobile sizes. The run returned no persistent loading states, console-error candidates, API failures, or horizontal-overflow candidates. The material remaining problem was not broken responsiveness; it was interaction density and fragmented financial review work.

Measured examples from the authenticated production audit:

- Mobile Ledger exposed 267 buttons and 115 inputs.
- Mobile Reconcile exposed 169 buttons and 62 inputs.
- Mobile Category Review exposed 205 inputs.

Those screens remain available for detailed work, but the upgrade introduces a progressive-disclosure Operations hub so the owner can understand the books before opening a large editable table.

## Implemented product improvements

### Financial Operations hub

The new `/operations` route provides:

- independent health for every ledger's bank connection;
- its own sync freshness, connection error, pending count, unmatched count, ledger balance, bank balance, and difference;
- month-end close readiness across open issues, uncategorized entries, unmatched bank activity, pending bank activity, and unhealthy connected feeds;
- a transparent 13-week cash forecast;
- category-learning quality and user-feedback metrics;
- suggested equal-and-opposite inter-account transfer pairs;
- explicit review and confirmation before a transfer and its bank matches are created.

Dashboard navigation now links directly into Financial Operations.

### Categorization Intelligence 2.0

- Plaid merchant name, original description, payment channel, and personal-finance category context now reach the existing suggestion engine without exposing the full raw Plaid object.
- The bank-transaction create-entry flow uses the richer merchant context for trusted deterministic categorization.
- Category Review automatically loads deterministic suggestions for visible rows without incurring AI usage.
- AI fallback remains an explicit user action.
- Protected classes—including payroll, taxes, transfers, loans, Zelle, ACH, and owner activity—remain review-first.

### Transfer pairing

- Candidates require equal-and-opposite posted transactions on different ledgers within three days.
- Pending, removed, or already matched rows are excluded.
- No ledger entry is created until the user confirms the pair.
- Confirmation creates two linked `TRANSFER` entries and two active bank matches in one database transaction.
- A PostgreSQL transaction-scoped advisory lock and an in-transaction match recheck prevent two simultaneous confirmations from creating a duplicate pair.
- Closed-period and authorization checks apply to both transfer sides.

### Pending transaction center

- Pending counts are visible in the Operations summary and on each bank account.
- Reconcile remains the detailed pending review surface.
- A user may create an unmatched Expected ledger entry only after acknowledging that the pending bank transaction can change or disappear.
- Pending activity cannot be matched until Plaid reports it as posted.

### Optional instant refresh

The existing sync action already requests Plaid Transactions Refresh when the Plaid product is enabled. If Plaid has not enabled the add-on, BynkBook falls back to Plaid's scheduled data and does not falsely report that an instant refresh occurred.

### 13-week cash forecast

- Starting cash and projected activity are limited to checking, savings, and cash ledgers.
- Credit-card ledgers, transfers, and one-off activity are excluded.
- A recurring pattern needs at least three observations and a stable 5–45 day cadence.
- The methodology is shown beside the forecast; this is an operating estimate, not a guaranteed bank balance.

### Owner portfolio view

The Operations bank-health section is the portfolio view: every ledger remains separate while the owner sees its connection state, balances, pending/unmatched workload, and reconciliation difference in one place.

## UI/UX decisions

1. Lead with status and exceptions, then drill into editable tables.
2. Keep bank connections independent per ledger; a deliberately manual ledger is not a failed connection and does not block close.
3. Use responsive cards on mobile instead of forcing the full desktop accounting table into the first viewport.
4. Keep destructive and financially consequential actions confirmation-gated.
5. Preserve existing BynkBook tokens, typography, state colors, and card geometry.

## Protected Ledger behavior

The Ledger new-entry row is intentionally unchanged. This upgrade does not alter its information architecture, field order, keyboard behavior, validation, transaction semantics, or visual style. New product intelligence is isolated in the Operations route and in suggestion context passed to existing workflows.

## Figma artifact

The editable design direction is in the existing BynkBook file:

- [BynkBook V2 design file](https://www.figma.com/design/GPw4EW6K54RFmpVR3ysF2J)
- `V2 / Financial Operations / Desktop`
- `V2 / Financial Operations / Mobile`
- `V2 / Product Intelligence Audit Notes`

The screens reuse the local BynkBook V2 color, spacing, radius, type, and surface-shadow definitions. The audit notes explicitly mark the Ledger quick-entry row as protected.

## Validation requirements

- Backend typecheck and focused unit tests for health classification, transfer date distance, and recurring forecast behavior.
- Frontend TypeScript, ESLint, and production build.
- Authenticated desktop/tablet/mobile route smoke tests.
- Financial mutation smoke tests limited to isolated fixtures, followed by fixture cleanup.
- Post-deploy verification of Operations, Ledger, Reconcile, Category Review, and Dashboard.
