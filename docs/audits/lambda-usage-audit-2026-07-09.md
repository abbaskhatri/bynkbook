# Lambda Usage Audit - 2026-07-09

Scope: AWS account `116846786465`, profile `ledrigo-dev`, region `us-east-1`.

Goal: identify which Lambda functions are used by the BynkBook app, which are only dev/work stacks, and which are idle/stale cleanup candidates.

## Summary

Total Lambda functions before cleanup: `444`.
Total Lambda functions after cleanup: `434`.

| Family | Count | Reachability | 30-day invocations | 90-day invocations | Recommendation |
| --- | ---: | --- | ---: | ---: | --- |
| Current prod SST route Lambdas: `ledrig-prod-ledrigoprodsstapi*` | 146 | Current production API `cpjh7t19u1` | 2 nonzero / 144 zero | 2 nonzero / 144 zero | Keep. Zero traffic on a route does not mean unused; these are reachable production app routes. |
| Legacy Plaid webhook compatibility | 1 route | Old API `actwy6st05` routes to current prod webhook Lambda | n/a | n/a | Keep until Plaid webhook migration is fully verified. |
| Dev SST API: `ledrigo-dev-ledrigodevsstapi*` | 142 | Dev API `lmvoixj337` | 29 nonzero / 113 zero | 56 nonzero / 86 zero | Keep if dev environment is still used. Remove only by intentionally retiring dev stack. |
| Abbas work SST API: `abbas-workab-ledrigodevsstapi*` | 146 | Work API `1ozvddx28a` | 0 nonzero / 146 zero | 0 nonzero / 146 zero | Strong cleanup candidate if this work stack is no longer needed. |
| Old standalone Lambdas: `ledrigo-dev-fn-*` | 8 | Old REST API references are gone/stale | 0 nonzero / 8 zero | 0 nonzero / 8 zero | High-confidence cleanup candidate. |
| Snaxle search projectors: `snaxle-*SearchProjectorFunction*` | 2 | Enabled DynamoDB stream mappings to old Snaxle tables | 0 nonzero / 2 zero | 0 nonzero / 2 zero | Cleanup candidate if Snaxle stacks/tables are no longer needed. |

## Current Production App

Amplify production points to:

- `NEXT_PUBLIC_API_URL=https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com`

API Gateway:

| API ID | Name | Routes | Lambda integrations | Status |
| --- | --- | ---: | ---: | --- |
| `cpjh7t19u1` | `ledrigo-prod-ledrigoprodsstapiApi-urafsnth` | 146 | 146 | Current production API. Keep. |
| `actwy6st05` | `ledrigo-prod-ledrigodevsstapiApi-bdsbmssr` | 1 | 1 | Legacy Plaid webhook compatibility route. Keep for now. |

Note: the API Gateway names use `ledrigo-prod-*`, while the generated prod route Lambda function names use `ledrig-prod-*`.

The current production API has many route Lambdas with zero recent invocations. That is normal for a route-per-Lambda deployment when a feature has not been clicked recently. They are still reachable from the app and should not be deleted individually.

## Non-Production APIs

| API ID | Name | Routes | Lambda integrations | 90-day signal | Recommendation |
| --- | --- | ---: | ---: | --- | --- |
| `lmvoixj337` | `ledrigo-dev-ledrigodevsstapiApi-bzhskmbm` | 142 | 142 | Some route traffic in last 90 days. | Keep unless we intentionally retire dev. |
| `1ozvddx28a` | `ledrigo-abbas-workabbas-ledrigodevsstapiApi-oemoekho` | 146 | 146 | Zero invocations across all 146 functions in last 90 days. | Strong cleanup candidate. |

## High-Confidence Stale Standalone Lambdas

These are old Dec 2025 standalone functions. They are not part of the current SST prod API, not part of the current dev/work SST route pattern, and had zero invocations in the last 90 days.

