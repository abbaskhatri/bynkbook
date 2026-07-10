# End-to-end verification matrix

Twenty-six workflow groups were assessed. Eight safe public/security workflows were executed end to end; eighteen authenticated or mutating workflows were code-traced but not executed because no approved test tenant/account existed.

| Workflow | Role | Frontend | API | Backend | Database/storage | Authorization | Production | Automated coverage | Final status | Evidence | Findings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1. Landing page load | Public | Rendered desktop/mobile | n/a | n/a | n/a | Redirect check | 200/no console error | None | WORKING_WITH_WARNINGS | Browser DOM/layout | 015,016 |
| 2. API health | Public | n/a | 200 on `cpjh7t19u1` | health Lambda response | n/a | Public by design | Verified | None | VERIFIED_WORKING | Safe GET `/v1/health` | 005 |
| 3. Protected API without token | Public/attacker | n/a | 401 | Lambda not reached as expected | none | JWT authorizer | Verified | Indirect | VERIFIED_WORKING | Safe GET `/v1/businesses` | — |
| 4. Protected page redirect | Signed-out | `/dashboard` redirected | none before login | n/a | n/a | AppShell guard | Verified | None | VERIFIED_WORKING | Browser ended at `/login?next=%2Fdashboard` | 020 |
| 5. Login page render | Public | form and Google action render | Cognito not submitted | n/a | Cognito not touched | Inputs disabled until valid | Verified | None | VERIFIED_WORKING | Browser DOM/no console errors | 016,020 |
| 6. Signup page render | Public | form renders | Cognito not submitted | n/a | Cognito not touched | Client required fields | Verified | None | VERIFIED_WORKING | Browser DOM/no console errors | 002,016,020 |
| 7. Recovery/confirmation render | Public | forgot/reset/confirm render | Cognito not submitted | n/a | Cognito not touched | Required inputs | Verified | None | VERIFIED_WORKING | Browser DOM/no console errors | 016,020 |
| 8. Legal-page access | Public | both pages render | n/a | n/a | n/a | Public | Verified | None | WORKING_WITH_WARNINGS | Browser headings and source copy | 002 |
| 9. Email signup/confirm transaction | Public | Code-traced | Cognito direct | n/a | Cognito | Cognito policy | Not executed | None | NOT_TESTABLE | No approved identity/email | 021 |
| 10. Email/Google sign-in and logout | User | Code-traced | Cognito direct + API | Claims consumed | Cognito/local session | ID token, session policy | Not executed | None | NOT_TESTABLE | No approved account | 021 |
| 11. Create/manage business | User/owner | Code-traced | business CRUD | Membership + transaction | Business/roles/categories | owner/admin gates | Not executed | 5 backend tests | NOT_TESTABLE | Source/tests only | 006,021 |
| 12. Dashboard load | Member+ | Code-traced | attention/insights/reports | Scoped handlers | Entry/Issue/AP | Membership | Not executed | Partial backend | NOT_TESTABLE | Source only | 020,021 |
| 13. Account lifecycle | Owner/admin/write roles | Code-traced | 7 account endpoints | accounts handler | Account | membership/role/account | Not executed | 9 tests | NOT_TESTABLE | Source/tests | 006,007,021 |
| 14. Plaid connect/sync/reconnect | Write roles | Code-traced | 12 endpoints/webhook | Plaid service | BankConnection/Transaction, KMS | member/account/signature | Intentionally not executed | 37 service tests | NOT_TESTABLE | Production bank mutation prohibited | 005,021 |
| 15. Upload/import/capture | Write roles | Code-traced | init/complete/import/etc. | uploads handler/S3/Textract | Upload/S3/Entry/Bill | membership/account/type/size | Not executed | 5 upload tests | NOT_TESTABLE | Source/tests | 007,021 |
| 16. Ledger entry lifecycle | Write roles | Code-traced | list/create/update/delete/restore/merge | entry handlers | Entry/Issue/Match | business/account/closed period | Not executed | Strong backend partial | NOT_TESTABLE | Source/tests | 007,019,020,021 |
| 17. Transfer lifecycle | Write roles | Code-traced | transfer CRUD/restore | transfer handler | Transfer + Entry legs | scope/closed period/FULL | Not executed | No dedicated suite found | NOT_TESTABLE | Source only | 020,021 |
| 18. Category review/apply | Write roles | Code-traced | suggest/batch/category | AI/entries/categories | Entry/CategoryMemory | member/FULL apply | Not executed | 43+ scoring/apply tests | NOT_TESTABLE | Source/tests | 007,021 |
| 19. Issue scan/resolve/bulk | Member/write roles | Code-traced | 7 issue endpoints | issue handlers | EntryIssue/Entry | member/write/closed period | Not executed | 61+ tests | NOT_TESTABLE | Source/tests | 021 |
| 20. Reconcile/match/revert | Write roles | Code-traced | bank/match-group endpoints | match handlers | BankTransaction/MatchGroup/Entry | account/FULL | Not executed | Extensive backend tests | NOT_TESTABLE | Source/tests | 019,021 |
| 21. Snapshot/export | Write roles | Code-traced | snapshot routes | snapshot handler/S3 | ReconcileSnapshot/S3 CSV | FULL snapshot/export | Not executed | No dedicated full route suite | WORKING_WITH_WARNINGS | Static trace | 009,021 |
| 22. Period close/reopen | Owner/admin | Code-traced | close endpoints | closed periods handler | ClosedPeriod | owner/admin; owner reopen | Not executed | 3 tests | NOT_TESTABLE | Source/tests | 021 |
| 23. Vendor/AP/payment/statement | Member/write roles | Code-traced | vendor/AP routes | vendors/AP handlers | Vendor/Bill/Application/Entry | membership/role/vendor scope | Not executed | 7 AP tests | BROKEN | Schema proves statement/reversal defects | 001,007,008,009 |
| 24. Planning/reports/search | Members/write roles | Code-traced | budget/goal/report/search | handlers | Budget/Goal/financial rows | membership/policy | Not executed | reports tests only | NOT_TESTABLE | Source/tests | 020,021 |
| 25. Team/role policies | Owner/admin/member | Code-traced | team/policy endpoints | team/authz handlers | Invite/Role/Policy | static role + optional policy | Not executed | 12 tests | PARTIALLY_IMPLEMENTED | Source/API flags | 006,007,021 |
| 26. Mobile workbench/capture | Authenticated | Code-traced/responsive public shell only | reused APIs | reused handlers | reused stores | same role checks | Not executed authenticated | None | NOT_TESTABLE | Source only | 016,020,021 |

## Full trace examples

### Verified protected-route trace

```text
GET /dashboard in signed-out browser
→ AppShell calls Amplify getCurrentUser
→ no current user
→ router replaces /login?next=/dashboard
→ login form renders
→ no business API request or data mutation
```

### Code-traced ledger mutation

```text
Ledger dialog submit
→ page local state / React Query mutation
→ src/lib/api/entries.ts
→ apiFetch obtains Cognito ID token
→ API Gateway JWT authorizer
→ entries or entryUpdate handler
→ business membership + account scope + write allowlist + policy + closed-period check
→ Prisma transaction on Entry/related records
→ JSON response
→ optimistic cache confirmation/invalidation
→ success or structured error UI
```

### Code-traced upload

```text
Select file
→ client type/size check
→ POST uploads/init
→ membership/account/type/size check
→ Upload INITIATED row + presigned private S3 PUT
→ browser PUT to S3
→ mark-uploaded / complete
→ HeadObject verifies actual size
→ optional Textract/CSV parse
→ Upload status and optional Entry/Bill creation
→ upload list/query refresh
```
