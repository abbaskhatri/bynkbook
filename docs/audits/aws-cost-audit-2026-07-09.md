# AWS Cost Audit - 2026-07-09

Update later on 2026-07-09: the production API endpoint moved from `actwy6st05` to `cpjh7t19u1` during the OpenAI cost-control deploy. `actwy6st05` remains only as a Plaid webhook compatibility route.

Second update on 2026-07-09:

- Lowered the AWS monthly budget target from `$250` to `$100`.
- Added 30-day retention to the remaining legacy Lambda log groups that had unlimited retention.
- Added a 7-day abort-incomplete-multipart-uploads lifecycle rule to the live uploads bucket `ledrigo-dev-uploads-116846786465-us-east-1`.
- Confirmed NAT Gateway data transfer is tiny; its cost is almost entirely the fixed hourly NAT charge.

Third update on 2026-07-09:

- Reduced RDS backup retention for `ledrigo-dev-postgres` from 14 days to 7 days.
- Audited Secrets Manager references against deployed Lambda environment variables.

## Secrets Manager Cleanup Map

Approximate cost: Secrets Manager charges are mostly per secret, so each deleted unused secret saves roughly `$0.40/month`.

### Keep - Production Live

These are referenced by the current production API/Lambda stack and were accessed recently. Do not delete.

| Secret | Lambda env references | Last accessed |
| --- | ---: | --- |
| `ledrigo-prod/rds/database_url` | 144 | 2026-07-08 |
| `ledrigo-prod/rds/ca_bundle_us_east_1` | 144 | 2026-07-08 |
| `ledrigo-prod/plaid/client_id` | 11 | 2026-07-08 |
| `ledrigo-prod/plaid/secret` | 11 | 2026-07-08 |
| `ledrigo-prod/openai/api_key` | 9 | 2026-07-08 |
| `ledrigo-prod/openai/model` | 9 | 2026-07-08 |

### Keep Unless Retiring Dev/Work Stacks

These are not production bridge secrets, but deployed `ledrigo-dev-*` and/or `abbas-workab-*` Lambda functions still reference them. Delete only if the corresponding dev/work APIs and functions are intentionally removed first.

| Secret | Lambda env references | Last accessed |
| --- | ---: | --- |
| `ledrigo-dev/rds/database_url` | 284 | 2026-07-06 |
| `ledrigo-dev/rds/ca_bundle_us_east_1` | 284 | 2026-07-06 |
| `ledrigo-dev/plaid/client_id` | 22 | 2026-07-06 |
| `ledrigo-dev/plaid/secret` | 22 | 2026-07-06 |
| `ledrigo-dev/openai/api_key` | 17 | 2026-06-23 |
| `ledrigo-dev/openai/model` | 17 | 2026-06-23 |

Related deployed non-prod API Gateway IDs:

- `lmvoixj337` - `ledrigo-dev-ledrigodevsstapiApi-bzhskmbm`
- `1ozvddx28a` - `ledrigo-abbas-workabbas-ledrigodevsstapiApi-oemoekho`

### High-Confidence Delete Candidates

These had zero deployed Lambda environment references in the audit and no active app-code references found. Delete by scheduling a Secrets Manager deletion window, not force-delete.

| Secret | Lambda env references | Last accessed | Notes |
| --- | ---: | --- | --- |
| `ledrigo-dev/app` | 0 | never | Placeholder secret. |
| `snaxle-dev-secrets` | 0 | 2026-02-11 | Old Snaxle-era secret name; no BynkBook references found. |

### Additional High-Confidence Delete Candidate After Credential Comparison

| Secret | Lambda env references | Last accessed | Notes |
| --- | ---: | --- | --- |
| `ledrigo-dev/rds/master` | 0 | 2025-12-21 | RDS master username matches `ledrigo_master`; stored username/password match both `ledrigo-dev/rds/database_url` and `ledrigo-prod/rds/database_url`. It is a duplicate credential record, not unique operational data. |
| `ledrigo-dev/rds/connection` | 6 stale refs | 2025-12-22 | Referenced only by old Python Lambdas from Dec 2025: `ledrigo-dev-fn-api-accounts`, `businesses`, `entries`, `ledger-summary`, `me`, and `db-bootstrap`. These had zero invocations in the last 30 days, and their API Gateway permissions point to deleted REST API `q7kszaxyff`. No current production API/Lambda references it. |

Scope: AWS account `116846786465`, profile `ledrigo-dev`, region `us-east-1` unless noted. All inspection was read-only.

