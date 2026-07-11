# Founder Verification Guide

Plaid securely connects a bank and supplies accounts, balances, and transaction updates. “Sync” means Bynkbook asks Plaid for all changes after a stored cursor. A webhook currently tells Bynkbook updates exist; it does not download them automatically. “Expected” is a planned ledger entry. Current “full match” means selected bank and expected totals balance exactly. Current UI does not offer partial matching, although a legacy backend model does. A reconciled item enters ledger views through an active match group and uses the bank posting date.

Use only a disposable test business and Plaid Sandbox/development Item after the high-risk fixes. Never run these steps against real books merely to verify behavior.

| Page | Action | Expected result and backend activity | Data that may change / must not change | Warning signs | Audit result |
|---|---|---|---|---|---|
| Settings → Accounts | Create a manual checking account | Account appears; account API writes one Account | New account only / other accounts unchanged | Duplicate or wrong opening | Locally covered; prod unverified |
| Settings → Connect bank | Link one disposable account | Link token, exchange, mapping, initial sync | One connection/selected account / unselected accounts absent | Success with empty feed; wrong type | Partial; -012 |
| Settings → Connect bank | Select multiple accounts | Every reviewed account reaches a clear complete/failed state | Selected accounts only | Partial silent success | Defect risk -010/-012 |
| Existing account → Connect | Link an existing local account | Mapping created; preview appears before opening apply | Connection/transactions / manual opening unchanged until choice | Opening changes before Apply | Partial; -001 |
| Opening review | Compare preview, then Apply | Server should recompute same amount and write one opening | One canonical opening / unrelated entries unchanged | Request amount can be altered | Known defect -001/-003 |
| Reconcile | Press Sync | All pages drain; last-sync updates | New/modified/removed bank rows / expected entries unchanged | `hasMore`, capped, stale flag | Known risk -007/-008 |
| Plaid test Item | Trigger pending→posted | Same durable row becomes posted | Bank row ID retained / match not duplicated | Duplicate pending + posted | Unit verified |
| Plaid test Item | Trigger removal | Unmatched row is removed; matched row warns and preserves ledger | Source status/audit event / entry unchanged | Matched removal hidden | -014 |
| Reconcile | Apply exact manual match | One active balanced group; item moves to matched/ledger date | Group links/status / bank and entry amounts unchanged | Same item matched twice | Risk -004 |
| Reconcile | Revert match | Group voided with actor/time/reason; sources reusable | Group status/audit only | Hard deletion of history | Unit verified |
| Reconcile | Run auto suggestions with >250 expected | UI should disclose/query complete scope | No write before Apply | Candidate after 250 omitted | Known -015 |
| Connection needs attention | Run Reconnect | Update-mode repairs same Item and original account | Connection status/cursor / account identity unchanged | Different sibling selectable | Known -005 |
| Settings → Disconnect | Disconnect final Item | UI must explain and Plaid access should be removed | Connection and Item audit state / transaction history retained | Plaid Item remains active | Known -009 |
| Credit-card test account | Preview opening | Liability sign and explanation are correct | Correct signed opening / asset accounts unchanged | Positive owed shown as asset | Known -003 |

Healthy behavior: one local mapping per selected Plaid account; one durable bank row through pending/posted changes; sync ends with `hasMore=false`; webhook work drains without opening the app; one active match membership per source; opening and liability signs agree with accounting policy; disconnect produces an auditable Plaid removal result.

Warning signs: capped sync, overlap-skipped count, repeated reconnect prompts, a different account offered as repair, success with zero/old transactions, duplicate active matches, a reconciled transaction missing from bank history, an unexplained opening adjustment, or a disconnected Item still visible at the institution.

Proved by this audit: compilation, all 261 backend tests, route/auth deployment shape, secret/KMS configuration, cursor/pending/modified/removed implementation, webhook signature verification, same-Item update-mode implementation, balanced MatchGroup/revert logic. Unverified: live bank Link, authenticated production flows, current production row integrity, webhook delivery-to-ledger latency, and real credit-card opening results.
