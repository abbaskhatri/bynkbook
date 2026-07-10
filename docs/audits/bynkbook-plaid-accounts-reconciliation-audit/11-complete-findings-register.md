# Complete Plaid-Scope Findings Register

All findings are based on repository, test, deployed AWS configuration, or official Plaid documentation evidence. “Possible” describes a reachable code path, not a claim that production data is already affected. Production aggregate counts were unavailable.

## BYNK-PLAID-AUDIT-001 — Opening application trusts a client-supplied financial amount

| Field | Value |
|---|---|
| Severity / confidence / classification | **High** / High / Financial data integrity, authorization |
| Workflow / account type / role | Apply or keep Plaid opening / all connected types / any business member |
| Production impact | A caller can create or overwrite an opening entry and account opening balance with an arbitrary cent value. |
| Frontend / backend / endpoint | `PlaidConnectButton.tsx`; `plaidApplyOpening.ts`; `POST .../plaid/apply-opening` |
| Database / AWS / Plaid | `Account`, `Entry`, `BankConnection`; apply-opening Lambda; preview balance is derived from Plaid but not revalidated. |
| Files / lines | `bynkbook-web/src/components/plaid/PlaidConnectButton.tsx:331`; `infra-sst/packages/functions/src/plaidApplyOpening.ts:25-33,66-92,97-144` |
| Expected / actual | Server recomputes or validates the preview and validates an enum; server accepts request `suggestedOpeningCents`, and any non-cancel/non-manual choice falls into apply. |
| Evidence / safe reproduction | Static source inspection; in a non-production fixture, alter the request amount or use an invalid nonempty choice and compare the written opening. Do not reproduce in production. |
| User / financial / reconciliation / ledger impact | Misstated opening and account balance; downstream reconciliation and ledger totals can be wrong. |
| Security / data-integrity impact | Intra-tenant tampering; direct mutation of canonical financial records. |
| Root cause / correction | Preview treated as authority. Persist a server-side preview/version or recompute atomically; enum-validate choice; require write policy. |
| Complexity / regression risk / tests | Medium / High / tampered amount, stale preview, enum, role, concurrent apply, account-type sign tests. |
| Immediate action / blocks reliability | **Yes**: restrict/disable Apply until fixed / **Yes**. |

## BYNK-PLAID-AUDIT-002 — Opening-date change can delete transactions used by active match groups

| Field | Value |
|---|---|
| Severity / confidence / classification | **High** / High / Ledger and audit-trail integrity |
| Workflow / account type / role | Change opening date / all Plaid accounts / any business member via direct API |
| Production impact | Deployed backend can hard-delete older Plaid rows while leaving active group references. No frontend caller was found. |
| Frontend / backend / endpoint | None; `plaidChangeOpeningDate.ts`; `POST .../plaid/change-opening-date` |
| Database / AWS / Plaid | `BankTransaction`, legacy `BankMatch`, `MatchGroupBank`; change-opening Lambda; resync follows deletion. |
| Files / lines | `infra-sst/packages/functions/src/plaidChangeOpeningDate.ts:27-68`; `infra-sst/prisma/schema.prisma:458-477` |
| Expected / actual | All active relationships block or are transactionally migrated; only legacy `BankMatch` is counted, then Plaid rows are deleted. `MatchGroupBank` has no FK to `BankTransaction`. |
| Evidence / safe reproduction | Schema and handler inspection; in an isolated DB create an active MatchGroup, confirm prune, then query orphan group bank IDs. |
| User / financial / reconciliation / ledger impact | Reconciled activity can lose its bank fact while appearing matched; audit trail and derived ledger can become inconsistent. |
| Security / data-integrity impact | Membership-only destructive endpoint; orphan records. |
| Root cause / correction | Legacy match check not updated for MatchGroups and missing FK. Disable route; add full dependency check/FK or soft-prune migration. |
| Complexity / regression risk / tests | High / High / active/voided group, legacy match, cutoff, rollback, resync tests. |
| Immediate action / blocks reliability | **Yes**: disable route / **Yes**. |

## BYNK-PLAID-AUDIT-003 — Credit-card Plaid balance sign is not normalized

