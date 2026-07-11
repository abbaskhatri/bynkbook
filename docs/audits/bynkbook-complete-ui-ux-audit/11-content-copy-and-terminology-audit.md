# Content, Copy, and Terminology Audit

## High-impact copy conflicts

- Landing says “Launch-ready bookkeeping controls” and “Ready for real books.”
- Privacy and Terms explicitly say to replace placeholder copy before launch.
- Landing claims `3x` “fewer clicks” and `100%` “Audit trail” without a visible baseline, methodology or qualification.

Recommended interim copy: “Bookkeeping controls for reconciliation and month-end work” and remove numeric claims until supported.

## Financial terminology

- “Expected,” “Matched,” “Match found,” “No ledger entry,” “Adjustment,” “Source removed,” and “Opening balance estimate” are real concepts but need a reusable glossary/inline explanation.
- “Cash Balance” should become “Ledger cash balance” when ledger/report-derived.
- “Connected” should become “Connected · last synced [time]” or “Connected · sync pending.”
- “Review,” “Category Review,” “Issues,” and “Uncategorized” need one queue taxonomy.

## Developer-facing content

Settings Activity humanizes event names but expands raw `payload_json` in a `<pre>`. Replace with an allowlisted human summary and reserve redacted technical detail for privileged support tooling.

## Strong copy to preserve

- “Opening fields can only be edited before any related data exists.”
- Closed-period consequences.
- Plaid opening estimate explanations.
- “Suggestion-only” AI label.
- Scoped retry/error messages that distinguish unavailable cards from unaffected pages.
