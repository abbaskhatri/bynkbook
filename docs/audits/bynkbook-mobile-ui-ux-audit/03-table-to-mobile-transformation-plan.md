# Table-to-mobile transformation plan

Twenty-four user-facing table instances/families were identified when shared `LedgerTableShell` usages are expanded; the base table primitive itself is not counted as a user surface.

| Table ID | Route/family | Desktop columns or width | Essential mobile facts | Transformation | Hidden-field destination | Bulk/sort/totals treatment |
|---|---|---|---|---|---|---|
| BYNK-MOBILE-TABLE-001 | Ledger | 13 columns | Payee, amount, date, account/category, status | Grouped compact rows | Entry detail | Selection mode; totals sticky above nav |
| BYNK-MOBILE-TABLE-002 | Ledger apply invoice | Invoice/outstanding/apply | Invoice, outstanding, apply amount | Allocation list | Apply review | Sticky allocated/remaining summary |
| BYNK-MOBILE-TABLE-003 | Category review | 780px; select/payee/amount/category | Payee, amount, suggestion, confidence | Selectable list | Disclosure/detail | Explicit selection mode |
| BYNK-MOBILE-TABLE-004 | Reconcile expected | 560px; date/payee/amount/status/actions | Payee, expected/matched/remaining, date, status | Expected-entry list | Detail | Group by unresolved/matched |
| BYNK-MOBILE-TABLE-005 | Reconcile bank | 560px; select/date/description/amount/actions | Description, amount, date, account, match state | Transaction list | Detail | Selection only where safe |
| BYNK-MOBILE-TABLE-006 | Reconcile manual-entry picker | 520px | Payee, date, amount, status | Searchable picker rows | Candidate detail | Search/sort sheet |
| BYNK-MOBILE-TABLE-007 | Reconcile manual-bank picker | 520px | Description, date, amount | Searchable picker rows | Candidate detail | Search/sort sheet |
| BYNK-MOBILE-TABLE-008 | Reconciliation history | 1190px | When, action, record, amount, actor | Timeline | History detail | Filter sheet |
| BYNK-MOBILE-TABLE-009 | Snapshot exceptions | 820px | Type, item, detail, open state | Issue list | Detail | Group by type |
| BYNK-MOBILE-TABLE-010 | Vendor list | approx. 1000px derived columns | Vendor, open AP, aging, updated | Vendor/AP rows | Vendor detail | Sort/filter sheet |
| BYNK-MOBILE-TABLE-011 | Vendor bills | 1070px | Invoice, due, total, outstanding, status | Bill rows | Bill detail | Sticky AP total |
| BYNK-MOBILE-TABLE-012 | Vendor payments | 1150px | Date, amount, applied/unapplied, status | Payment rows | Payment detail | Sticky credit total |
| BYNK-MOBILE-TABLE-013 | Vendor uploads | 1000px | File, date, parse status | File rows | Upload review | Filter by state |
| BYNK-MOBILE-TABLE-014 | Apply payment picker | 560px | Invoice, outstanding, apply | Allocation rows | Review | Sticky remaining amount |
| BYNK-MOBILE-TABLE-015 | Alternate allocation picker | 560px | Invoice, outstanding, apply | Same canonical allocation rows | Review | Consolidate duplicate UI |
| BYNK-MOBILE-TABLE-016 | Upload invoice review | 1260px | File/vendor/invoice/date/due/total/status | File summary cards | Full review | Group by parse state |
| BYNK-MOBILE-TABLE-017 | Upload receipt review | 980px | File/vendor/date/total/status | File summary cards | Full review | Group by parse state |
| BYNK-MOBILE-TABLE-018 | Generic upload | 560px | File/status | File rows | Review | None |
| BYNK-MOBILE-TABLE-019 | Settings activity | 640px | When/event/actor | Timeline | Expanded details | Date/event filter |
| BYNK-MOBILE-TABLE-020 | Settings invites | 640px | Email/role/expires | Settings rows | Invite detail | Action sheet |
| BYNK-MOBILE-TABLE-021 | Settings members | 720px | Identity/role/added | Settings rows | Member detail | Action sheet |
| BYNK-MOBILE-TABLE-022 | Role policy matrix | 720px | Feature + role access | Horizontal table allowed as reference, or per-role grouped list | Policy detail | No bulk action |
| BYNK-MOBILE-TABLE-023 | Settings accounts | 1180px | Account/balance/status/freshness | Account cards | Account detail | Filter active/archived/action required |
| BYNK-MOBILE-TABLE-024 | Planning budgets/goals | 4/5 columns | Name/category/target/progress | Metric rows | Edit form | Period/group summaries |
| BYNK-MOBILE-TABLE-025 | Report statement details | 640px | Period, inflow/outflow/net | Statement rows | Drill-down | Sticky total if long |
| BYNK-MOBILE-TABLE-026 | Category migration | 560px grid | Memo/count/mapped category | Review list | Mapping editor | Review-before-apply |
| BYNK-MOBILE-TABLE-027 | Ledger issue-fix candidates | 8 columns | Date/payee/amount/status/category | Candidate list | Candidate detail | Search/filter |

## Numeric rules

- Use tabular/monospaced digits and right alignment for amounts.
- Keep ISO currency or symbol unambiguous; never show missing as `$0.00`.
- Keep sign and direction label together. Parentheses may supplement but not replace a minus sign/label where confusion is possible.
- Totals belong in a sticky summary outside the scrolling row region, above the mobile bottom navigation.
- A horizontal table remains acceptable only for low-frequency reference matrices where column comparison is the task; all transactional tables transform.
