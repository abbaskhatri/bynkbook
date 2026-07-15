# Mobile route and surface inventory

Inventory source: Next.js build output and source at `df8b0f9`. Role labels reflect code-visible policy and must be validated with synthetic OWNER/ADMIN/MEMBER sessions.

## Route inventory

| Surface ID | Route | Purpose | Primary mobile pattern today | Role/context | Main problems | Recommended pattern | Figma |
|---|---|---|---|---|---|---|---|
| BYNK-MOBILE-PAGE-001 | `/` | Public product entry | Long responsive landing | Public | 5,029px at 320px; repeated copy | Condensed narrative | No |
| BYNK-MOBILE-PAGE-002 | `/login` | Authentication | Purpose-built form | Public | Strong pattern; keyboard still needs real-device check | Preserve | Reference |
| BYNK-MOBILE-PAGE-003 | `/signup` | Account creation | Purpose-built form | Public | Runtime validation only public | Preserve/refine | Yes |
| BYNK-MOBILE-PAGE-004 | `/confirm-signup` | Confirmation code | Form | Public | Keyboard/error state unverified | Full-page form | Yes |
| BYNK-MOBILE-PAGE-005 | `/forgot-password`, `/reset-password` | Recovery | Form | Public | Keyboard/error/success variants unverified | Full-page form | Yes |
| BYNK-MOBILE-PAGE-006 | `/create-business` | Onboarding | Multi-field form | Authenticated no-workspace | Small-screen/keyboard unverified | Grouped full-page form | Yes |
| BYNK-MOBILE-PAGE-007 | `/dashboard` | Operational overview | Responsive card stack | Authenticated | Weak attention ordering | Attention-first dashboard | Yes |
| BYNK-MOBILE-PAGE-008 | `/operations` | Bank health/transfer candidates | Cards + dialog | Authorized | Transfer action in generic dialog | Attention list + review page | Yes |
| BYNK-MOBILE-PAGE-009 | `/ledger` | Accounting records | Wide virtual/loaded spreadsheet | Account context required | 13-column context fragmentation | Grouped financial rows + detail | Yes |
| BYNK-MOBILE-PAGE-010 | `/reconcile` | Expected/bank matching | Two 560px tables + 12 dialogs | Account context required | Highest-friction mobile workflow | Guided queue + detail | Yes |
| BYNK-MOBILE-PAGE-011 | `/issues` | Attention queue | Compact issue list/filter strip | Account context required | Dense filter/actions; detail weak | Grouped issue queue | Yes |
| BYNK-MOBILE-PAGE-012 | `/category-review` | Categorization | 780px table + review dialog | Account context required | Bulk selection/table overflow | Selectable record list | Yes |
| BYNK-MOBILE-PAGE-013 | `/closed-periods` | Close/reopen history | Cards/list + dialog | Reopen owner-only | Consequence review in sheet | Timeline + confirmation | Yes |
| BYNK-MOBILE-PAGE-014 | `/planning` | Budgets/goals | Two editable tables | Authorized | Inline numeric editing | Summary rows + form | Yes |
| BYNK-MOBILE-PAGE-015 | `/reports` | Financial reports | Tabs, cards, charts, 640px detail | Authorized | Chart/table density | Statement rows + summaries | Yes |
| BYNK-MOBILE-PAGE-016 | `/vendors` | Vendor list | Wide LedgerTableShell | Authorized | No mobile AP row | Vendor/AP summary list | Yes |
| BYNK-MOBILE-PAGE-017 | `/vendors/[vendorId]` | AP workspace | Five wide tables + seven dialogs | Authorized | Bills/payments/files/actions fragmented | Segmented detail route | Yes |
| BYNK-MOBILE-PAGE-018 | `/settings` | Business/team/accounts/bookkeeping | Overflow tabs, five tables, 11 dialogs | Role-sensitive | Accounts/team/activity desktop-first | Settings list + subpages | Yes |
| BYNK-MOBILE-PAGE-019 | `/settings/category-migration` | Owner migration | 560px grid + confirm dialog | Owner | High-risk desktop grid | Dedicated review flow | Yes |
| BYNK-MOBILE-PAGE-020 | `/mobile/receipt` | Receipt capture | Separate mobile shell/form | Authenticated | Competes with main nav model | Contextual create flow | Yes |
| BYNK-MOBILE-PAGE-021 | `/mobile/invoice` | Invoice capture | Separate mobile shell/form | Authenticated | Competes with main nav model | Contextual create flow | Yes |
| BYNK-MOBILE-PAGE-022 | `/mobile`, `/mobile/review`, `/mobile/issues`, `/mobile/uncategorized`, `/mobile/vendors` | Redirect aliases | Canonical redirect | Authenticated | Parallel route vocabulary | Remove from user-facing IA after safe redirect plan | Map only |
| BYNK-MOBILE-PAGE-023 | `/accounts` | Redirect/compatibility route | Server route | Authenticated | Not a canonical visible destination | Canonicalize to Accounts settings/detail | Map only |
| BYNK-MOBILE-PAGE-024 | `/privacy`, `/terms` | Legal drafts | Responsive content | Public | Draft status by design | Preserve | No |