| Function | Runtime | Evidence |
| --- | --- | --- |
| `ledrigo-dev-fn-api-accounts` | `python3.12` | Old permission points to deleted REST API `q7kszaxyff`; zero invocations in 90 days. |
| `ledrigo-dev-fn-api-businesses` | `python3.12` | Old permission points to deleted REST API `q7kszaxyff`; zero invocations in 90 days. |
| `ledrigo-dev-fn-api-entries` | `python3.12` | Old permission points to deleted REST API `q7kszaxyff`; zero invocations in 90 days. |
| `ledrigo-dev-fn-api-ledger-summary` | `python3.12` | Old permission points to deleted REST API `q7kszaxyff`; zero invocations in 90 days. |
| `ledrigo-dev-fn-api-me` | `python3.12` | Old permission points to deleted REST API `q7kszaxyff`; zero invocations in 90 days. |
| `ledrigo-dev-fn-db-bootstrap` | `python3.12` | No active trigger found; zero invocations in 90 days. |
| `ledrigo-dev-fn-api-health` | `nodejs22.x` | Old standalone health Lambda; no env; zero invocations in 90 days. |
| `ledrigo-dev-fn-vpc-rds-smoke` | unknown from summary scan | Old smoke-test Lambda; zero invocations in 90 days. |

These are the safest Lambda deletion candidates.

## Snaxle Projectors

These are not BynkBook app route Lambdas. They have enabled DynamoDB stream event source mappings, but zero invocations in 90 days.

| Function | Event source mappings | Recommendation |
| --- | ---: | --- |
| `snaxle-dev-SearchProjectorFunction-mehrsnoe` | 2 enabled DynamoDB streams | Remove only if old Snaxle dev resources are no longer needed. |
| `snaxle-dev2-SearchProjectorFunction-kszococr` | 2 enabled DynamoDB streams | Remove only if old Snaxle dev2 resources are no longer needed. |

Related Snaxle DynamoDB tables still present:

- `snaxle-dev-CanonicalTableTable-evbamktw`
- `snaxle-dev-ReadModelsTableTable-rnttvuae`
- `snaxle-dev2-CanonicalTableTable-dtcuoxoe`
- `snaxle-dev2-ReadModelsTableTable-bdvmvhus`
- `snaxle-pipeline-staging-runs`
- `snaxle-pipeline-staging-stage-state`

## Trigger Audit

- API Gateway v2 route integrations were checked for all known HTTP APIs.
- API Gateway REST APIs: none currently listed. Old standalone Lambda permissions reference deleted REST API `q7kszaxyff`.
- Lambda event source mappings: only the two Snaxle projector functions have enabled mappings.
- EventBridge rules with Lambda targets: none found.
- EventBridge Scheduler Lambda targets: none found.

## Cost Note

Idle Lambda functions usually do not create meaningful runtime cost by themselves. AWS Lambda charges mostly on invocations and compute duration. Cleanup still matters because it:

- reduces clutter and accidental use,
- removes stale IAM roles/policies/log groups over time,
- unlocks related cleanup such as old API Gateways, DynamoDB tables, and Secrets Manager secrets.

## Recommended Cleanup Order

1. Delete the 8 old standalone `ledrigo-dev-fn-*` Lambdas and their log groups after one final confirmation.
2. If no longer needed, remove the full `abbas-workab` SST/API stack (`1ozvddx28a`, 146 route Lambdas).
3. Decide whether Snaxle dev/dev2 resources are still needed. If not, remove Snaxle projectors, event source mappings, and related DynamoDB tables together.
4. Keep current prod `cpjh7t19u1` and legacy Plaid webhook compatibility `actwy6st05`.
5. Keep dev `lmvoixj337` unless the dev environment can be intentionally retired.

## Deletion Plan For Non-BynkBook Resources

User confirmed Snaxle uses a separate AWS account now, so Snaxle resources in this account are not needed for BynkBook.

### Safe To Delete For BynkBook Production

These are not used by the live BynkBook app.

Old standalone BynkBook/bootstrap Lambdas:

- `ledrigo-dev-fn-api-accounts`
- `ledrigo-dev-fn-api-businesses`
- `ledrigo-dev-fn-api-entries`
- `ledrigo-dev-fn-api-ledger-summary`
- `ledrigo-dev-fn-api-me`
- `ledrigo-dev-fn-db-bootstrap`
- `ledrigo-dev-fn-api-health`
- `ledrigo-dev-fn-vpc-rds-smoke`

