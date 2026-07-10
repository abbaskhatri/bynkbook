# Unknowns, Blockers, and Founder Decisions

## Verified blockers and intentional limits

- No approved authenticated production test user or disposable Plaid Item was provided; all production mutations were intentionally skipped.
- Production PostgreSQL is private. The aggregate-only probe timed out before SQL, so current duplicate, orphan, legacy-match, missing-history, and credit-opening counts are unknown.
- Some new physical Lambda log groups did not yet exist; no assertion is made about production invocation success or error rates.
- Plaid production credentials/configuration exist, but no access token or live financial data was read.
- Frontend has no automated test suite; backend mocks cannot prove browser or real-bank behavior.

## Founder/accounting decisions required

1. Define the signed balance contract for assets, credit cards/liabilities, overdrafts, and negative balances.
2. Decide whether partial reconciliation is supported. If no, approve migration/retirement of legacy `BankMatch`; if yes, design it explicitly in MatchGroups and ledger math.
3. Define opening-date authority: immutable after transactions/matches, or a controlled migration with accountant approval.
4. Define overlap policy for existing CSV/manual history: exact dedupe, review queue, or authoritative source precedence.
5. Define who may connect, sync, repair, disconnect, alter opening balances, and reconcile.
6. Define account identity rules when an institution changes masks/names or closes/replaces an account.
7. Decide whether disconnecting one account keeps the shared Item and whether disconnecting the last account must immediately call `/item/remove`.
8. Define acceptable webhook-to-ledger freshness and alert thresholds.
9. Decide how matched transactions later removed by Plaid should appear and who resolves the conflict.
10. Approve a disposable non-production E2E identity and institution fixtures.

Assumptions that must not be treated as facts: no production corruption was proven; absence of returned aggregate counts is not a zero count; an unused frontend route is still a deployed API exposure; tests passing do not prove real Plaid delivery; and “member” is not assumed to be authorized for every write merely because current code allows it.