## Executive Summary

Current July 2026 forecast is about `$111.07`. The largest avoidable/non-product line item is `AWS Support (Developer)` at `$29.00` month-to-date/forecasted for July.

The core Bynkbook production bridge is small but has fixed hourly infrastructure:

- NAT Gateway: about `$32.40/month`.
- RDS `db.t4g.micro`: about `$15.60/month` plus storage/backups.
- EC2 bastion `t3.micro`: about `$7.49/month`.
- Public IPv4 addresses: about `$7.20/month` for two in-use addresses.
- Secrets Manager: about `$6.20/month` for 16 secrets.
- SST S3 asset/state storage: about `$2.80/month`.

Important: the account has a production bridge where several `ledrigo-dev-*` resources are live production dependencies. Do not delete by name alone.

## Current Cost Shape

Last complete/partial period inspected: `2026-06-09` through `2026-07-09`.

July 1-9 cost highlights:

| Service | Cost |
| --- | ---: |
| AWS Support (Developer) | `$29.00` |
| EC2 - Other | `$8.81` |
| RDS | `$4.15` |
| EC2 Compute | `$2.00` |
| VPC public IPv4 | `$1.92` |
| Secrets Manager | `$1.66` |
| S3 | `$0.74` |
| KMS | `$0.26` |
| Amplify | `$0.13` |
| CloudWatch | `$0.11` |
| API Gateway | `$0.004` |
| Lambda | `$0.00` |

Cost drivers inside key services:

- `EC2 - Other`: `NatGateway-Hours` is `$8.64` for July 1-9. This projects to about `$32.40/month`.
- `VPC`: `USE1-PublicIPv4:InUseAddress` is `$1.92` for July 1-9. This is two public IPv4 addresses and projects to about `$7.20/month`.
- `RDS`: `InstanceUsage:db.t4g.micro` is `$3.07` for July 1-9; storage/backup add about `$1.08`.
- `Secrets Manager`: secret storage is `$1.65` for July 1-9; API calls are negligible.
- `S3`: mostly `TimedStorage-ByteHrs`; requests/data transfer are negligible.

## Production Do-Not-Touch

These are live Bynkbook dependencies even though some are dev-named:

- RDS instance `ledrigo-dev-postgres`
- RDS host `ledrigo-dev-postgres.cy7ki8aoon2k.us-east-1.rds.amazonaws.com`
- Upload bucket `ledrigo-dev-uploads-116846786465-us-east-1`
- Cognito pool `us-east-1_tmyPJwsJb` / `ledrigo-dev-userpool`
- Cognito app client `38gus49pnfilbc4u2f7b68ist7`
- KMS key `7f953e5a-b3c9-4354-9ba9-e4f980717c36`
- Production API `cpjh7t19u1`
- Legacy Plaid webhook compatibility API `actwy6st05`
- Production bridge secrets under `ledrigo-prod/*`

Avoid any cleanup that renames, deletes, rotates, repoints, or replaces these without a separate cutover plan.

## Findings And Recommendations

### 1. AWS Support Developer Plan

Finding: `AWS Support (Developer)` is `$29.00` in July.

Savings: about `$29/month`.

Risk: none to app runtime. This only changes AWS support entitlement.

Recommendation: downgrade/cancel Developer Support if not actively needed. This is the safest and largest single reduction.

### 2. NAT Gateway

Finding: one NAT Gateway exists:

- `nat-0b6d8ff4c2d188e57`
- VPC `vpc-095b58b2592857bcf`
- subnet `subnet-005811466c31f75f0`
- public IP `100.51.14.82`

Savings if removed: about `$32/month`, plus one public IPv4 address cost.

Risk: high if removed directly. VPC Lambda functions use private subnets and need outbound access for Secrets Manager, Plaid, OpenAI, S3/Textract flows, and other AWS/external services. Removing the NAT Gateway without replacement would likely break production API behavior.

Recommendation: do not delete directly. Consider a planned architecture change:

- Add VPC endpoints for AWS services used by Lambdas, especially Secrets Manager, KMS, S3 gateway endpoint, CloudWatch Logs, and possibly Textract/STS where applicable.
- Keep NAT only if Plaid/OpenAI/external internet traffic still requires it.
- If monthly cost matters more than managed reliability, evaluate replacing NAT Gateway with a small NAT instance. This can save about `$20/month` net but is less reliable and needs maintenance, so it is not a no-risk app-safe change.

### 3. Running Bastion EC2

