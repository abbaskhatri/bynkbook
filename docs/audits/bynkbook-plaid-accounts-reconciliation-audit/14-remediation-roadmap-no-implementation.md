# Remediation Roadmap — No Implementation

Each phase should be a separate PR with migration backups where applicable.

| Phase | Findings | Dependencies and code areas | Data/production risk | Verification and rollback |
|---|---|---|---|---|
| Emergency financial protection | -001, -002, -003 | Apply/preview/change-date handlers; balance contract | High; existing openings may require review | Feature-gate first; fixture tests; aggregate review; rollback gate/config |
| Plaid security/roles | -013, existing BYNK-AUDIT-006/-007 | Central capabilities; every Plaid handler | Medium access regression | Role matrix integration tests; rollback policy change |
| Reconciliation integrity | -004 | Prisma schema, MatchGroup service | High migration if duplicates exist | Read-only duplicate scan, migration rehearsal, concurrency tests; DB backup |
| Account identity/reconnect | -005 | Persist Plaid type/subtype/currency/stable identity; repair UI/service | Medium; existing metadata backfill | Same/sibling/change scenarios; rollback nullable fields |
| Sync reliability | -007, -008, -011, -012 | Sync orchestration, overlap/replacement policy, typed service results | High historical-import behavior | Synthetic long feeds, replay, gap/CSV fixtures; cursor snapshot rollback |
| Webhook reliability | -006 | Queue, worker, DLQ, alarms, idempotency | Medium infra cost/load | Replay/load/poison tests, drain metrics; disable event source rollback |
| Item lifecycle | -009 | Item entity/refcount, disconnect/archive/cancel, `/item/remove` | High consent and multi-account behavior | Sandbox sibling/final mapping tests; durable removal audit/retry |
| Atomic onboarding | -010 | Account setup state machine/idempotency | High external/DB compensation | Fail each step, retry same key, reconcile partial states |
| Ledger/source audit | -014 | Separate source removal event/status, UI warning | Medium read-path migration | Matched removal/reinstatement and ledger parity tests |
| Matching policy cleanup | -016 | Decide partial policy; migrate/retire BankMatch | High if legacy rows exist | Production aggregate counts, shadow parity, reversible migration |
| Frontend clarity | -012, -015, -007, -009 | Settings, Plaid component, reconcile dialog | Low-medium | Component/E2E tests for errors, caps, disconnect wording |
| Monitoring/alerting | -006, -007, -008, -010, -011 | Structured metrics: lag, capped, skips, replacements, partial setup | Low | Alarm canaries and runbooks; threshold rollback |
| Automated coverage | Existing -020/-021 plus all above | Frontend test harness; authenticated disposable environment | Low, requires safe identities | CI unit/integration/E2E; never use real books |
| Cleanup/maintainability | -016, existing -017/-019 | Legacy handlers, monoliths, typed service responses | Medium regression | Contract tests and incremental PRs |

Emergency phases must precede opening or credit-card expansion. Schema and data migrations require read-only preflight counts that this audit could not obtain.
