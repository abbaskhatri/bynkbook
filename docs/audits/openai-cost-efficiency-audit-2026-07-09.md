# OpenAI API Cost Efficiency Audit - 2026-07-09

## Scope

Audited BynkBook OpenAI usage in the backend and production AWS configuration. The app uses OpenAI only for suggestion/explanation features; core ledger, reports, imports, matching, anomaly checks, and bookkeeping persistence remain deterministic.

Official cost guidance used:

- OpenAI cost optimization guide: https://developers.openai.com/api/docs/guides/cost-optimization
- OpenAI pricing page: https://developers.openai.com/api/docs/pricing
- OpenAI models page: https://developers.openai.com/api/docs/models

## Current Live Setting

- Production model secret: `ledrigo-prod/openai/model`
- Current value: `gpt-4.1-mini`
- Decision: kept this model for now because it is already a small model and is used through existing Chat Completions and Responses code paths. A later move to a newer low-cost model should be tested route-by-route before changing production.

## Paid AI Surfaces Found

1. `POST /v1/ai/merchant-normalize`
   - Suggestion only.
   - Small prompt and output.

2. `POST /v1/ai/explain-entry`
   - Explains a single entry from selected fields.
   - Suggestion/explanation only.

3. `POST /v1/ai/explain-report`
   - Explains supplied report summary.
   - Risk was oversized summaries.

4. `POST /v1/ai/suggest-reconcile-bank`
   - Re-ranks candidate entry matches.
   - Risk was sending too many candidates and asking for too many output tokens.

5. `POST /v1/ai/suggest-reconcile-entry`
   - Re-ranks candidate bank transaction matches.
   - Same risk as bank-side reconcile.

6. `POST /v1/ai/chat`
   - Dashboard Ask AI using aggregates only.
   - Risk was large aggregate payloads and longer completions.

7. `POST /v1/businesses/{businessId}/ai/category-suggestions`
   - Mostly deterministic. OpenAI fallback only for ambiguous rows.
   - Biggest risk was up to 40 ambiguous rows in one fallback request.

8. `POST /v1/businesses/{businessId}/accounts/{accountId}/issues/bulk-preview`
   - Duplicate review helper.
   - Biggest risk was up to 30 issue items and 3000 output tokens.

## No-Cost / Deterministic AI-Labeled Surface

- `POST /v1/ai/anomalies`
  - Deterministic rule-based anomaly detection.
  - Previously fetched OpenAI secrets before route dispatch even though it did not call OpenAI.
  - Fixed so this path no longer touches OpenAI config.

## Changes Made

### General AI handler

File: `infra-sst/packages/functions/src/ai.ts`

- Reduced per-business burst limiter from 20 requests/minute to 8 requests/minute.
- Removed OpenAI config loading before deterministic anomaly route dispatch.
- Added prompt text clipping for payee, memo, question, report summary, and aggregate payloads.
- Reduced completion caps:
  - merchant normalize: 120 -> 90 tokens
  - explain entry: 320 -> 220 tokens
  - explain report: 420 -> 280 tokens
  - reconcile bank/entry: 420 -> 260 tokens
  - dashboard chat: 600 -> 350 tokens
- Reduced reconcile candidates from 12 to 8.
- Captured OpenAI token usage from responses into activity log payloads as `openaiUsage`.

### Category suggestion fallback

File: `infra-sst/packages/functions/src/aiCategorySuggestions.ts`

- Added `AI_CATEGORY_FALLBACK_MAX_ROWS`.
- Default cap is now 12 ambiguous rows instead of 40.
- Clipped merchant/payee/memo text before sending to OpenAI.
- Reduced output cap from `min(2600, 900 + rows * 70)` to `min(1200, 500 + rows * 45)`.

### Duplicate issue review

File: `infra-sst/packages/functions/src/issuesDuplicateReviewAI.ts`

- Added `OPENAI_DUPLICATE_REVIEW_MAX_ITEMS`.
- Default cap is now 12 items instead of 30.
- Added `OPENAI_DUPLICATE_REVIEW_MAX_OUTPUT_TOKENS`.
- Default output cap is now 1000 tokens instead of 3000.

### SST / deployment config

File: `infra-sst/sst.config.ts`

- Reduced `AI_DAILY_LIMIT` defaults:
  - prod: 1000 -> 100 paid AI calls/business/day
  - non-prod: 500 -> 25 paid AI calls/business/day
- Added override envs for intentional future tuning:
  - `BYNKBOOK_AI_DAILY_LIMIT`
  - `BYNKBOOK_AI_CATEGORY_FALLBACK_MAX_ROWS`
  - `BYNKBOOK_OPENAI_DUPLICATE_REVIEW_MAX_ITEMS`
  - `BYNKBOOK_OPENAI_DUPLICATE_REVIEW_MAX_OUTPUT_TOKENS`
- Made OpenAI secret/env wiring explicit for the category suggestions Lambda.

## Expected Cost Impact

These changes reduce both request volume and tokens per request. The biggest practical reductions are:

- Category fallback worst-case rows: 40 -> 12, about 70% fewer ambiguous rows sent per request.
- Duplicate review worst-case items: 30 -> 12, about 60% fewer items sent per request.
- Duplicate review output cap: 3000 -> 1000, about 67% lower maximum output spend.
- Dashboard chat output cap: 600 -> 350, about 42% lower maximum output spend.
- Reconcile candidates: 12 -> 8, about 33% smaller candidate prompt.

Actual savings depend on usage, but this makes the paid AI features behave like lightweight assistive features instead of open-ended AI workloads.

## Things Not Changed

- Did not change the production model secret away from `gpt-4.1-mini`.
- Did not remove any AI feature from the UI.
- Did not change core accounting behavior.
- Did not add Batch or Flex processing. OpenAI recommends them for async/lower-priority workloads, but these BynkBook AI routes are currently interactive UI requests, so the simpler and safer saving is token/request reduction.

## Verification

- `npm run typecheck` in `infra-sst` passed.
- Deployed backend cost controls to production API `cpjh7t19u1`.
- Updated Amplify production env `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_API_BASE_URL` to `https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com`.
- Amplify release job `295` succeeded.
- Verified production API health at `https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com/v1/health`.
- Verified live AI env caps: `AI_DAILY_LIMIT=100`, `AI_CATEGORY_FALLBACK_MAX_ROWS=12`, `OPENAI_DUPLICATE_REVIEW_MAX_ITEMS=12`, and `OPENAI_DUPLICATE_REVIEW_MAX_OUTPUT_TOKENS=1000`.
- Updated Plaid Lambda `PLAID_WEBHOOK_URL` envs to `https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com/v1/plaid/webhook`.
- Added old API compatibility route `https://actwy6st05.execute-api.us-east-1.amazonaws.com/v1/plaid/webhook`; unsigned test requests reach the webhook Lambda and return `Invalid Plaid webhook signature`.

## Recommended Next Steps

1. After 7 days, inspect activity logs grouped by `payloadJson.scope` and `payloadJson.openaiUsage.total_tokens`.
2. If quality is still acceptable, test a staging model downgrade route-by-route before changing prod. Candidate routes for a cheaper model first: merchant normalize, reconcile rerank, category fallback.
