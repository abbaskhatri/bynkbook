# Financial, Plaid, and Reconciliation UX Audit

## Account and Plaid connection

The frontend supports manual accounts, new Plaid accounts, linking an existing account, update/reconnect, repair/switch, disconnect, archive, opening review, pending sync and sync errors. Four Plaid dialogs communicate opening-balance consequences and preserve manual activity.

The API account contract contains `last_sync_at`, `has_new_transactions`, status and errors. Static search proves `last_sync_at` is not rendered. Reconcile reduces state to Connected / Needs attention / Not connected. Users therefore cannot answer “when did this account last finish syncing?”

## Balance concepts

- Settings: manual opening balance/date.
- Plaid opening review: “Bank balance now” and estimated opening balance.
- Ledger: chronological running balance, hidden when filters make it misleading.
- Dashboard/reports: account/cash balance as of a selected date.

The ledger’s decision to hide noncontiguous running balance is strong. Dashboard/account cards need equally explicit source labels such as “Ledger balance · as of …” and Plaid connection cards should separately show “Bank sync · last successful …”.

## Reconciliation

Strengths:

- Separate expected and bank sides, explicit pending states, match suggestions, full-match groups, reversal/audit history, closed-period protection and disabled-action reasons.
- Virtualization for large lists, server pagination and bounded auto-reconcile work.
- Source-removed matched transactions remain visible with a warning.

Risks:

- Twelve reconcile overlays and a 7,556-line client make the command hierarchy hard to learn and risky to change.
- “Expected,” “Match found,” “No ledger entry,” “Matched,” and audit/revert actions need one persistent legend/help model.
- Sync freshness is missing.
- Legacy BankMatch history remains readable while new writes use MatchGroup; UI should label legacy historical records if their presentation differs.

## Recommended financial health card

Show institution, local account, connection state, last successful sync, pending drain, source-removal warnings, reconnect action, ledger balance source/as-of and a plain-language explanation of what Sync changes. Never merge bank balance and ledger balance into one unlabeled number.