Associated stale secrets:

- `ledrigo-dev/app`
- `ledrigo-dev/rds/master`
- `ledrigo-dev/rds/connection`
- `snaxle-dev-secrets`

Snaxle Lambdas:

- `snaxle-dev-SearchProjectorFunction-mehrsnoe`
- `snaxle-dev2-SearchProjectorFunction-kszococr`

Snaxle event source mappings:

- `01c602c2-7e1d-429c-aff6-719de2a3c9c6`
- `d50d153f-e83d-47f0-b945-b7e3b5892963`
- `b0f1198f-1c67-424e-97ca-50528f9944c0`
- `f6395781-7bc0-4f34-96d2-4be6bc46b000`

Snaxle DynamoDB tables:

- `snaxle-dev-CanonicalTableTable-evbamktw` - 0 items, 0 bytes.
- `snaxle-dev-ReadModelsTableTable-rnttvuae` - 0 items, 0 bytes.
- `snaxle-dev2-CanonicalTableTable-dtcuoxoe` - 19 items, 3438 bytes.
- `snaxle-dev2-ReadModelsTableTable-bdvmvhus` - 42 items, 18177 bytes.
- `snaxle-pipeline-staging-runs` - 27 items, 29631 bytes.
- `snaxle-pipeline-staging-stage-state` - 15 items, 7202 bytes.

### Cleanup Completed

Completed on 2026-07-09:

- Deleted 8 old standalone `ledrigo-dev-fn-*` Lambda functions.
- Deleted associated old standalone Lambda log groups.
- Deleted 2 Snaxle Lambda functions:
  - `snaxle-dev-SearchProjectorFunction-mehrsnoe`
  - `snaxle-dev2-SearchProjectorFunction-kszococr`
- Deleted associated Snaxle Lambda log groups.
- Deleted 4 Snaxle DynamoDB stream event source mappings:
  - `01c602c2-7e1d-429c-aff6-719de2a3c9c6`
  - `d50d153f-e83d-47f0-b945-b7e3b5892963`
  - `b0f1198f-1c67-424e-97ca-50528f9944c0`
  - `f6395781-7bc0-4f34-96d2-4be6bc46b000`
- Deleted 6 Snaxle DynamoDB tables:
  - `snaxle-dev-CanonicalTableTable-evbamktw`
  - `snaxle-dev-ReadModelsTableTable-rnttvuae`
  - `snaxle-dev2-CanonicalTableTable-dtcuoxoe`
  - `snaxle-dev2-ReadModelsTableTable-bdvmvhus`
  - `snaxle-pipeline-staging-runs`
  - `snaxle-pipeline-staging-stage-state`
- Scheduled 7-day Secrets Manager deletion for:
  - `ledrigo-dev/app`
  - `snaxle-dev-secrets`
  - `ledrigo-dev/rds/master`
  - `ledrigo-dev/rds/connection`

Post-cleanup verification:

- Old standalone and Snaxle Lambda function queries returned no remaining functions.
- Lambda event source mappings query returned no remaining mappings.
- Snaxle DynamoDB table query returned no remaining tables.
- Stale secrets show `DeletedDate` and are recoverable during the deletion window.
- Live production API health returned 200.
- `https://app.bynkbook.com` returned 200.
- Legacy Plaid webhook compatibility route returned `Invalid Plaid webhook signature` for an unsigned test request, confirming it reaches the webhook Lambda.

### Safe For Production But Confirm Before Delete

The full `abbas-workab` API stack is not used by production BynkBook and had zero Lambda invocations in 90 days. It may still be an old personal/work test stack, so confirm before deleting it.

- API Gateway HTTP API `1ozvddx28a` - `ledrigo-abbas-workabbas-ledrigodevsstapiApi-oemoekho`
- 146 Lambdas with prefix `abbas-workab-ledrigodevsstapi*`

### Keep

- Current production API `cpjh7t19u1` and its 146 prod route Lambdas.
- Legacy Plaid webhook compatibility API `actwy6st05`, currently one route into the current prod Plaid webhook Lambda.
- Dev API `lmvoixj337` and its 142 dev route Lambdas unless we intentionally retire the dev BynkBook environment.
