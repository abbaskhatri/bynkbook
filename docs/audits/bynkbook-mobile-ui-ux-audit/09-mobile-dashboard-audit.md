# Mobile dashboard audit

## Mobile decision order

1. Urgent attention: unresolved reconciliation, account action required, period-close blockers.
2. Available balances with explicit bank/ledger source and freshness.
3. Overdue/upcoming AP and expected entries.
4. Recent business activity.
5. Quick actions.
6. Optional trends/AI below core operational content.

## Current risks

- The 1,894-line route combines charts, metrics, onboarding, activity, attention, and AI; responsive wrapping alone cannot establish task priority.
- Multiple cards can produce long vertical scanning before a user reaches the next action.
- Chart labels and multi-series legends require accessible text alternatives at 320px.
- Account and balance metrics must not imply real-time freshness while sync is delayed.

## Recommended structure

| Section | Content | Mobile behavior |
|---|---|---|
| Today | Counted attention items with reason and CTA | Max three; `View all` to Attention |
| Cash position | Account cards with bank/ledger balance and `as of` | Horizontal paging is avoided; vertical compact list |
| Upcoming | Overdue/next seven days bills/expected entries | Date-grouped rows |
| Reconciliation | Unmatched/partial/expected counters | Opens filtered queue |
| Recent activity | Five timeline rows | Opens Activity |
| Quick actions | Receipt, upload invoice, manual entry, vendor | Contextual action sheet |
| Trends | One prioritized chart with text summary | Lazy-load; accessible table/summary |

## State requirements

Healthy, urgent, loading, partial error, empty/new business, stale balance, offline, restricted permission, many accounts, long business name, and high/negative amounts. Keep last-known values during refresh and label them `as of` rather than replacing them with skeletons.

## Preserve

Keep onboarding guidance for genuinely new businesses, keep attention summary queries, keep last-good period data, and keep clear accounting language. Reorder and consolidate; do not drop material obligations.
