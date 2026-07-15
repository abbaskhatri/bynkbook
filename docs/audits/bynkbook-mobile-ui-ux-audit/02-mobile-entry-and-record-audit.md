# Mobile entry and record audit

Only repository-backed entities are included. Canonical rule: a mobile list row must expose record identity, signed value, state, date, and business/account context without horizontal scrolling. Secondary accounting facts remain reachable in disclosure or detail; none are deleted for visual simplicity.

| Entry ID | Entity | Primary information | Secondary information | Status/financial information | Metadata | Immediate actions | Expanded/detail | Canonical mobile pattern |
|---|---|---|---|---|---|---|---|---|
| BYNK-MOBILE-ENTRY-001 | Ledger entry | Payee/memo; signed amount | Category; account | Posted/expected/deleted/matched; balance effect | Date, ref, method, type | Open; fix when required | Full fields, issue history, linked bank tx, audit actions | Date-grouped compact financial row + detail page |
| BYNK-MOBILE-ENTRY-002 | Bank transaction | Merchant/description; signed amount | Source account | Pending/posted; unmatched/matched/partial/excluded | Transaction and posted dates; source | Review match | Suggestions, linked records, sync/source details | Reconcile queue row + detail page |
| BYNK-MOBILE-ENTRY-003 | Expected entry | Payee/customer/vendor; expected amount | Source document; account | Expected/matched/partial; remaining amount | Expected date, category, ref | Match/review | Allocations and history | Expected-entry row + detail |
| BYNK-MOBILE-ENTRY-004 | Match group | Bank transaction + linked entry labels | Rationale/source | Full/partial; matched/remaining amounts | Who/when/method | Confirm/reject/revert where allowed | All allocations and ledger impact | Review card inside guided flow |
| BYNK-MOBILE-ENTRY-005 | Entry issue | Issue title + affected record | Recommended next step | Severity/confidence/resolution | Detected/updated | Fix/acknowledge | Evidence and audit history | Attention row grouped by type/severity |
| BYNK-MOBILE-ENTRY-006 | Category review item | Payee + amount | Current/suggested category | Confidence and warning | Date, reason | Select/apply | Suggestion rationale and alternatives | Selectable compact row |
| BYNK-MOBILE-ENTRY-007 | Account | Name; current/ledger balance | Institution/type/last4 | Healthy/syncing/stale/action required/disconnected/archived | Last successful sync | Open; refresh/reconnect if required | Connection, balance source/freshness, transactions | Account summary card + detail |
| BYNK-MOBILE-ENTRY-008 | Bank connection | Institution | Included accounts | Connected/syncing/delayed/login required/failed/disconnected | Last success/error explanation | Reconnect | Account membership and disconnect scope | Sync-status banner/detail section |
| BYNK-MOBILE-ENTRY-009 | Vendor | Vendor name; open AP | Aging summary | Attention/healthy | Updated date | Open | Bills, payments, files, contact | Compact vendor/AP row + detail |
| BYNK-MOBILE-ENTRY-010 | Bill | Invoice number/vendor; total/outstanding | Due date, memo | Draft/open/partial/paid/voided | Source upload | Open/pay/void when safe | Applications, audit history, file | Bill summary row + detail |
| BYNK-MOBILE-ENTRY-011 | Vendor payment | Payee; amount/unapplied | Account | Applied/partial/unapplied/deleted | Date/ref | Apply/open | Allocations and ledger link | Payment row + detail |
| BYNK-MOBILE-ENTRY-012 | Upload | Filename/type | Parsed vendor/date/total | Uploaded/parsing/needs review/failed/duplicate/completed | Upload date | Review/retry/delete when safe | File preview and extracted fields | File row + full-screen review |
| BYNK-MOBILE-ENTRY-013 | Closed period | Month | Closed-through context | Closed/reopened | Actor/time | Reopen if owner | Export and audit activity | Timeline row + confirmation |
| BYNK-MOBILE-ENTRY-014 | Budget | Category; budgeted/actual/remaining | Period | Over/under/on track | Updated | Edit | History if introduced | Metric row + form |
| BYNK-MOBILE-ENTRY-015 | Goal | Name; target/progress | Category/months | Active/completed | Updated | Edit | Monthly progress | Summary card + form |
| BYNK-MOBILE-ENTRY-016 | Activity log | Human event label | Actor | Success/warning implied by event | Absolute timestamp | Expand | Structured details | Timeline |
| BYNK-MOBILE-ENTRY-017 | Team member/invite | Email/display identity | Role | Active/pending/expired | Added/expires | Change/revoke/remove by policy | Permission details | Settings row + confirmation |
| BYNK-MOBILE-ENTRY-018 | Reconcile snapshot | Period/label | Account | Complete/available | Created by/time | Open/export | Totals and evidence | Timeline row + detail |
| BYNK-MOBILE-ENTRY-019 | Transfer candidate/transfer | From/to context; amount | Date/payee | Suggested/confirmed/matched | Evidence | Review/create | Both legs and ledger impact | Review card + confirmation |
| BYNK-MOBILE-ENTRY-020 | Business | Business name | Profile | Active/deleting | Created/updated | Switch/open | Profile, team, settings | Workspace selector/settings detail |

## Financial row ordering

1. Top line: record identity left; signed/currency amount right.
2. Second line: account or counterparty left; explicit status label right.
3. Third line when needed: date/source/category and one action-required reason.
4. Entire row opens detail. Overflow contains only safe secondary actions; destructive actions never use swipe-only access.
5. Pending, expected, actual, partial, unmatched, excluded, refund, reversal, and transfer always have text or icon labels in addition to color.

## Selection and swipe

- Multi-select is appropriate for category review and issue remediation only after entering a visible selection mode.
- Selected count and sticky safe action are required; destructive bulk actions require a separate review.
- No financial delete, exclude, void, unmatch, disconnect, or reopen action should be swipe-primary. A visible alternative is mandatory for any swipe shortcut.