## Shared surfaces

| Surface ID | Component | Purpose | Touch/accessibility behavior | Viewport behavior | Recommendation |
|---|---|---|---|---|---|
| BYNK-MOBILE-COMPONENT-001 | `AppShellInner` | Auth guard, top bar, navigation | Named buttons; 32px controls rely on pointer media query | Bottom nav below `lg`; drawer | Keep data/context logic; redesign mobile chrome |
| BYNK-MOBILE-COMPONENT-002 | `MobileShell` | Capture-route shell | Five 51px nav items | Max 480px canvas | Retire competing IA; reuse only safe-area primitives |
| BYNK-MOBILE-COMPONENT-003 | `AppDialog` | All modal types | Radix focus semantics; 36px close; browser back unverified | Bottom sheet on mobile | Split into sheet, confirmation, full-screen flow |
| BYNK-MOBILE-COMPONENT-004 | `AppSidePanel` | More navigation | Radix dialog semantics | Nearly full-width right panel | Use for More only; 44px controls |
| BYNK-MOBILE-COMPONENT-005 | `LedgerTableShell` | Sticky financial table | Semantic table | Horizontal scrolling by design | Desktop only; provide mobile list alternative |
| BYNK-MOBILE-COMPONENT-006 | `FilterBar` and page filters | Search/filter/sort | Labels vary by page | Often stacks or scrolls | Search + chips + full-screen filter |
| BYNK-MOBILE-COMPONENT-007 | `StatusChip` | Semantic state | Text plus tone | Compact | Preserve; add icon where risk warrants |
| BYNK-MOBILE-COMPONENT-008 | `PlaidConnectButton` | Bank lifecycle | Four dialogs; named actions | Generic modal constraints | Route-backed connect/reconnect flow |
| BYNK-MOBILE-COMPONENT-009 | `UploadPanel` | File review | Dense table and dialog | 560–1260px minima | Full-screen review list/detail |
| BYNK-MOBILE-COMPONENT-010 | `GlobalSearch` | Cross-app search | Drawer-only on mobile | Hidden behind More | Provide top-level search entry |

## Overlay inventory

Static source count: 52 `AppDialog` instances, one side panel, and multiple select/menu portals. Main dialog families: ledger delete/matched/apply/AI/export/print; reconcile match/manual/partial/history/snapshot/rematch/revert; account create/review/delete/edit/archive/reset; Plaid connect/link/reconnect/disconnect; vendor bill/payment/allocation/upload/delete/edit/void; close/reopen; migration; auto-fix.

Every destructive family has an explicit confirmation or consequence message in code, which should be preserved. The mobile issue is presentation and flow complexity, not missing backend guardrails.
