# AWS, deployment, and observability audit

## Mandatory account check

Command:

```powershell
aws sts get-caller-identity --profile ledrigo-dev --query Account --output text
```

Result: failed — `The config profile (ledrigo-dev) could not be found`.

The expected account `116846786465` was therefore **not verified**. In accordance with the audit brief, all AWS CLI inspection stopped. No other profile/account was used.

## What was not inspected

API Gateway resources/stages/authorizers/access logs; Lambda configuration, versions, timeouts, failures, throttles, concurrency, and logs; DynamoDB; Cognito clients/domains/policies; S3 public access/encryption/versioning/lifecycle/CORS; CloudFront policies; Route 53; IAM roles/policies; CloudWatch alarms/log retention/errors; EventBridge/SQS/SNS/SES; Secrets Manager/Parameter Store metadata; RDS configuration/backups/deletion protection; stack/drift/orphan state; Amplify environment variables/build history; and production data.

## Repository-declared AWS architecture

| Service | Repository evidence | Deployment status this audit |
|---|---|---|
| API Gateway HTTP API | SST 148 routes, JWT authorizer, CORS | Public current endpoint responds; resource config unverified |
| Lambda | Node 22 handlers, VPC, secrets/KMS/log permissions | Unverified |
| PostgreSQL/RDS | Prisma/PG; prior docs name RDS bridge | Unverified |
| Cognito | Amplify config + SST JWT issuer/audience | Public auth UI works; deployed config unverified |
| S3 | upload/export bucket env and scoped permissions | Unverified |
| KMS | Plaid token and upload permissions | Unverified |
| Textract | AnalyzeExpense permission | Unverified |
| Secrets Manager | DB, CA, Plaid, OpenAI names | Values not read; metadata unverified |
| CloudWatch | Lambda log permissions; prior retention docs | Errors/alarms unverified |
| Amplify/CloudFront | operations docs and live response | `app.bynkbook.com` 200 via CloudFront |
| Route 53/DNS | public resolution tests | app/current API resolve; old API does not |

No DynamoDB, EventBridge, SQS, SNS, SES, payment processor, or customer email-sending integration is represented in current application code. Absence from code is not proof of absence in the account.

## Safe public production evidence

- `HEAD https://app.bynkbook.com/` → 200 through CloudFront.
- `GET https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com/v1/health` → 200 JSON.
- `GET .../v1/businesses` without token → 401.
- Trusted CORS preflight → 204 with exact allowed origin/method/header values.
- Untrusted CORS preflight → 204 without allow-origin.
- Live ledger JavaScript bundle contains the `cpjh7t19u1` base URL.
- `actwy6st05.execute-api.us-east-1.amazonaws.com` failed DNS resolution (`005`).
- Public web response lacks baseline security headers and exposes Next.js (`010`).

## Repository/deployment consistency

The live web/API pair agrees with current repository preflight/docs (`cpjh7t19u1`). The user-supplied brief and repository historical compatibility notes disagree (`actwy6st05`). The tracked `.env.production` disagrees with both and points to unused `api.bynkbook.com` (`011`). This creates three competing configuration sources.

The repository's bridge document says production intentionally uses dev-named RDS, S3, Cognito, and KMS resources (`014`). Those details must not be treated as newly verified. The pre-existing user edit to generated `infra-sst/sst-env.d.ts` changes its resource type name from dev to prod; it was preserved and excluded from the audit commit.

## IAM review from code only

Positive: Secrets Manager and KMS permissions are ARN-scoped; S3 permissions are bucket/prefix-scoped; Plaid credential permissions use named secrets. Broad permissions: CloudWatch Logs resources are `*`, and Textract `AnalyzeExpense` uses `*` because that API does not support conventional resource scoping. Effective generated IAM could not be evaluated.

## Observability gaps

SST code does not define API access logging, alarms, dashboards, WAF/rate limits, or correlation IDs. ActivityLog provides business-event history, not infrastructure telemetry. Console logging is inconsistent and one Textract path logs a raw error object. Prior docs describe log retention/cost, but current errors, failed invocations, latency, throttles, and alarm delivery are unknown (`012`,`013`).

## Deployment workflow

Repository operations docs say Amplify deploys `main`; no GitHub Actions workflow was found. SST deploy/remove scripts exist but were not run. `.env.production` is not trustworthy standalone. `sst build/synth` was skipped after the AWS hard stop (`022`). Rollback appears dependent on Git/Amplify/SST and preservation of bridge resources; no independently tested rollback/restore evidence was available.

## Required follow-up AWS read-only checklist

After exact STS verification only:

1. Export resource inventory by service/region and map every ID to SST or bridge documentation.
2. Inspect API stages/routes/authorizers/CORS/access logs and both API IDs.
3. Inspect Lambda env **names only**, runtime, timeout, concurrency, recent errors/throttles, and log retention.
4. Inspect Cognito issuer/audience/callback/logout URLs, password/MFA policies, and stale pools.
5. Inspect RDS engine/version/storage/encryption/deletion protection/backup/PITR and recent events; do not query customer rows until approved.
6. Inspect S3 public-access block, policy, encryption, versioning, lifecycle, CORS, and logging without listing customer object names.
7. Inspect KMS key policy/rotation and Secrets Manager metadata without values.
8. Inspect IAM generated roles for wildcard actions/resources.
9. Inspect CloudWatch alarms/dashboards and sample recent errors with PII redaction.
10. Verify Amplify environment variable names/approved public values and build/rollback state.

No AWS resource, DNS record, secret, S3 object, deployment, or production record was changed.
