# Mobile Plaid and account flow audit

## Existing product scope

Repository-backed concepts: local Account, BankConnection, Plaid-connected source account, multi-account selection/update, sync freshness, reconnect/update mode, archive, disconnect, opening balance, cash-book restrictions, and account-specific reconciliation. No new institution behavior is proposed.

## Current findings

- Account administration is an 1180px table with actions at the far edge (`011`).
- `PlaidConnectButton` contains four generic dialogs for related lifecycle decisions (`008`).
- The code distinguishes cash books, local accounts, Plaid accounts, institution identity, and connection state, but mobile presentation does not provide one consistent lifecycle model.
- Strong existing safety: cash accounts cannot connect to a bank; disconnect/reconnect copy exists; institution and last4 fields are available; raw connection state is normalized in operations models.

## Required state model

| State | User label | Visible facts | Primary action |
|---|---|---|---|
| Connected | Up to date | Institution, account, last sync | View activity |
| Syncing | Syncing | Last known balance + start time | None/refresh disabled |
| Delayed | Delayed | Last success + plain explanation | Try refresh |
| Action required | Reconnect required | Institution/account + why | Reconnect |
| Login required | Sign in to bank again | Institution/account | Reconnect |
| Reconnecting | Reconnecting | Progress + last known data | Cancel only if safe |
| Failed | Couldn’t sync | Plain-language cause, last success | Retry/contact support path |
| Disconnected | Bank disconnected | Ledger data preserved | Connect again |
| Archived | Archived | Read-only history | Unarchive by permission |
| Not connected | Manual account | Ledger balance; no bank freshness | Connect bank if eligible |

## Action taxonomy

- **Connect new bank**: starts a new institution connection.
- **Connect another account**: adds another source account from an existing/new item as supported.
- **Link to existing local account**: maps a selected source account to a local Account; it does not create another account.
- **Create local account**: explicitly creates a local accounting account for a source account.
- **Reconnect institution**: repairs credentials/consent for the institution item.
- **Reconnect account**: shown only when the backend can truly scope repair to that account; otherwise explain the institution scope.
- **Disconnect account** and **disconnect institution** must state different scopes and what historical ledger data remains.

## Recommended mobile flow

```text
Accounts
→ Connect bank
→ Plaid Link
→ Source-account selection
→ For each account: Link existing / Create local / Skip
→ Review mappings and consequences
→ Syncing status
→ Success with account cards
```

Reconnect starts from an action-required account card, explains scope, launches Plaid update mode, shows a non-destructive syncing state, and returns to the same account detail. No raw Plaid code appears in normal UI.

## Validation matrix

Test synthetic: single and multiple accounts; same last4 with different names; existing local account candidate; user cancels Plaid; partial account mapping; update mode success/failure; delayed webhook; disconnected/archived account; restricted user; cash account; long institution name.
