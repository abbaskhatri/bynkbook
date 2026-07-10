# Backend, Data, and Infrastructure Audit

## Inventory

Production API: `cpjh7t19u1`, AWS account `116846786465`, region `us-east-1`.

Thirteen deployed Plaid-related routes were enumerated: 12 direct Plaid routes (link token account/business, exchange, status, repair, preview opening, apply opening, change opening date, disconnect, sync, create account, webhook) plus cleanup-Plaid-overlap. All direct routes use Cognito JWT except the signature-verified webhook.

Data entities: `Account`, `BankConnection`, `BankTransaction`, `Entry`, legacy `BankMatch`, `MatchGroup`, `MatchGroupBank`, `MatchGroupEntry`, `ReconcileSnapshot`, role/policy tables. Important constraints include unique business/account and business/Plaid-account connection mappings, unique business/Plaid-transaction ID, and CSV import dedupe. Missing active-match uniqueness/FK is BYNK-PLAID-AUDIT-004.

## AWS controls

- Plaid Lambdas: Node.js 22; production Plaid environment.
- Sync Lambda: 512 MB, 45-second function timeout; API integration timeout 30 seconds.
- Secrets Manager holds client ID/secret references; KMS is configured for access-token ciphertext.
- Logical Plaid log groups specify 30-day retention. The newest physical functions had not all emitted a log group at inspection time.
- No Plaid EventBridge rule, SQS sync queue, or DLQ was found (BYNK-PLAID-AUDIT-006).
- No direct IAM wildcard defect was established in this scoped pass; broader policy reliability remains existing BYNK-AUDIT-006.
- No production mutation, token exchange, connection, or database write was performed.

## Deployment consistency

The production webhook hostname and Lambda environment agree. The stale supplied hostname is existing BYNK-AUDIT-005. `npx sst build --stage prod` is not a valid SST v3 command and returned CLI usage; this is not evidence of a build defect. Infra and functions TypeScript checks passed, Prisma validation passed with a deprecated preview-feature warning, and the application build passed.

Aggregate production integrity queries were attempted only through a temporary read-only script. Network connection to the private database timed out before query execution; the script was deleted and no data was returned.