Finding: one running EC2 instance exists:

- `i-0dcd2636e64dd238e`
- name `ledrigo-dev-ssm-bastion`
- type `t3.micro`
- public IP `100.30.200.92`
- VPC `vpc-095b58b2592857bcf`

Savings if stopped/replaced: about `$7.49/month` compute plus about `$3.60/month` public IPv4 if the address can be released/removed. EBS volume remains about `$0.64/month`.

Risk: medium. It likely exists for database/admin access, not app runtime. Stopping it should not affect Lambda/API traffic, but it may affect operator access to RDS.

Recommendation: confirm whether anyone still uses the bastion. If not, stop it first, verify app health, then later remove/rebuild access using SSM Session Manager on demand or a temporary bastion.

### 4. Public IPv4 Charges

Finding: July VPC IPv4 charges show two in-use public IPv4 addresses:

- NAT Gateway EIP `100.51.14.82`
- EC2 bastion public IP `100.30.200.92`

Savings: about `$3.60/month` per removed public IPv4.

Recommendation: removing the bastion public IP is the safest candidate after confirming the bastion is not needed. The NAT public IP must remain while NAT Gateway remains.

### 5. RDS

Finding: one RDS instance exists:

- `ledrigo-dev-postgres`
- `db.t4g.micro`
- 20 GB gp3
- backup retention 14 days
- private, not Multi-AZ
- deletion protection enabled

Savings: limited without migration. Instance is already small.

Risk: very high if stopped/deleted/replaced casually. This is the live production database per the bridge doc.

Recommendation:

- Keep the DB.
- Consider lowering backup retention only if business recovery needs allow it. Current 14-day retention costs roughly `$1.80/month` projected for charged backup usage, so savings are small.
- Longer-term: move to a cleaner prod-named DB only through a rehearsed migration/cutover.

### 6. Secrets Manager

Finding: 16 secrets exist; storage costs project to about `$6.20/month`.

Likely active/live secrets:

- `ledrigo-prod/rds/database_url`
- `ledrigo-prod/rds/ca_bundle_us_east_1`
- `ledrigo-prod/plaid/client_id`
- `ledrigo-prod/plaid/secret`
- `ledrigo-prod/openai/api_key`
- `ledrigo-prod/openai/model`
- active dev equivalents accessed in June/July

Cleanup candidates based on old/empty access:

- `snaxle-dev-secrets` last accessed `2026-02-11`
- `ledrigo-dev/app` never accessed
- `ledrigo-dev/rds/master` last accessed `2025-12-21`
- `ledrigo-dev/rds/connection` last accessed `2025-12-22`

Savings: about `$0.40/month` per deleted secret.

Risk: low-to-medium. Some may be historical/admin credentials. Do not delete until their values are backed up or confirmed obsolete.

Recommendation: tag candidates as `cleanup:candidate`, wait a confidence period, then schedule deletion with a recovery window.

### 7. DynamoDB And S3 Storage

Finding: DynamoDB now has no tables in this AWS account. The old Snaxle tables were deleted during cleanup, and no Lambda environment variables reference DynamoDB table names.

Finding: three S3 buckets exist:

- live uploads: `ledrigo-dev-uploads-116846786465-us-east-1`, 91 objects, about 4.6 MB
- SST assets: `sst-asset-budakabokxmv`, 530 current objects, about 1.15 GB after deleting source maps
- SST state: `sst-state-budakabokxmv`, versioning enabled, 1,702 current objects, about 7.8 GB current data, plus about 103.5 GB across noncurrent versions

The uploads bucket is directly used by BynkBook upload/reconcile Lambda functions through `UPLOADS_BUCKET_NAME`. The asset and state buckets are SST infrastructure buckets. The asset bucket previously held about 42.4 GB of source maps under `sourcemap/`; those debug artifacts were deleted after confirming they are not app runtime data. The state bucket has many old event log/state versions and should be reduced by lifecycle, not manual deletion of current state.

Savings: source-map deletion removed about 42.4 GB immediately. Lifecycle cleanup should continue trimming noncurrent state versions over time.

Risk: medium if deleting current SST state. Low if using lifecycle rules for old source maps/noncurrent versions while retaining recent/current state.

Recommendation:

- Do not delete the uploads bucket.
- Do not delete any bucket outright.
- Do not delete the state bucket.
- Keep lifecycle expiration for future asset/source-map objects after 30 days.
- Keep lifecycle expiration for noncurrent versions in `sst-state-budakabokxmv` after 30 days.
- Keep current versions and recent deploy artifacts.

