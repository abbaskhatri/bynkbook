# Bynkbook Production Bridge Current State

Last verified: 2026-07-09

## Executive Warning

Bynkbook production is live and working.

The current production bridge is stable, but it is not a clean greenfield production stack. Some prod-named bridge secrets intentionally point to dev-named live resources. Do not rename, delete, rotate, migrate, replace, or "clean up" these resources casually. Treat the current layout as production truth until a planned cutover replaces it.

No secrets are printed in this document. Secret names, resource IDs, hostnames, and public URLs are documented so operators can avoid accidental production breakage.

## Current Production Truth

### Public App

- Production app URL: `https://app.bynkbook.com`
- Amplify app: `bynkbook`
- Amplify app ID: `d2idm6n6qepkf3`
- Amplify default domain: `d2idm6n6qepkf3.amplifyapp.com`
- Amplify production branch: `main`
- Amplify branch stage: `PRODUCTION`
- Amplify custom domain: `bynkbook.com`
- Active app subdomain: `app.bynkbook.com` -> Amplify branch `main`

### Production API

- Production API ID: `cpjh7t19u1`
- Production API name: `ledrigo-prod-ledrigoprodsstapiApi-urafsnth`
- Production API stage: `$default`
- Production API URL: `https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com`
- Plaid webhook URL: `https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com/v1/plaid/webhook`
- Legacy Plaid webhook compatibility URL: `https://actwy6st05.execute-api.us-east-1.amazonaws.com/v1/plaid/webhook`
- `api.bynkbook.com`: currently unused. It has no active API Gateway mapping in the verified bridge state and must not be created as incidental cleanup.

### Plaid

- Plaid environment: `production`
- Plaid client ID secret name: `ledrigo-prod/plaid/client_id`
- Plaid secret secret name: `ledrigo-prod/plaid/secret`
- Plaid token KMS key ARN: `arn:aws:kms:us-east-1:116846786465:key/7f953e5a-b3c9-4354-9ba9-e4f980717c36`

### Database

- DB URL secret name: `ledrigo-prod/rds/database_url`
- DB CA bundle secret name: `ledrigo-prod/rds/ca_bundle_us_east_1`
- Live DB host identity: `ledrigo-dev-postgres.cy7ki8aoon2k.us-east-1.rds.amazonaws.com`
- Live DB instance identifier: `ledrigo-dev-postgres`
- DB engine: `postgres`

The prod DB secret is a prod-named bridge secret. It points at the dev-named live production database host. Do not delete or rename that dev-named DB as cleanup.

### Uploads

- Upload bucket name: `ledrigo-dev-uploads-116846786465-us-east-1`
- Upload bucket is dev-named but live for production bridge uploads.

### Cognito

- Live production authorizer issuer: `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_tmyPJwsJb`
- Live user pool ID: `us-east-1_tmyPJwsJb`
- Live user pool name: `ledrigo-dev-userpool`
- Live app client ID: `38gus49pnfilbc4u2f7b68ist7`
- Live app client name: `ledrigo-dev-web-client`
- Live hosted UI domain prefix: `ledrigo-dev-auth-116846786465`
- Live hosted UI domain: `https://ledrigo-dev-auth-116846786465.auth.us-east-1.amazoncognito.com`

Stale/risky prod-named Cognito reference:

- User pool ID: `us-east-1_CgE7Dozj4`
- User pool name: `snaxle-prod-UserPoolUserPool-esxdvdxu`
- App client ID: `2iqmddh5hu90ic1os90p59ls1d`
- App client name: `AppClient`
- Hosted UI domain: none verified

Do not switch production auth to the stale prod-named Cognito pool as cleanup.

2026-06-27 incident note:

- Production login was using the live dev-named Cognito pool/client above.
- The API Gateway JWT authorizer had drifted to the stale prod-named Cognito pool/client below, causing `/v1/businesses` to fail with API Gateway `401` before Lambda execution.
- The live API Gateway authorizer was repaired to issuer `us-east-1_tmyPJwsJb` and audience `38gus49pnfilbc4u2f7b68ist7`.
- `infra-sst/sst.config.ts` now refuses prod deploys that would restore the stale Cognito pool/client.

### KMS

- Shared KMS alias: `alias/ledrigo-dev-kms`
- Shared KMS key ID: `7f953e5a-b3c9-4354-9ba9-e4f980717c36`
- Shared KMS key ARN: `arn:aws:kms:us-east-1:116846786465:key/7f953e5a-b3c9-4354-9ba9-e4f980717c36`

### OpenAI

- OpenAI API key secret name: `ledrigo-prod/openai/api_key`
- OpenAI model secret name: `ledrigo-prod/openai/model`

## Resource Classifications

### Clean Prod Resources

