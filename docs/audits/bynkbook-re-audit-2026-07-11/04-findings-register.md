# Consolidated Findings Register

| ID | Severity | Finding | Status |
|---|---|---|---|
| BYNK-REAUDIT-PLAID-001 | High | `/transactions/sync` sends `account_id` at the wrong level; production returns `UNKNOWN_FIELDS` and 502 | Confirmed production defect |
| BYNK-REAUDIT-PLAID-002 | High | Every `TRANSACTIONS` webhook sets updates available and enqueues sync, regardless of webhook code | Confirmed code defect |
| BYNK-REAUDIT-PLAID-003 | High | US/Canada `PENDING_DISCONNECT` and self-heal `LOGIN_REPAIRED` webhook states are ignored | Confirmed lifecycle gap |
| BYNK-REAUDIT-PLAID-004 | Medium | Status-route failure is rendered as `Not connected`, conflating unavailable status with no connection | Confirmed UX/state defect |
| BYNK-REAUDIT-PLAID-005 | Medium | Standard-SQS/manual sync overlap has no per-account distributed cursor lock | Confirmed design risk; no corruption asserted |
| BYNK-REAUDIT-PLAID-006 | Medium | Adding newly discovered accounts after initial Link is not implemented | Confirmed capability gap |
| BYNK-REAUDIT-PLAID-007 | Medium | New queue/worker is deployed but has not processed a post-deployment production webhook | Verification gap |
| BYNK-REAUDIT-OPS-001 | Medium | Plaid backlog and DLQ alarms have no notification actions | Confirmed operational gap |
| BYNK-REAUDIT-RECON-001 | High | Background entries loader cancels itself and can remain true forever | Confirmed production defect |
| BYNK-REAUDIT-RECON-002 | Medium | Reconciliation-history failure leaves hydration false and renders an endless skeleton | Confirmed code defect |
| BYNK-REAUDIT-RECON-003 | Medium | Placement-summary recomputation amplifies initial-load requests and activity indicators | Confirmed performance issue |
| BYNK-REAUDIT-UI-001 | Medium | At 768px the global shell is 949px wide and topbar controls are off-screen | Confirmed production responsive defect |
| BYNK-REAUDIT-TEST-001 | Medium | Plaid unit tests assert the incompatible request shape and lack a real contract boundary | Confirmed coverage defect |
| BYNK-CARRIED-LEGAL-001 | High | Final legal copy/business commitments are not approved | Open business blocker |
| BYNK-CARRIED-INFRA-001 | Medium | Live dependencies retain dev naming and require staged migration | Open migration |
| BYNK-CARRIED-DATA-001 | Medium | Historical `BankMatch` migration remains pending production inventory | Open migration |
| BYNK-CARRIED-ARCH-001 | Low | Reconcile/Ledger/Settings page clients remain monolithic | Open maintainability work |
| BYNK-CARRIED-UX-001 | Low | Overlay density and visual-pattern consolidation remain partial | Open polish work |

No finding in this register is based solely on an assumption. Production claims are backed by API access logs, Lambda logs, deployed AWS configuration, or the read-only production browser run. Design-risk findings are explicitly labeled and do not assert observed data corruption.

