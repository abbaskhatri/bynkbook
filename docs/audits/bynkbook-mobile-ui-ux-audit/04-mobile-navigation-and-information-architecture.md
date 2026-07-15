# Mobile navigation and information architecture

## Current navigation map

```text
Protected main shell
├─ Bottom: Home
├─ Bottom: Ledger
├─ Bottom: Reconcile
├─ Bottom: Issues
└─ More drawer
   ├─ Operations
   ├─ Category Review
   ├─ Closed Periods
   ├─ Planning
   ├─ Reports
   ├─ Vendors
   └─ Settings

Separate /mobile shell
├─ Home
├─ Review
├─ Receipt
├─ Vendors
└─ Invoice
```

Problems: route families use different top-level labels and destinations; record creation appears as navigation; search is hidden in More; detail is mostly dialog-based; browser back and list-position preservation are not a shared contract.

## Recommended navigation map

```text
Mobile shell
├─ Home            urgent work, balances, recent activity
├─ Activity        Ledger + Transactions tabs, account filter
├─ Reconcile       unresolved queue; issue badge
├─ Contacts        Vendors (Customers only if/when a real entity exists)
└─ More
   ├─ Issues / Attention
   ├─ Reports
   ├─ Planning
   ├─ Closed periods
   ├─ Accounts
   └─ Settings

Contextual create button / action sheet
├─ Receipt
├─ Invoice/bill upload
├─ Manual entry
└─ Vendor
```

The repository has Vendors and Bills, but no Customer model or customer route. The design must not invent a Customer surface until product/backend approval.

## Navigation contracts

- A detail route receives a stable record ID and a return token (route/query plus scroll anchor), not a transient modal-only state.
- Back returns to the same business/account, tab, search, filters, sort, group, selection exit state, and scroll anchor.
- Opening a deep link establishes required business/account context or explains why access is unavailable.
- Browser back closes a simple sheet/dialog before leaving the page; full-screen flows participate in route history.
- Unsaved forms intercept back with a named discard/stay confirmation.
- Bottom navigation never exceeds five items and uses at least 44x44 targets plus icon and label.
- Account/business switching is persistent context in the header, not duplicated inside every filter sheet.

## Current-to-recommended mapping

| Current | Recommended | Reason |
|---|---|---|
| Dashboard/Home | Home | Preserve familiar entry |
| Ledger | Activity / Ledger tab | Pairs with bank activity while preserving ledger semantics |
| Reconcile | Reconcile | High-frequency accounting task |
| Issues | Attention under Home/More; badge on Reconcile | Avoid five permanent destinations while keeping urgency visible |
| Operations | Home attention sections | Operational health belongs near balances/action required |
| Category Review | Reconcile/Attention workflow | It is unresolved bookkeeping work, not a separate world |
| Receipt/Invoice nav items | Create action | These are actions, not destinations |
| Vendors | Contacts | Extensible label, but show Vendors only until Customers exist |
| Accounts settings | More / Accounts | High-value but lower frequency |
