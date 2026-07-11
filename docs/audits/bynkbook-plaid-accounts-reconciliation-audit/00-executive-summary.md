# Bynkbook Plaid, Accounts, Reconciliation, and Ledger Audit

Audit date: 2026-07-10
Scope: audit only; no application, infrastructure, Plaid, or production-data changes
Source revision: `0b3a78a`
Production AWS account verified: `116846786465`

## Founder summary

Bynkbook has a real, thoughtfully built Plaid integration: tokens are encrypted with KMS, credentials are in Secrets Manager, webhook signatures are verified, transaction cursors are stored per account, and automated backend tests cover the principal sync and reconciliation paths. The backend test suite passed all 261 tests. The production API and Plaid Lambdas are deployed consistently in Plaid's production environment.

It is not yet safe to describe the financial workflow as fully reliable. Five high-risk defects can directly alter, orphan, misclassify, or double-use financial records. The most urgent are: a client can submit an arbitrary Plaid opening amount; the deployed opening-date endpoint can delete transactions referenced by active match groups; credit-card balances are not sign-normalized before opening-balance calculation; active match membership is protected only by application checks that can race; and reconnect repair can map a local account to a different live account without checking type, currency, or prior identity.

Financial data is therefore at risk in specific workflows, not universally. The code prevents the ordinary duplicate-Plaid-ID case and preserves pending-to-posted identity. Cross-tenant linkage was not found: membership and account/business checks consistently scope requests. Intra-business authorization is too broad, however: ordinary members can invoke financial Plaid mutations.

Transactions can be delayed or missed from Bynkbook's visible feed. Webhooks only set a flag; there is no queue, schedule, or webhook-triggered drain. A sync caps work and requires a later manual call to continue. The first full drain also skips new rows at or before the latest locally stored date, which protects imports from overlap but can preserve gaps. These are evidence-backed risks; production row counts could not be checked because the database is private and the read-only connection timed out before a query ran.

Reconnection preserves the same Plaid Item in update mode, which is correct, but account remapping is insufficiently constrained. Reconciliation is full-match-only in the current UI and uses explicit Apply; automatic suggestions are not silently posted. False results remain possible under concurrent match creation and through a same-date/same-amount/name replacement heuristic.

## Health assessment

| Area | Rating | Evidence-based conclusion |
|---|---|---|
| Plaid integration | Needs correction | Strong token/webhook foundations; Item removal and automatic webhook drain are absent. |
| Account system | High-risk edge cases | Five stored types; local/Plaid/archive flows exist, but balance semantics and remapping checks are incomplete. |
| Transaction sync | Partially reliable | Cursors, pagination, modified/removed and pending transitions exist; caps and history cutoff can delay/omit rows. |
| Reconciliation | Partially reliable | Explicit, balanced full matches and reversal exist; database does not enforce exclusive active membership. |
| Ledger integrity | At risk in bounded paths | Opening and date-change defects can change balances or orphan audit links. |
| Production verification | Incomplete | AWS configuration verified; authenticated UI/Plaid and aggregate DB checks were intentionally not performed. |

## Immediate founder actions

1. Temporarily disable or tightly restrict `apply-opening` and the deployed `change-opening-date` route until BYNK-PLAID-AUDIT-001 and -002 are fixed.
2. Do not onboard credit-card accounts through automatic opening calculation until BYNK-PLAID-AUDIT-003 is resolved and corrected data is reviewed.
3. Restrict connect, disconnect, repair, sync, and opening mutations to the intended accounting roles.
4. Add database-enforced active-match exclusivity before increasing reconciliation usage.
5. Implement durable webhook-to-sync processing and a complete-drain loop, with alarms.

Recommended order: financial-data protection; authorization; match uniqueness; account identity and balance rules; sync/webhook reliability; Item lifecycle; transactional multi-account creation; UX/test coverage. The detailed no-implementation plan is in `14-remediation-roadmap-no-implementation.md`.

## Result

This audit found 16 Plaid-scope findings: 5 High, 8 Medium, 2 Low, and 1 Informational. One of the Medium findings expands the previously open general authorization finding rather than adding a duplicate to the master list. The full deduplicated backlog is in `16-master-remediation-list.md`.
