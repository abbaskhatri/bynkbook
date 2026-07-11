# Current UI Architecture and Route Inventory

## Layout hierarchy

```text
Root layout
├─ Providers (Amplify, React Query, theme, optional performance overlay)
├─ Public landing page
├─ Auth layout
│  └─ Sign-in, signup, recovery, confirmation, OAuth, legal, business creation
└─ App layout
   └─ AppShell
      ├─ Authentication/session guard
      ├─ Business/account scope resolution
      ├─ Desktop sidebar + top bar + global search/activity/user menus
      ├─ Responsive bottom navigation + More drawer
      ├─ Main page outlet
      └─ Separate chrome-free `/mobile/*` application shell
```

## Roles proven from code

`OWNER`, `ADMIN`, `BOOKKEEPER`, `ACCOUNTANT`, and `MEMBER`. The main `NAV_GROUPS` array is not filtered by role. Backend/static permissions constrain actions, but navigation does not communicate those boundaries.

## Route inventory

| UI ID | Route | Purpose / reachability | Primary data | Classification | Findings |
|---|---|---|---|---|---|
| BYNK-UI-PAGE-001 | `/` | Public product landing; reachable | Hardcoded illustrative content | MODERATE_REDESIGN | 001,007,008,011 |
| 002 | `/login` | Email/Google sign-in; reachable | Cognito | MINOR_REFINEMENT | 007 |
| 003 | `/signup` | Account creation; reachable | Cognito | MODERATE_REDESIGN | 006 |
| 004 | `/confirm-signup` | Email code confirmation | Cognito | MODERATE_REDESIGN | 006,012 |
| 005 | `/forgot-password` | Start recovery | Cognito | MODERATE_REDESIGN | 006 |
| 006 | `/reset-password` | Complete recovery | Cognito | MODERATE_REDESIGN | 006 |
| 007 | `/oauth-callback` | OAuth completion/status | Cognito | MINOR_REFINEMENT | 012 |
| 008 | `/accept-invite` | Team invite acceptance | Team API | MINOR_REFINEMENT | 012 |
| 009 | `/create-business` | First workspace setup | Business/upload APIs | MODERATE_REDESIGN | 012 |
| 010 | `/privacy` | Public privacy disclosure | Static copy | BLOCKED_PENDING_PRODUCT_DECISION | 001 |
| 011 | `/terms` | Public service terms | Static copy | BLOCKED_PENDING_PRODUCT_DECISION | 001 |
| 012 | `/dashboard` | KPIs, charts, attention, activity, AI | Reports/attention/AI APIs | MODERATE_REDESIGN | 003,004,009,014 |
| 013 | `/ledger` | Entry creation/editing, search, AP, transfers | Entries/AP/issues/categories | MAJOR_REDESIGN | 002,008,009,013,014 |
| 014 | `/reconcile` | Bank/ledger matching, sync, snapshots, audit | Plaid/bank/match/entry APIs | MAJOR_REDESIGN | 002,003,008,009,013,014 |
| 015 | `/issues` | Find and resolve bookkeeping issues | Issue APIs | MODERATE_REDESIGN | 004,008,009 |
| 016 | `/category-review` | Review/apply category suggestions | AI/category APIs | MODERATE_REDESIGN | 002,008,009,014 |
| 017 | `/closed-periods` | Close/reopen months | Closed-period API | MODERATE_REDESIGN | 002,004,008 |
| 018 | `/planning` | Budgets and goals | Budget/goal APIs | MINOR_REFINEMENT | 002,008 |
| 019 | `/reports` | P&L, cashflow, categories, balances | Report APIs | MODERATE_REDESIGN | 003,009,012,014 |
| 020 | `/vendors` | Vendor directory/create | Vendor/AP APIs | MINOR_REFINEMENT | 002,008,012 |
| 021 | `/vendors/[vendorId]` | Bills, payments, credits, uploads | Vendor/AP/upload APIs | MAJOR_REDESIGN | 002,008,009,013,014 |
| 022 | `/settings` | Activity, team, policies, accounts, business, destructive operations | 10+ API families | MAJOR_REDESIGN | 002,004,010,013,014 |
| 023 | `/settings/category-migration` | Owner migration utility | Category migration API | MODERATE_REDESIGN | 002,004,012 |
| 024 | `/accounts` | Compatibility redirect to Settings accounts | Router only | CONSOLIDATE | 019 |
| 025 | `/mobile` | Separate mobile operations home | Reports/attention APIs | BLOCKED_PENDING_PRODUCT_DECISION | 005 |
| 026 | `/mobile/review` | Mobile review hub | Issues/categories | BLOCKED_PENDING_PRODUCT_DECISION | 005 |
| 027 | `/mobile/uncategorized` | Mobile category queue | Entry/category APIs | BLOCKED_PENDING_PRODUCT_DECISION | 005 |
| 028 | `/mobile/issues` | Mobile issue queue | Issue APIs | BLOCKED_PENDING_PRODUCT_DECISION | 005 |
| 029 | `/mobile/receipt` | Mobile receipt capture | Upload APIs | BLOCKED_PENDING_PRODUCT_DECISION | 005 |
| 030 | `/mobile/vendors` | Mobile vendor summary | Vendor/AP APIs | BLOCKED_PENDING_PRODUCT_DECISION | 005 |
| 031 | `/mobile/invoice` | Mobile invoice capture/review | Upload/AP APIs | BLOCKED_PENDING_PRODUCT_DECISION | 005 |

The production build additionally emits `/_not-found` and treats `/vendors/[vendorId]` dynamically, producing 33 route entries.

## Hidden, duplicate, and unreachable surfaces

- `/accounts` is a compatibility redirect rather than a standalone page.
- `/settings/category-migration` is a hidden owner utility.
- `/mobile/uncategorized` is conditionally reached through mobile review.
- `src/app/(app)/dev/dialogs/page-client.tsx` remains as an orphan after its production route was removed.
- Public/auth routes are intentionally excluded from AppShell chrome.
- All authenticated routes safely redirect unauthenticated users to `/login?next=...`.

## Current information architecture

Desktop groups: Core (Dashboard, Ledger), Bookkeeping (Reconcile, Issues, Category Review, Closed Periods, Planning, Reports), Business (Vendors, Settings). Responsive primary tabs expose Home, Ledger, Reconcile, Issues, and a More drawer. The separate mobile application exposes Home, Review, Receipt, Vendors, and Invoice, creating a second task model.