### 8. Stale SST Stages / Lambdas / APIs

Finding: Lambda/API resources exist for:

- `ledrig-prod`: 146 generated route Lambda functions for production API `cpjh7t19u1`
- `ledrigo-dev`: 150 Lambda functions, dev API `lmvoixj337`
- `abbas-workab`: 146 Lambda functions, API `1ozvddx28a`
- `snaxle`: 2 older Lambda functions

Lambda itself is currently `$0.00`; API Gateway is almost zero. Log storage is tiny.

Savings: small today, but cleanup reduces clutter and future confusion.

Risk: low for `abbas-workab` if confirmed unused. Higher for `ledrigo-dev` because dev-named resources are part of the current production bridge story.

Recommendation:

- Confirm whether `abbas-workabbas` is an abandoned personal stage.
- If abandoned, remove through SST/Pulumi rather than manual Lambda deletion.
- Do not remove `ledrigo-dev` or `ledrigo-prod` stages during cost cleanup.

### 9. CloudWatch Logs

Finding: CloudWatch cost is low and log groups mostly have 30-day retention. Amplify log group has no retention but only about 13.9 MB stored.

Savings: negligible.

Recommendation: set retention on `/aws/amplify/d2idm6n6qepkf3` to 30 or 90 days for hygiene, not major savings.

## Prioritized Action Plan

1. Downgrade/cancel AWS Developer Support if not actively needed. Expected savings: about `$29/month`.
2. Stop the bastion after confirming it is not in active use. Verify app health. Expected savings while stopped: about `$7.49/month`; more if public IPv4 is removed.
3. Add lifecycle policies to SST asset/state buckets. Expected savings: up to about `$2.80/month`; meaningful clutter reduction.
4. Tag and later remove unused Secrets Manager candidates. Expected savings: about `$1.60/month` for four likely stale secrets.
5. Confirm and remove abandoned `abbas-workabbas` SST stage through SST. Expected direct savings: low, but reduces risk/confusion.
6. Explore NAT Gateway replacement only as a planned architecture task. Potential savings: about `$20-$35/month`, but this is the riskiest optimization and should be tested in dev first.

## Not Recommended

- Do not delete `ledrigo-dev-postgres`.
- Do not delete `ledrigo-dev-uploads-116846786465-us-east-1`.
- Do not delete prod bridge secrets.
- Do not remove NAT Gateway without a tested replacement.
- Do not remove the `ledrigo-dev` stage simply because it is dev-named.
- Do not change Cognito, Plaid, DNS, API Gateway mappings, or KMS during cost cleanup.

## Actions Applied 2026-07-09

All changes below were made with AWS profile `ledrigo-dev` in account `116846786465`.

- Stopped EC2 bastion `i-0dcd2636e64dd238e` (`ledrigo-dev-ssm-bastion`). Verified final state: `stopped`.
- Added lifecycle policy to `sst-asset-budakabokxmv`:
  - expire `sourcemap/` objects after 30 days
  - abort incomplete multipart uploads after 7 days
- Added lifecycle policy to `sst-state-budakabokxmv`:
  - expire `eventlog/` objects after 90 days
  - expire noncurrent object versions after 30 days
  - delete expired object delete markers
  - abort incomplete multipart uploads after 7 days
- Set `/aws/amplify/d2idm6n6qepkf3` CloudWatch log retention to 30 days.
- Deleted all current objects under `sst-asset-budakabokxmv/sourcemap/`:
  - before deletion: 6,126 source-map objects, about 42.4 GB
  - after deletion: `sourcemap/` has 0 current objects
  - `sst-asset-budakabokxmv` now has 530 current objects, about 1.15 GB
- Confirmed DynamoDB has no remaining tables.

Post-change verification:

- Production API health endpoint returned `200` with `{"ok":true,"service":"bynkbook-api"}`.
- `https://app.bynkbook.com` returned `200` and page title `BynkBook`.

Expected monthly savings from applied changes:

- Bastion stopped: about `$7.49/month` EC2 compute.
- Bastion public IPv4 no longer attached while stopped: about `$3.60/month`.
- SST lifecycle cleanup: up to about `$2.80/month` after lifecycle expiration processes old objects.
- Log retention: negligible dollar savings, but prevents unbounded growth.

Remaining manual action:

- Cancel/downgrade AWS Developer Support in the AWS Billing/Support console if not needed. Expected savings: `$29/month`.
