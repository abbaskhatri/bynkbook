# Plaid Sync Monitoring and Recovery

## Controls defined in infrastructure

- API Gateway access logs are retained for three months.
- API Gateway applies a default stage throttle. Production defaults to 100 requests/second with a 200-request burst; both values are configurable with `BYNKBOOK_API_RATE_LIMIT` and `BYNKBOOK_API_BURST_LIMIT`.
- Plaid webhooks enqueue sync work in `PlaidSyncQueue` and failed jobs move to `PlaidSyncDeadLetterQueue` after five receives.
- `PlaidSyncBacklogAgeAlarm` enters alarm state when the oldest queued job is over five minutes old for two consecutive one-minute periods.
- `PlaidSyncDeadLettersAlarm` enters alarm state when any message is visible in the dead-letter queue.
- Both alarms always have an SNS action. Set `BYNKBOOK_ALARM_TOPIC_ARN` to use an approved shared topic; otherwise SST creates the stage-scoped `*-plaid-operations-alarms` topic and returns its ARN as `plaidAlarmTopicArn`.

## Triage order

1. Confirm the AWS account, stage, and alarm resource before reading logs or queue metadata.
2. Check the dead-letter count and oldest-message age. Do not print message bodies because they contain internal business and account identifiers.
3. Correlate the worker error with redacted Lambda and API access logs. Never log or retrieve Plaid access-token plaintext.
4. Determine whether the failure is transient Plaid availability, an Item requiring user reauthentication, missing configuration, or a code/data contract error.
5. For transient failures, use an approved redrive procedure only after the cause is corrected. Queue delivery and transaction sync are idempotent, but redrive remains a production mutation and requires operator approval.
6. For login-required or revoked Items, leave the job failed and direct the user through Plaid update mode. Do not create a replacement Item.
7. Verify the connection's cursor, `has_new_transactions`, `last_sync_at`, and error state after recovery. A capped run must continue draining rather than clearing the update flag early.

## Healthy state

- Dead-letter queue visible count is zero.
- Oldest sync message remains below five minutes.
- Connected Items do not retain a sync error after a successful drain.
- Repeated webhook deliveries do not duplicate imported transactions.
- Matched transactions removed by Plaid retain their accounting history and show the separate source-removal state.

## On-demand Transactions Refresh

- Normal Transactions Items are refreshed by Plaid on the institution's schedule, typically one or more times per day. `SYNC_UPDATES_AVAILABLE` remains the source-of-truth signal that `/transactions/sync` has changes to drain.
- `/transactions/refresh` is a separately priced Transactions add-on. Production access cannot be enabled in BynkBook code or AWS configuration. Request `Transactions Refresh` in the Plaid Dashboard product-access area or through the Plaid account manager, confirm the per-request price, and then verify the production client has access. See Plaid's [Transactions API reference](https://plaid.com/docs/api/products/transactions/#transactionsrefresh).
- A successful refresh request starts an on-demand extraction; it does not guarantee that the immediately following sync already contains the new data. Wait for `SYNC_UPDATES_AVAILABLE`, then let the queue worker drain the cursor.
- Do not retry refresh calls in a tight loop. Plaid bills the endpoint per successful request and applies Item-level rate limits.
- `INVALID_PRODUCT` or `PRODUCT_NOT_ENABLED` means scheduled transaction data is still usable. The UI should report that scheduled data was checked, not present this entitlement state as a failed transaction sync.

## Required production setup

After the first deployment that creates a managed topic, operations must add approved recipients to the returned `plaidAlarmTopicArn`, confirm subscriptions, and perform a controlled non-customer alarm-delivery test. The repository deliberately does not invent notification recipients. Environments with an existing approved topic should continue setting `BYNKBOOK_ALARM_TOPIC_ARN`.
