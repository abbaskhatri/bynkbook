# Plaid, Webhook, Sync, and Multi-Account Audit

## Production evidence

- AWS account: `116846786465`, profile `ledrigo-dev`.
- Production webhook configuration: `https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com/v1/plaid/webhook`.
- Plaid environment: `production`.
- Signed webhook deliveries: 12 HTTP 200 responses in the inspected 14-day access-log window, identified by `Go-http-client/2.0`.
- Manual transaction syncs in the same window: 17 HTTP 200 and 26 HTTP 502 responses.
- Current deployed failure: `UNKNOWN_FIELDS` / `the following fields are not recognized by this endpoint: account_id`.
- Queue at inspection: 0 visible, 0 in flight, 0 delayed; DLQ: 0.
- Worker event-source mapping: enabled, batch size 5, `ReportBatchItemFailures`, redrive after 5 receives.
- Backlog and DLQ alarms: `OK`, but both have empty alarm-action lists.

## Root cause: sync request contract

`syncTransactions` builds:

```ts
{
  access_token,
  cursor,
  count: 500,
  account_id,
}
```

The installed `plaid@41` SDK defines `TransactionsSyncRequest.options.account_id`. Production Plaid rejects the top-level field. The code's compatibility fallback only recognizes `NO_ACCOUNTS`, `INVALID_ACCOUNT`, or `INVALID_FIELD`/`INVALID_INPUT` mentioning `ACCOUNT_ID`; it does not recognize the actual `UNKNOWN_FIELDS` response.

The unit tests reinforce the defect by asserting top-level `account_id` against a permissive mock instead of validating the request against the SDK type or a realistic Plaid contract fixture.

## Update-availability semantics

The webhook handler sets `has_new_transactions=true` and queues every mapped account for every webhook whose type is `TRANSACTIONS`. That includes legacy transaction webhooks and unrelated transaction-product notifications such as recurring-transaction updates. The application should use `SYNC_UPDATES_AVAILABLE` as the authoritative trigger for `/transactions/sync`, with deliberately documented compatibility handling only where required.

The UI only shows `Updates available` while the feed is considered healthy, `hasNewTransactions` is true, and a foreground sync is not running. A failed sync deliberately preserves the flag. This preservation is correct for a real incomplete drain, but with the request-contract failure it produces a persistent false-action loop.

## Disconnect and reconnect semantics

Expected Plaid reconnect causes include `ITEM_LOGIN_REQUIRED`, revoked permissions, changed credentials/MFA, and expiring institution consent. BynkBook correctly launches Link update mode for a known broken Item and classifies several of these errors.

Gaps:

1. `PENDING_DISCONNECT`, Plaid's current US/Canada advance-consent warning, is ignored.
2. `LOGIN_REPAIRED` is ignored, so a self-healed Item is not cleared until another active status probe succeeds.
3. The status route calls `accounts/get` synchronously on page load. A frontend timeout or status-route failure is swallowed into `plaid=null`, which renders `Not connected` instead of `Status unavailable`.
4. Generic sync errors remain logically connected, which is correct, but the wording and status-fetch failure path make separate conditions look alike.

## Multiple-account support

Supported now:

- Multiple Plaid accounts returned by one initial Link session can be selected.
- The primary selected account maps to the existing BynkBook account.
- Additional selections create separate BynkBook accounts and `BankConnection` rows in one database transaction.
- A Plaid account can map only once per business.
- One Item/access token may be shared by sibling mapped accounts.
- Disconnecting one sibling preserves the Plaid Item until the final mapping is removed.
- Successful reconnect clears stale reconnect flags for live sibling mappings without changing their account IDs or cursors.

Not complete:

- `NEW_ACCOUNTS_AVAILABLE` is ignored.
- Update-mode account addition is not implemented as a create-and-map flow.
- The current sync request defect prevents reliable per-account cursor drains.

## Concurrency and delivery risks

The queue is a standard SQS queue and can redeliver. Manual and webhook-driven sync can overlap. `syncTransactions` has no per-account distributed/advisory lock or idempotent job key around cursor read, transaction application, and cursor update. Database uniqueness limits duplicate rows, but overlapping drains can still do repeated work and race the final cursor/flag update. This is a confirmed design gap from source inspection; no production corruption was asserted.

## Official Plaid references

- Plaid Transactions API: <https://plaid.com/docs/api/products/transactions/>
- Plaid Transactions integration: <https://plaid.com/docs/transactions/>
- Plaid Link update mode: <https://plaid.com/docs/link/update-mode/>

