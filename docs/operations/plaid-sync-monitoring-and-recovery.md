# Plaid Sync Monitoring and Recovery

## Controls defined in infrastructure

- API Gateway access logs are retained for three months.
- API Gateway applies a default stage throttle. Production defaults to 100 requests/second with a 200-request burst; both values are configurable with `BYNKBOOK_API_RATE_LIMIT` and `BYNKBOOK_API_BURST_LIMIT`.
- Plaid webhooks enqueue sync work in `PlaidSyncQueue` and failed jobs move to `PlaidSyncDeadLetterQueue` after five receives.
- `PlaidSyncBacklogAgeAlarm` enters alarm state when the oldest queued job is over five minutes old for two consecutive one-minute periods.
- `PlaidSyncDeadLettersAlarm` enters alarm state when any message is visible in the dead-letter queue.
- Set `BYNKBOOK_ALARM_TOPIC_ARN` to an approved SNS topic ARN to attach notification delivery to both alarms. The alarms still exist without the variable, but have no outbound notification action.

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

## Required production setup

Before deployment, operations must supply and test an SNS topic through `BYNKBOOK_ALARM_TOPIC_ARN`, confirm subscriptions, and perform a controlled non-customer alarm-delivery test. The repository cannot choose notification recipients on behalf of the business.
