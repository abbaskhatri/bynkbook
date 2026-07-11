# Full-System Regression and Carried Gaps

## Validation results

| Check | Result |
|---|---|
| Frontend ESLint | Pass |
| Frontend Vitest | 4 files, 16 tests pass |
| Backend Vitest | 26 files, 284 tests pass |
| Infrastructure TypeScript | Pass |
| Next.js production build | Pass, 33 routes |
| Frontend production dependency audit | 0 vulnerabilities |
| Infrastructure/backend production dependency audit | 0 vulnerabilities |
| Authenticated production Reconcile read-only run | Pass for navigation/API responses; confirmed UX defects documented separately |
| Production queue/DLQ health | Empty and enabled at inspection |
| Plaid webhook delivery | Confirmed HTTP 200 deliveries |

## Carried unresolved launch and architecture gaps

These were not rediscovered as new defects, but remain open from the earlier complete audits:

1. Final privacy policy and terms still require business/counsel-approved content; the product must remain clearly labeled private beta until resolved.
2. CloudWatch Plaid alarms have no SNS or other alarm actions. There is detection configuration but no operator delivery path or controlled delivery test.
3. WAF adoption remains an explicit production architecture decision.
4. Live production still depends on dev-named Cognito/storage/KMS/database resources; renaming requires a staged migration, not an application-only edit.
5. Historical `BankMatch` rows remain readable pending production counts and a reversible migration to the current MatchGroup model.
6. Reconcile, Ledger, and Settings remain very large page clients. This contributed to loading-state coupling and weak test isolation.
7. Broader authenticated role and mutation workflow coverage remains incomplete. The synthetic account is now usable for read-only verification, but destructive/accounting mutations were intentionally not run in production.
8. Overlay-density and component/pill consolidation are partially complete, not fully verified across every authenticated workflow.
9. Authenticated Figma current-state frames remain an external design-delivery item rather than a code defect.

## Test-quality finding

Passing unit tests do not currently protect the Plaid request boundary. Tests use permissive mocks and assert a request shape that the installed SDK schema and live Plaid reject. Contract fixtures must be derived from the SDK/OpenAPI shape, and an isolated Plaid Sandbox smoke should cover Link → first sync → webhook → queued continuation.

## Audit limitations

- No customer data was queried directly.
- No production database tunnel was opened.
- No Plaid refresh or sync was triggered during this audit.
- No webhook was fabricated or replayed.
- No accounting mutation was performed.
- The post-deployment webhook-to-new-worker path remains unproven until a genuine signed webhook arrives or an approved isolated Plaid Sandbox verification is run.

