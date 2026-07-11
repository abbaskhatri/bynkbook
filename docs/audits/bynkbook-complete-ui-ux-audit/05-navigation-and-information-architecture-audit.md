# Navigation and Information Architecture Audit

## Current model

```text
Dashboard
Ledger
Bookkeeping
  Reconcile
  Issues
  Category Review
  Closed Periods
  Planning
  Reports
Business
  Vendors
  Settings
```

Mobile adds a second model: Home, Review, Receipt, Vendors, Invoice. The responsive full app separately exposes Home, Ledger, Reconcile, Issues and More.

## Findings

- Navigation is generated from one constant with no role filter; MEMBER sees the same destinations as OWNER.
- Settings mixes daily configuration, account/Plaid lifecycle, team, policy, activity, export/backup and destructive business operations.
- “Issues,” “Category Review,” mobile “Review,” and “Uncategorized” overlap conceptually.
- `/accounts` exists only as a redirect to Settings, indicating an incomplete route consolidation.
- Global search is desktop-topbar or mobile-drawer only; this is coherent but its loading is delayed until idle.

## Recommended model

```text
Overview
  Dashboard
Money
  Ledger
  Bank & reconciliation
Work queues
  Needs attention (issues + category review)
Payables
  Vendors & bills
Planning & reports
  Planning
  Reports
Administration (role-aware)
  Accounts & connections
  Team & permissions
  Bookkeeping settings
  Business profile
  Activity & exports
```

Closed periods should be reachable from Ledger/Reconciliation month-close context and remain available administratively. Choose either responsive full-app mobile navigation or the `/mobile/*` operations shell; do not maintain both as equal primary experiences.

## Role behavior

- OWNER: all groups.
- ADMIN: all permitted operational/admin groups, excluding owner-only destructive actions.
- BOOKKEEPER: daily work, payables and reports; administration only where change policy permits.
- ACCOUNTANT: reconciliation/report/close focus.
- MEMBER: view-only destinations proven usable; hide controls/destinations that can never succeed.

Backend remains authoritative. Navigation filtering is guidance, not security.