| Field | Value |
|---|---|
| Severity / confidence / classification | **High** / High / Accounting semantics |
| Workflow / account type / role | Balance and opening calculation / `CREDIT_CARD` / connector or sync caller |
| Production impact | Plaid's positive amount-owed balance is displayed and calculated as an asset-like positive balance. |
| Frontend / backend / endpoint | Reconcile/opening UI; `plaidService.ts`, `plaidPreviewOpening.ts`; sync/preview/apply routes |
| Database / AWS / Plaid | Account/Entry/BankConnection; Plaid Lambdas; `/accounts/balance/get` semantics. |
| Files / lines | `infra-sst/packages/functions/src/lib/plaidService.ts:1277-1284,1683-1710`; `infra-sst/packages/functions/src/plaidPreviewOpening.ts:61-96`; `bynkbook-web/src/app/(app)/reconcile/page-client.tsx:741-765,3296-3300` |
| Expected / actual | Liability balance normalized/labeled by account type; raw current balance feeds the same calculation/display for every type. |
| Evidence / safe reproduction | Source plus [Plaid accounts documentation](https://plaid.com/docs/api/accounts/); fixture a credit balance and compare accounting sign. |
| User / financial / reconciliation / ledger impact | Wrong opening entry and misleading balance for credit cards; ledger totals can invert liability meaning. |
| Security / data-integrity impact | No direct security impact; financial semantic corruption. |
| Root cause / correction | One balance convention applied to assets and liabilities. Define signed balance contract and migrate/review existing credit openings. |
| Complexity / regression risk / tests | High / High / checking, savings, credit, negative credit, refunds, migration tests. |
| Immediate action / blocks reliability | **Yes for credit onboarding** / **Yes for credit-card accounting**. |

## BYNK-PLAID-AUDIT-004 — Active match exclusivity is not database-enforced

| Field | Value |
|---|---|
| Severity / confidence / classification | **High** / High / Concurrency, reconciliation integrity |
| Workflow / account type / role | Manual/automatic match / all / users allowed to reconcile |
| Production impact | Concurrent requests can both pass pre-insert checks and use the same bank transaction or entry in two active groups. |
| Frontend / backend / endpoint | Reconcile/auto-reconcile; `matchGroups.ts`; match-group create route |
| Database / AWS / Plaid | `MatchGroup`, `MatchGroupBank`, `MatchGroupEntry`; reconciliation Lambda; no Plaid call. |
| Files / lines | `infra-sst/prisma/schema.prisma:428-498`; `infra-sst/packages/functions/src/matchGroups.ts:682-735` |
| Expected / actual | Serializable locking or DB constraint guarantees single active membership; read-before-create application checks only. |
| Evidence / safe reproduction | Schema/service inspection; issue two synchronized create requests in an isolated DB and count active memberships. |
| User / financial / reconciliation / ledger impact | Double reconciliation and duplicate ledger attribution are possible. |
| Security / data-integrity impact | No cross-tenant impact; core integrity invariant not enforced. |
| Root cause / correction | State-dependent uniqueness modeled only in code. Add a transactionally enforced membership/active-claim design and orphan FK. |
| Complexity / regression risk / tests | High / High / concurrency, revert/reuse, migration duplicate scan tests. |
| Immediate action / blocks reliability | Yes before high-volume/concurrent use / **Yes**. |

## BYNK-PLAID-AUDIT-005 — Reconnect repair can remap to an incompatible live account

| Field | Value |
|---|---|
| Severity / confidence / classification | **High** / High / Account identity, reconnection |
| Workflow / account type / role | Update-mode repair / all Plaid types / any business member |
| Production impact | A local ledger can be redirected to a different account on the same Item; its cursor is reset and future feed can mix. |
| Frontend / backend / endpoint | `PlaidConnectButton.tsx`; `plaidService.ts`; `POST .../plaid/repair-account` |
| Database / AWS / Plaid | `BankConnection`, `BankTransaction`; repair Lambda; `/accounts/get`, Link update mode. |
| Files / lines | `infra-sst/packages/functions/src/lib/plaidService.ts:1015-1118`; `bynkbook-web/src/components/plaid/PlaidConnectButton.tsx:401-415,576-665` |
| Expected / actual | Original identity/type/currency compatibility must be proven; only live Item membership and duplicate mapping are checked. |
| Evidence / safe reproduction | Unit fixture with two Item accounts: choose the sibling for repair and observe mapping accepted. |
| User / financial / reconciliation / ledger impact | Wrong account transactions can enter an existing ledger, producing false matches and balances. |
| Security / data-integrity impact | Intra-business integrity issue; cross-tenant checks remain present. |
| Root cause / correction | Stable identity metadata is not persisted/enforced. Store verified identity and require explicit audited migration for exceptions. |
| Complexity / regression risk / tests | Medium-high / High / same account, changed mask/name, incompatible type/currency, sibling repair tests. |
| Immediate action / blocks reliability | Yes: restrict repair choices / **Yes for reconnect**. |

## BYNK-PLAID-AUDIT-006 — Valid transaction webhooks do not trigger a durable sync

| Field | Value |
|---|---|
| Severity / confidence / classification | **Medium** / High / Sync reliability, operations |
| Workflow / account type / role | Webhook update / all Plaid / system |
| Production impact | New updates remain a flag until a user causes sync; no internal retry or drain SLA exists. |
| Frontend / backend / endpoint | Status indicator; `plaidService.ts`; public `POST /v1/plaid/webhook` |
| Database / AWS / Plaid | `BankConnection.has_new_transactions`; webhook Lambda; `SYNC_UPDATES_AVAILABLE`; no EventBridge/SQS found. |
| Files / lines | `infra-sst/packages/functions/src/lib/plaidService.ts:1898-1904`; `infra-sst/sst.config.ts` |
| Expected / actual | Verified webhook enqueues idempotent sync work; handler only updates a flag. |
| Evidence / safe reproduction | Source/AWS enumeration; valid webhook fixture changes flag but no sync client invocation. |
| User / financial / reconciliation / ledger impact | Stale feed, delayed reconciliation and ledger. |
| Security / data-integrity impact | Verification is strong; freshness integrity risk. |
| Root cause / correction | Poll-on-use design. Add per-Item/account idempotent queue worker, retry/DLQ, alarm, and complete drain. |
| Complexity / regression risk / tests | High / Medium / webhook replay, dedupe, retry, ordering, DLQ, load tests. |
| Immediate action / blocks reliability | Monitoring/manual sync until fixed / Yes for timely accounting. |

## BYNK-PLAID-AUDIT-007 — Capped sync clears the update flag without frontend continuation

| Field | Value |
|---|---|
| Severity / confidence / classification | **Medium** / High / Pagination, missed-transaction risk |
| Workflow / account type / role | Initial/incremental/manual sync / all / any member |
| Production impact | More than 5,000 updates require another manual call, while the pending flag is cleared. Data is delayed, not necessarily permanently lost. |
| Frontend / backend / endpoint | Single-call refresh; `plaidService.ts`; sync route |
| Database / AWS / Plaid | BankConnection cursor/flag; sync Lambda/API timeout; `/transactions/sync`. |
| Files / lines | `infra-sst/packages/functions/src/lib/plaidService.ts:1300-1405,1824-1870` |
| Expected / actual | Worker continues until `has_more=false` or schedules continuation; partial cursor is saved and response says capped, but caller does not continue. |
| Evidence / safe reproduction | Mock >5,000 updates and inspect `hasMore`, cursor, and flag; do not use production. |
| User / financial / reconciliation / ledger impact | Incomplete visible feed and delayed matching/ledger. |
| Security / data-integrity impact | No direct security issue; temporal completeness risk. |
| Root cause / correction | Safety cap lacks orchestration. Persist pending state and enqueue/loop continuation with bounded leases. |
| Complexity / regression risk / tests | Medium / Medium / cap, resume, crash, cursor, UI-state tests. |
| Immediate action / blocks reliability | No emergency; monitor capped responses / Yes for complete imports. |

## BYNK-PLAID-AUDIT-008 — Full-drain overlap cutoff can preserve historical gaps

| Field | Value |
|---|---|
| Severity / confidence / classification | **Medium** / High / Historical completeness |
| Workflow / account type / role | First sync after manual/CSV history / all / connector |
| Production impact | Legitimate older Plaid transactions at/before the latest local date are skipped if local history has holes. |
| Frontend / backend / endpoint | Overlap-skipped message; `plaidService.ts`; sync route |
| Database / AWS / Plaid | BankTransaction; sync Lambda; `/transactions/sync`. |
| Files / lines | `infra-sst/packages/functions/src/lib/plaidService.ts:1438-1457,1559-1573` |
| Expected / actual | Per-row identity/import reconciliation identifies overlap; a date-wide cutoff suppresses all new older IDs. |
| Evidence / safe reproduction | Fixture local latest date with an earlier gap, then return an unseen Plaid ID in the gap and observe skip counter. |
| User / financial / reconciliation / ledger impact | Missing historical activity and unreconciled balance differences. |
| Security / data-integrity impact | Completeness risk only. |
| Root cause / correction | Coarse overlap policy. Build explicit import provenance/dedupe review and backfill mode. |
| Complexity / regression risk / tests | High / High / CSV overlap, gaps, same-day duplicates, backfill tests. |
| Immediate action / blocks reliability | Review skip counts / Yes for historical completeness. |

## BYNK-PLAID-AUDIT-009 — Local disconnect does not remove the Plaid Item

| Field | Value |
|---|---|
| Severity / confidence / classification | **Medium** / High / Consent, security, lifecycle |
| Workflow / account type / role | Disconnect/archive/cancel / all Plaid / any member |
| Production impact | Final local mapping can disappear while Plaid access/authorization and possible billing continue. |
| Frontend / backend / endpoint | Settings disconnect; `plaidService.ts`, `accounts.ts`, `plaidApplyOpening.ts`; disconnect/archive/apply routes |
| Database / AWS / Plaid | BankConnection; multiple Lambdas; missing `/item/remove`. |
| Files / lines | `infra-sst/packages/functions/src/lib/plaidService.ts:1128-1145`; `infra-sst/packages/functions/src/accounts.ts:250-264`; `infra-sst/packages/functions/src/plaidApplyOpening.ts:39-42` |
| Expected / actual | Last mapping removal distinguishes account vs Item and calls item/remove after confirmation; only DB mapping is deleted. |
| Evidence / safe reproduction | Static call search finds no item/remove; disconnect fixture leaves no local token from which later removal can be made. |
| User / financial / reconciliation / ledger impact | Misleading disconnect; local history remains intentionally. |
| Security / data-integrity impact | Consent/token lifecycle exposure; no direct ledger mutation. |
| Root cause / correction | Account mapping and Item lifecycle conflated. Model Item ownership/refcount; remove final Item and record audit result. |
| Complexity / regression risk / tests | High / High / sibling mappings, final removal, Plaid error/retry, archive/cancel tests. |
| Immediate action / blocks reliability | Update process/wording; prioritize / No, but blocks trustworthy disconnect. |

## BYNK-PLAID-AUDIT-010 — Multi-account creation is not atomic

| Field | Value |
|---|---|
| Severity / confidence / classification | **Medium** / High / Transactionality, account lifecycle |
| Workflow / account type / role | Select multiple accounts / all selected / any member |
| Production impact | Later account/sync failure can leave some local accounts and mappings created while the overall user action is incomplete. |
| Frontend / backend / endpoint | Settings multi-select; `plaidCreateAccount.ts`, `plaidService.ts`; create-account route |
| Database / AWS / Plaid | Account/BankConnection; create/exchange Lambdas; token exchange/accounts get. |
| Files / lines | `infra-sst/packages/functions/src/plaidCreateAccount.ts:57-116`; `infra-sst/packages/functions/src/lib/plaidService.ts:709-810` |
| Expected / actual | One durable workflow with compensating recovery; primary and additional writes/syncs occur sequentially with limited rollback. |
| Evidence / safe reproduction | Inject failure on a later additional account in fixtures and inspect prior rows. |
| User / financial / reconciliation / ledger impact | Partial account setup, confusing duplicate/retry behavior, uneven history. |
| Security / data-integrity impact | Lifecycle consistency risk. |
| Root cause / correction | External exchange and DB fan-out lack a workflow state machine. Add idempotency key, setup state, transaction boundaries, compensation. |
| Complexity / regression risk / tests | High / High / failure at every step, replay, Item cleanup, sibling tests. |
| Immediate action / blocks reliability | No emergency; limit bulk onboarding / Yes for atomic onboarding claims. |

## BYNK-PLAID-AUDIT-011 — Remove/add replacement heuristic can transfer durable identity incorrectly

| Field | Value |
|---|---|
| Severity / confidence / classification | **Medium** / Medium-high / Sync identity, false match |
| Workflow / account type / role | Modified/replaced transaction / all / system |
| Production impact | A unique same-date, same-amount, normalized-name transaction can inherit another removed row's ID and existing match. |
| Frontend / backend / endpoint | Feed/reconcile/ledger; `plaidService.ts`; sync route |
| Database / AWS / Plaid | BankTransaction/MatchGroup; sync Lambda; added/removed arrays. |
| Files / lines | `infra-sst/packages/functions/src/lib/plaidService.ts:1505-1556` |
| Expected / actual | Identity changes use Plaid-provided linkage or explicit review; heuristic rekeys when exactly one candidate matches three mutable attributes. |
| Evidence / safe reproduction | Fixture a removed matched coffee charge and a new independent equal charge on same date/name; observe rekey. |
| User / financial / reconciliation / ledger impact | False reconciliation and incorrect audit identity/date history. |
| Security / data-integrity impact | No security impact; provenance risk. |
| Root cause / correction | Heuristic optimizes continuity without a durable ambiguity state. Restrict to stronger signals or quarantine for review. |
| Complexity / regression risk / tests | Medium / Medium / collision, ambiguous, matched/unmatched, true replacement tests. |
| Immediate action / blocks reliability | Monitor replacement counts / Can block correctness in collisions. |

## BYNK-PLAID-AUDIT-012 — New-account endpoint reports sync success without inspecting nested response status

| Field | Value |
|---|---|
| Severity / confidence / classification | **Medium** / High / Error handling, UX correctness |
| Workflow / account type / role | Create Plaid account / all / member |
| Production impact | Outer response is HTTP 200 with `synced:true` even when `syncTransactions` returns a 4xx/5xx response object. Additional syncs are marked `ok:true` unless they throw. |
| Frontend / backend / endpoint | Settings success flow; `plaidCreateAccount.ts`; create-account route |
| Database / AWS / Plaid | Account/BankConnection/BankTransaction; create Lambda; initial sync. |
| Files / lines | `infra-sst/packages/functions/src/plaidCreateAccount.ts:96-116` |
| Expected / actual | Nested status parsed and partial state surfaced; only exchange status is inspected. |
| Evidence / safe reproduction | Mock sync to return `{statusCode:502}` without throwing; observe outer 200/synced true. |
| User / financial / reconciliation / ledger impact | User believes account is current when no initial transactions arrived. |
| Security / data-integrity impact | Freshness/status integrity risk. |
| Root cause / correction | Lambda-style response objects mixed with exceptions/domain results. Normalize service result types and workflow status. |
| Complexity / regression risk / tests | Low-medium / Medium / primary/additional error-object and retry tests. |
| Immediate action / blocks reliability | No emergency / Blocks reliable onboarding status. |

## BYNK-PLAID-AUDIT-013 — Plaid financial mutations require membership, not a write policy

| Field | Value |
|---|---|
| Severity / confidence / classification | **Medium** / High / Authorization; expands existing BYNK-AUDIT-007 |
| Workflow / account type / role | Connect, exchange, sync, repair, disconnect, opening mutations / all / any member including intended view-only roles |
| Production impact | A low-privilege business member can invoke material account/feed mutations through the API. Cross-tenant checks remain present. |
| Frontend / backend / endpoint | Plaid settings/connect/reconcile; Plaid handlers/service; all authenticated Plaid mutation routes |
| Database / AWS / Plaid | Account/connection/transactions/entries; Cognito-protected Lambdas; Link/sync/account APIs. |
| Files / lines | `infra-sst/packages/functions/src/lib/plaidService.ts:467-502,639-644,1025-1030,1131-1136,1161-1166`; `plaidApplyOpening.ts:32-37`; `plaidChangeOpeningDate.ts:26-28`; `plaidCreateAccount.ts:42-47` |
| Expected / actual | Central policy enforces intended write capability; handlers only test membership. |
| Evidence / safe reproduction | Static policy comparison; use a non-production view-role fixture and call each handler. |
| User / financial / reconciliation / ledger impact | Unauthorized intra-business changes can alter connections, history, opening, and ledger. |
| Security / data-integrity impact | Broken function-level authorization inside tenant; no proven cross-tenant bypass. |
| Root cause / correction | Plaid handlers predate/avoid central authorization matrix. Require explicit capabilities server-side. |
| Complexity / regression risk / tests | Medium / Medium / role matrix for every route and direct API tests. |
| Immediate action / blocks reliability | **Yes** / Yes for role-separated organizations. |

## BYNK-PLAID-AUDIT-014 — Matched source-removed transactions are restored without a separate source-removal state

| Field | Value |
|---|---|
| Severity / confidence / classification | **Low** / High / Audit transparency |
| Workflow / account type / role | Plaid removal after match / all / system/reconciler |
| Production impact | Ledger continuity is preserved, but active feed state no longer truthfully conveys Plaid removal. |
| Frontend / backend / endpoint | Reconcile/ledger; `plaidService.ts`; sync route |
| Database / AWS / Plaid | BankTransaction/MatchGroup; sync Lambda; removed[]. |
| Files / lines | `infra-sst/packages/functions/src/lib/plaidService.ts:1642-1675` |
| Expected / actual | Preserve ledger and separately record source removal/conflict; matched row is forced back to `is_removed=false`. |
| Evidence / safe reproduction | Match a fixture row, return it in removed[], inspect flags. |
| User / financial / reconciliation / ledger impact | User may not know bank source withdrew/corrected a reconciled transaction. Ledger is intentionally preserved. |
| Security / data-integrity impact | Provenance/audit-state ambiguity. |
| Root cause / correction | One flag serves source state and ledger retention. Add source status/event and review workflow. |
| Complexity / regression risk / tests | Medium / Medium / matched removal, reinstatement, UI warning, audit tests. |
| Immediate action / blocks reliability | No / No, but blocks complete source auditability. |

## BYNK-PLAID-AUDIT-015 — Auto-reconcile ignores expected entries beyond the first 250

| Field | Value |
|---|---|
| Severity / confidence / classification | **Low** / High / UX completeness |
| Workflow / account type / role | Automatic suggestion / all / reconciler |
| Production impact | A valid candidate outside the slice is never suggested; manual matching remains available. |
| Frontend / backend / endpoint | Auto-reconcile dialog; client-side only; no specific endpoint |
| Database / AWS / Plaid | Entry/BankTransaction read data; none; none. |
| Files / lines | `bynkbook-web/src/components/reconcile/auto-reconcile-dialog.tsx:267` |
| Expected / actual | Pagination/search communicates scope; first 250 are silently selected. |
| Evidence / safe reproduction | Provide 251+ expected entries with sole match at index 251 and run suggestion. |
| User / financial / reconciliation / ledger impact | Missed convenience suggestion; no silent posting or direct financial corruption. |
| Security / data-integrity impact | None. |
| Root cause / correction | Client safety cap without server candidate query or disclosure. Add deterministic paged search and scope indicator. |
| Complexity / regression risk / tests | Medium / Low / >250, ordering, performance tests. |
| Immediate action / blocks reliability | No / No. |

## BYNK-PLAID-AUDIT-016 — Legacy partial matching and current full-match groups coexist without a declared migration rule

| Field | Value |
|---|---|
| Severity / confidence / classification | **Informational** / High / Maintainability, accounting-policy decision |
| Workflow / account type / role | Partial match/status/legacy data / all / reconciler |
| Production impact | Current UI does not create partial MatchGroups, but legacy `BankMatch` supports partial values and some status/date-change code still reads it. Actual production legacy-row count is unknown. |
| Frontend / backend / endpoint | Current UI full-only; `matches.ts`, `plaidChangeOpeningDate.ts`; legacy match routes remain deployed |
| Database / AWS / Plaid | BankMatch and MatchGroup tables; matching Lambdas; none. |
| Files / lines | `infra-sst/packages/functions/src/matches.ts:159-245`; `infra-sst/prisma/schema.prisma:397-426,428-498`; `plaidChangeOpeningDate.ts:30-31` |
| Expected / actual | One documented matching model and migration/read contract; two models coexist. |
| Evidence / safe reproduction | Source/schema inventory; query aggregate legacy counts when production DB access is available. |
| User / financial / reconciliation / ledger impact | Historical status may differ by code path; no current corruption proven. |
| Security / data-integrity impact | Model ambiguity only. |
| Root cause / correction | Incremental replacement without completed deprecation. Decide partial policy, migrate, make read paths explicit, retire old routes. |
| Complexity / regression risk / tests | High / High / migration, mixed-history, snapshots, ledger parity tests. |
| Immediate action / blocks reliability | No; decision required / Unknown until production counts are known. |