- `https://app.bynkbook.com`
- Amplify app `bynkbook` (`d2idm6n6qepkf3`), branch `main`
- API Gateway HTTP API `cpjh7t19u1`
- Prod API URL `https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com`
- Legacy Plaid webhook compatibility route on API `actwy6st05`
- Prod API Gateway names use `ledrigo-prod-*`; generated prod route Lambda names use `ledrig-prod-*`
- Plaid production environment configuration

### Prod-Named Bridge Secrets

- `ledrigo-prod/rds/database_url`
- `ledrigo-prod/rds/ca_bundle_us_east_1`
- `ledrigo-prod/plaid/client_id`
- `ledrigo-prod/plaid/secret`
- `ledrigo-prod/openai/api_key`
- `ledrigo-prod/openai/model`

These names are production-facing and must remain in place until a controlled migration replaces them.

### Dev-Named Live Resources

- RDS instance `ledrigo-dev-postgres`
- RDS host `ledrigo-dev-postgres.cy7ki8aoon2k.us-east-1.rds.amazonaws.com`
- S3 bucket `ledrigo-dev-uploads-116846786465-us-east-1`
- Cognito user pool `ledrigo-dev-userpool` (`us-east-1_tmyPJwsJb`)
- Cognito app client `ledrigo-dev-web-client` (`38gus49pnfilbc4u2f7b68ist7`)
- Cognito hosted UI domain prefix `ledrigo-dev-auth-116846786465`
- KMS alias `alias/ledrigo-dev-kms`

These are dev-named but live production dependencies. Names alone are misleading.

### Unused/Stale References

- `api.bynkbook.com` is currently unused and should not be created or wired as incidental cleanup.
- `bynkbook-web/.env.production` contains `https://api.bynkbook.com` placeholders/stale production API references; do not treat that file as the live production bridge truth without a separate planned config cleanup.
- Stale prod-named Cognito pool `snaxle-prod-UserPoolUserPool-esxdvdxu` (`us-east-1_CgE7Dozj4`) is not the live API authorizer issuer.

### Risky Resources

- Any Plaid route that can connect, disconnect, exchange, or sync bank data.
- Any Lambda or config using `PLAID_ENV=production`.
- Any DB secret or CA bundle secret with `ledrigo-prod/rds/*`.
- Any S3 object data under `ledrigo-dev-uploads-116846786465-us-east-1`.
- Any auth change involving Cognito pool/client/domain replacement.
- Any DNS or API Gateway mapping involving `app.bynkbook.com`, `bynkbook.com`, `api.bynkbook.com`, `cpjh7t19u1`, or the legacy webhook API `actwy6st05`.

## Do-Not-Touch List

- Do not switch Plaid to sandbox.
- Do not delete the dev-named live DB `ledrigo-dev-postgres`.
- Do not delete the dev-named live upload bucket `ledrigo-dev-uploads-116846786465-us-east-1`.
- Do not replace Cognito or switch production to the stale prod-named Cognito pool.
- Do not change the production API URL or DNS casually.
- Do not rotate secrets casually.
- Do not delete bridge secrets.
- Do not create `api.bynkbook.com` as incidental cleanup.
- Do not connect or disconnect bank accounts during infrastructure cleanup.
- Do not trigger Plaid sync as an infrastructure smoke test.
- Do not upload files as an infrastructure cleanup smoke test.
- Do not edit production data.

## Cleanup Phase Plan

### P0: Documentation And Freeze Map

- Record this production bridge truth in the repo.
- Freeze all do-not-touch resources.
- Require explicit review before any cleanup touching auth, API, DB, uploads, Plaid, KMS, secrets, or DNS.

### P1: Low-Risk Docs/Config Cleanup

- Clean stale comments and documentation.
- Clarify which local config files are placeholders versus live production truth.
- Avoid runtime behavior changes.

### P2: Prepare True Prod Resources Without Cutover

- Prepare clean prod-named DB, bucket, Cognito, KMS, and DNS resources separately.
- Do not repoint production traffic.
- Do not delete bridge resources.
- Do not rotate production secrets as part of preparation.

### P3: Migration Rehearsal

- Rehearse DB migration, S3 copy/validation, Cognito auth flow, and API config changes in a non-production rehearsal.
- Define measurable acceptance criteria and rollback steps.
- Keep Plaid operations read-only during rehearsal.

### P4: Controlled Cutover

- Use a maintenance window.
- Repoint one dependency at a time with explicit validation.
- Keep old DB and bucket intact through the confidence window.
- Cut over DNS/API only with a rollback plan already approved.

## Rollback And Cutover Principles

- Maintain the old DB and bucket until the confidence window ends.
- Validate login, ledger, uploads, and Plaid status read-only.
- Never use Plaid sync as an infrastructure cleanup smoke test.
- Use a maintenance window for any real migration.
- Prefer reversible config changes over destructive cleanup.
- Capture before/after resource IDs for every cutover step.

## Decision

Current prod bridge is stable. Cleanup should be planned, rehearsed, and executed only through a controlled migration path.
