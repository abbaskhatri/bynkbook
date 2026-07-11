# End-to-End UX Verification Matrix

`Code-traced` means frontend/API/backend wiring was inspected but the current authenticated screen was not executed.

| Workflow | Role | Start → goal | Steps / status | Friction, mobile, accessibility, backend accuracy | Findings |
|---|---|---|---|---|---|
| Sign up | Public | Signup → confirmed account | 2 screens; browser-rendered; WORKING_WITH_MAJOR_FRICTION | Responsive; missing semantic form/name; Cognito-wired | 006 |
| Sign in | Public | Login → requested app route | 1 form; browser-rendered; VERIFIED_CLEAR_AND_USABLE | Responsive, labelled, keyboard order good; Cognito-wired | 007 |
| Password reset | Public | Forgot → code/new password → login | 2 screens; code-traced; WORKING_WITH_MINOR_FRICTION | Responsive static design; nonsemantic forms | 006 |
| Create business | Owner | Create-business → workspace | 1 long form; code-traced | Good labels; progressive disclosure desirable; real API | 012 |
| Protected deep link | Any | `/dashboard` → login with `next` | Browser-verified | Correct redirect, no data exposure | — |
| Dashboard review | All members | Dashboard → understand status | Code-traced; NOT_TESTABLE current auth | Responsive architecture; balance source unclear | 003,004,009,014,021 |
| Create/edit ledger entry | Write roles | Ledger → saved entry | Code-traced | Busy/error/closed-period wiring exists; dense/no semantic form | 002,008,009,014,015 |
| Transfer | Write roles | Ledger → balanced transfer | Code-traced | Financial checks real; overlay accessibility unverified | 002,013 |
| Upload/import | Write roles | Ledger/Reconcile → imported activity | Code-traced | Real API, progress/dialogs; keyboard/modal risk | 002,013 |
| Connect bank | Owner/Admin | Settings/Reconcile → Plaid Item/account | Code-traced | Strong consequence copy; no visible last sync | 002,003 |
| Reconnect bank | Owner/Admin | Needs attention → update mode → sync | Code-traced | Same-Item backend wiring; freshness/recovery clarity incomplete | 002,003 |
| Disconnect bank | Owner/Admin | Account → confirmed disconnect | Code-traced | Real Item lifecycle; destructive dialog primitive risk | 002 |
| Manual sync | Write roles | Reconcile → drained transactions | Code-traced | Durable backend; UI lacks last success time | 003 |
| Auto/manual reconcile | Bookkeeper/Accountant/Owner/Admin | Reconcile → full match | Code-traced | Virtualized and audited; 12 overlays/terminology density | 002,013,014 |
| Revert match | Write roles | Audit detail → reverted history | Code-traced | Explicit audit path; dialog/focus risk | 002 |
| Resolve issue | Write roles | Issues → resolved | Code-traced | Policy-backed; queue terminology overlaps | 004,009 |
| Category review | Write roles | Suggestions → applied categories | Code-traced | Real API/safety scoring; dense 2,843-line screen | 009,014 |
| Close/reopen period | Owner/Admin | Closed periods → locked/reopened | Code-traced | Consequences/role guards clear; modal risk | 002,004 |
| Vendor/bill/payment | Write roles | Vendors → AP state | Code-traced | Complete workflow; seven detail overlays and high density | 002,013,014 |
| Reports | Members | Reports → scoped output/export | Code-traced | Explicit Run report; balance rules separated but not prominent | 003,012 |
| Invite/change permissions | Owner | Settings → member/policy updated | Code-traced | Real enforcement; role-agnostic nav and settings density | 004,013 |
| Mobile review/capture | Authenticated | `/mobile` → review/receipt/invoice | Code-traced | Touch-first, but competes with responsive full app | 005,021 |
| Logout/session expiry | Authenticated | Account menu/timeout → login | Code-traced | Session controls and safe redirect present | 021 |

Not present as full workflows: customer/product management and desktop invoice sending. Mobile invoice capture and vendor/AP bills are the implemented surfaces; the audit does not label absent product areas broken.
