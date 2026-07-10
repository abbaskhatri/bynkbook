# End-to-End Verification Matrix

Legend: **Verified** = code plus automated/local evidence; **Partial** = components verified but no authenticated production execution; **Unverified** = no safe end-to-end evidence; **Defect** = evidence-backed finding.

| Workflow | Frontend | API/backend | Plaid / webhook | Database / reconciliation / ledger | Test coverage | Production status | Evidence / findings |
|---|---|---|---|---|---|---|---|
| Create manual account | Present | Protected route | N/A | Account/opening fields | Backend covered | Partial | BYNK-AUDIT-021 |
| Connect new institution | Present | Link + create | Production config | Creates account/connection | Unit covered | Partial | -010, -012 |
| Select one account | Present | ID verified on Item | accounts/get | Unique mapping | Unit covered | Partial | — |
| Select multiple accounts | Present | Sequential creation | Same Item | Partial state possible | Unit covered | Partial | -010 |
| Connect existing local account | Present | Account-scoped exchange | Link/exchange | Mapping + cursor | Unit covered | Partial | -013 |
| Initial import | Present | Per-account sync | transactions/sync | Dedupe + opening proposal | Unit covered | Partial | -001, -003, -008 |
| Incremental sync | Present | Cursor pagination | transactions/sync | Cursor persisted | Unit covered | Partial | -007 |
| Pending to posted | Visible | Durable-row upgrade | pending ID | Identity retained | Unit covered | Verified locally | — |
| Modified transaction | Visible | Update path | modified[] | Existing row updated | Unit covered | Verified locally | — |
| Removed transaction | Visible | Soft-remove logic | removed[] | Matched rows retained | Unit covered | Partial | -014 |
| Manual refresh | Present | One sync request | optional refresh | Updates feed | Unit covered | Partial | -007, -013 |
| Webhook-triggered sync | Update flag only | No drain worker | Signed webhook | Flag persisted | Webhook unit covered | Defect | -006 |
| Connection failure | Error UI | Failure recorded | Item error | Reconnect status | Unit covered | Partial | — |
| Update-mode reconnect | Present | Same-token Link | Update mode | Cursor reset/repair | Unit covered | Partial | -005 |
| New account under existing Item | Selection shown | Additional mapping | accounts/get | Sequential writes | Unit covered | Partial | -010 |
| Account disconnect | Settings action | Delete mapping | No item/remove | Tx history retained | Unit covered | Defect | -009, -013 |
| Item disconnect | No distinct action | Not implemented | No item/remove | Mapping-only | None | Defect | -009 |
| Expected-entry creation | Present | Entry routes | N/A | EXPECTED entry | Backend covered | Partial | BYNK-AUDIT-007 |
| Automatic match | Suggest + Apply | Group create | N/A | Exact full group | Backend covered | Partial | -004, -015 |
| Manual match | Present | Balanced create | N/A | Active group | Backend covered | Partial | -004 |
| Partial match | Not current UI | Legacy API only | N/A | Dual model | Legacy covered | Inconsistent | -016 |
| Rematch | Revert then apply | Void/create | N/A | Audit history retained | Backend covered | Verified locally | -004 |
| Unmatched transaction | Present | Read paths | N/A | Remains unmatched | Backend covered | Partial | — |
| Transfer | Generic matching | Direction validation | N/A | Entry/group semantics | Backend covered | Partial | — |
| Refund | Generic inflow | Direction validation | N/A | Entry/group semantics | Backend covered | Partial | — |
| Ledger posting | Ledger UI | Derived queries | N/A | Active groups drive ledger | Backend covered | Partial | -002, -003, -004 |
| Matched entry moves to bank date | Present | Derived status | N/A | Bank posted date used | Backend covered | Verified locally | -011, -014 |
| Change opening date | No caller | Deployed route | Resync | Can orphan groups | No focused safety test | Defect | -002, -013 |

Counts used in the final summary: 27 required workflows mapped; 7 sync variants locally verified by tests; 2 webhook classes verified at handler level; 3 reconnect behaviors verified; 7 reconciliation behaviors verified; 4 ledger derivation/revert behaviors verified. None was authenticated end-to-end in production.
