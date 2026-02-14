/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "ledrigo",
      home: "aws",
    };
  },

  async run() {
    const api = new sst.aws.ApiGatewayV2("ledrigo-dev-sst-api", {
      cors: {
        allowHeaders: ["authorization", "content-type"],
        allowMethods: ["GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"],
        allowOrigins:
  $app.stage === "prod"
    ? ["https://app.bynkbook.com", "https://bynkbook.com"]
    : ["http://localhost:3000"],
      },
    });

    const authorizer = api.addAuthorizer({
      name: "ledrigo-dev-cognito-jwt",
      jwt: {
        issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_tmyPJwsJb",
        audiences: ["38gus49pnfilbc4u2f7b68ist7"],
        identitySource: "$request.header.Authorization",
      },
    });

    const RUNTIME = "nodejs22.x" as const;
    type ApiHandler = Parameters<typeof api.route>[1];

    // ========== Public Routes ==========
    api.route("GET /v1/health", {
      handler: "packages/functions/src/health.handler",
      runtime: RUNTIME,
      memory: "256 MB",
      timeout: "10 seconds",
    });

    // ========== Protected Routes ==========
    api.route(
      "GET /v1/me",
      {
        handler: "packages/functions/src/me.handler",
        runtime: RUNTIME,
        memory: "256 MB",
        timeout: "10 seconds",
      },
      { auth: { jwt: { authorizer: authorizer.id } } }
    );

    // ---------- Businesses ----------
    const bizHandler = {
      handler: "packages/functions/src/businesses.handler",
      runtime: RUNTIME,
      memory: "512 MB",
      timeout: "20 seconds",
      vpc: {
        securityGroups: ["sg-0fe7b2ad87e2b2bb8"],
        privateSubnets: ["subnet-016a9caf338ab17e3", "subnet-04ff62b426b19d70b"],
      },
      environment: {
        DB_URL_SECRET_ID: "ledrigo-dev/rds/database_url",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        CACHE_BUSTER: "20260207171000",
      },
      permissions: [
        // CloudWatch Logs (required for any console.log / error logging)
        {
          actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
          resources: ["*"],
        },

        {
          actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
          resources: [
            "arn:aws:secretsmanager:us-east-1:116846786465:secret:ledrigo-dev/rds/database_url-*",
          ],
        },
        {
          actions: ["kms:Decrypt"],
          resources: ["arn:aws:kms:us-east-1:116846786465:key/7f953e5a-b3c9-4354-9ba9-e4f980717c36"],
        },
      ],
    } satisfies ApiHandler;

    api.route("GET /v1/businesses", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("POST /v1/businesses", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });

    // Single business (profile)
    api.route("GET /v1/businesses/{businessId}", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("PATCH /v1/businesses/{businessId}", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });

    // Settings usage stats (minimal, business-scoped)
    api.route("GET /v1/businesses/{businessId}/usage", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Accounts ----------
const acctHandler = {
  ...bizHandler,
  handler: "packages/functions/src/accounts.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/accounts", acctHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/accounts", acctHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// Account management (Settings)
api.route("PATCH /v1/businesses/{businessId}/accounts/{accountId}", acctHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/archive", acctHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/unarchive", acctHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/accounts/{accountId}/delete-eligibility", acctHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("DELETE /v1/businesses/{businessId}/accounts/{accountId}", acctHandler, { auth: { jwt: { authorizer: authorizer.id } } });

    // ---------- Uploads (Phase 4A-2 + 4A-3) ----------
    const uploadsHandler = {
      ...bizHandler,
      handler: "packages/functions/src/uploads.handler",
      environment: {
        ...bizHandler.environment,
        UPLOADS_BUCKET_NAME: "ledrigo-dev-uploads-116846786465-us-east-1",
      },
      permissions: [
        ...(bizHandler as any).permissions,

        // S3 least-privilege: only our uploads prefix
        {
          actions: ["s3:PutObject", "s3:GetObject"],
          resources: ["arn:aws:s3:::ledrigo-dev-uploads-116846786465-us-east-1/private/biz/*"],
        },

        // KMS scoped to key ARN (SSE-KMS)
        {
          actions: ["kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey", "kms:Decrypt"],
          resources: ["arn:aws:kms:us-east-1:116846786465:key/7f953e5a-b3c9-4354-9ba9-e4f980717c36"],
        },

        // Textract (AnalyzeExpense) for invoice/receipt parsing
        {
          actions: ["textract:AnalyzeExpense"],
          resources: ["*"],
        },
      ],
    } satisfies ApiHandler;

api.route("POST /v1/businesses/{businessId}/uploads/init", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/uploads/mark-uploaded", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/uploads/complete", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/uploads", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/uploads/{uploadId}/download", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("POST /v1/businesses/{businessId}/uploads/{uploadId}/create-entry", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/uploads/create-entries", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// Phase 4C: Manual CSV import (BANK_STATEMENT only)
api.route("POST /v1/businesses/{businessId}/uploads/{uploadId}/import", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Plaid (Phase 4B: connect + sync only) ----------
const plaidHandler = {
  ...bizHandler,
  handler: "packages/functions/src/plaidLinkToken.handler",
  environment: {
    ...bizHandler.environment,
    // Do not hardcode Plaid env by stage. Use SST secret/env so dev can be production when needed.
    PLAID_ENV: "production",

    // Dev is using production Plaid; therefore dev must read production Plaid credentials.
    PLAID_CLIENT_ID_SECRET_ID: "ledrigo-prod/plaid/client_id",
    PLAID_SECRET_SECRET_ID: "ledrigo-prod/plaid/secret",
    PLAID_TOKEN_KMS_KEY_ARN: "arn:aws:kms:us-east-1:116846786465:key/7f953e5a-b3c9-4354-9ba9-e4f980717c36",
  },
  permissions: [
    ...(bizHandler as any).permissions,

    // Read Plaid creds from Secrets Manager (IDs/names referenced above)
    {
      actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      resources: ["*"],
    },

    // Encrypt/decrypt Plaid access tokens
    {
      actions: ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
      resources: ["*"],
    },
  ],
} satisfies ApiHandler;

const plaidLinkTokenHandler = {
  ...plaidHandler,
  handler: "packages/functions/src/plaidLinkToken.handler",
} satisfies ApiHandler;

const plaidExchangeHandler = {
  ...plaidHandler,
  handler: "packages/functions/src/plaidExchange.handler",
} satisfies ApiHandler;

const plaidStatusHandler = {
  ...plaidHandler,
  handler: "packages/functions/src/plaidStatus.handler",
} satisfies ApiHandler;

const plaidDisconnectHandler = {
  ...plaidHandler,
  handler: "packages/functions/src/plaidDisconnect.handler",
} satisfies ApiHandler;

const plaidSyncHandler = {
  ...plaidHandler,
  handler: "packages/functions/src/plaidSync.handler",
  timeout: "45 seconds",
} satisfies ApiHandler;

// Protected Plaid routes (Cognito)
api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/plaid/link-token",
  plaidLinkTokenHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/plaid/exchange",
  plaidExchangeHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "GET /v1/businesses/{businessId}/accounts/{accountId}/plaid/status",
  plaidStatusHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

const plaidPreviewOpeningHandler = {
  ...plaidHandler,
  handler: "packages/functions/src/plaidPreviewOpening.handler",
} satisfies ApiHandler;

const plaidApplyOpeningHandler = {
  ...plaidHandler,
  handler: "packages/functions/src/plaidApplyOpening.handler",
} satisfies ApiHandler;

const plaidChangeOpeningDateHandler = {
  ...plaidHandler,
  handler: "packages/functions/src/plaidChangeOpeningDate.handler",
  timeout: "45 seconds",
} satisfies ApiHandler;

api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/plaid/preview-opening",
  plaidPreviewOpeningHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/plaid/apply-opening",
  plaidApplyOpeningHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/plaid/change-opening-date",
  plaidChangeOpeningDateHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "DELETE /v1/businesses/{businessId}/accounts/{accountId}/plaid/disconnect",
  plaidDisconnectHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/plaid/sync",
  plaidSyncHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

// ---------- Plaid (New account via review) ----------
const plaidLinkTokenBusinessHandler = {
  ...plaidHandler,
  handler: "packages/functions/src/plaidLinkTokenBusiness.handler",
} satisfies ApiHandler;

const plaidCreateAccountHandler = {
  ...plaidHandler,
  handler: "packages/functions/src/plaidCreateAccount.handler",
  timeout: "45 seconds",
} satisfies ApiHandler;

api.route(
  "POST /v1/businesses/{businessId}/plaid/link-token",
  plaidLinkTokenBusinessHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "POST /v1/businesses/{businessId}/plaid/create-account",
  plaidCreateAccountHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

// Public webhook (no Cognito auth)
const plaidWebhookHandler = {
  ...bizHandler,
  handler: "packages/functions/src/plaidWebhook.handler",
  environment: {
    ...bizHandler.environment,
    // Do not hardcode Plaid env by stage. Use SST secret/env so dev can be production when needed.
    PLAID_ENV: "production",

    // Dev is using production Plaid; therefore dev must read production Plaid credentials.
    PLAID_CLIENT_ID_SECRET_ID: "ledrigo-prod/plaid/client_id",
    PLAID_SECRET_SECRET_ID: "ledrigo-prod/plaid/secret",
    PLAID_TOKEN_KMS_KEY_ARN: "arn:aws:kms:us-east-1:116846786465:key/7f953e5a-b3c9-4354-9ba9-e4f980717c36",
  },
  permissions: [
    ...(bizHandler as any).permissions,

    // Read Plaid creds from Secrets Manager
    {
      actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      resources: ["*"],
    },

    // Encrypt/decrypt Plaid access tokens if webhook needs it (safe, broad)
    {
      actions: ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
      resources: ["*"],
    },
  ],
} satisfies ApiHandler;

api.route("POST /v1/plaid/webhook", plaidWebhookHandler);

    // ---------- Entries ----------
    const entryHandler = {
      ...bizHandler,
      handler: "packages/functions/src/entries.handler",
    } satisfies ApiHandler;

    api.route("GET /v1/businesses/{businessId}/accounts/{accountId}/entries", entryHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Bank Transactions (Phase 4C read-only) ----------
const bankTxHandler = {
  ...bizHandler,
  handler: "packages/functions/src/bankTransactions.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions", bankTxHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Matches (Phase 4D v1) ----------
const matchesHandler = {
  ...bizHandler,
  handler: "packages/functions/src/matches.handler",
} satisfies ApiHandler;

// Create match
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/matches", matchesHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// List active matches (Phase 4D v1)
api.route("GET /v1/businesses/{businessId}/accounts/{accountId}/matches", matchesHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Team & Roles (Phase 6C) ----------
const teamHandler = {
  ...bizHandler,
  handler: "packages/functions/src/team.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/team", teamHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("POST /v1/businesses/{businessId}/team/invites", teamHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route(
  "POST /v1/businesses/{businessId}/team/invites/{inviteId}/revoke",
  teamHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "PATCH /v1/businesses/{businessId}/team/members/{userId}",
  teamHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "DELETE /v1/businesses/{businessId}/team/members/{userId}",
  teamHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route("POST /v1/team/invites/accept", teamHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Reports (Stage 2B) ----------
const reportsHandler = {
  ...bizHandler,
  handler: "packages/functions/src/reports.handler",
} satisfies ApiHandler;

// ---------- Budgets + Goals (Bundle D) ----------
const budgetsHandler = {
  ...bizHandler,
  handler: "packages/functions/src/budgets.handler",
} satisfies ApiHandler;

const goalsHandler = {
  ...bizHandler,
  handler: "packages/functions/src/goals.handler",
} satisfies ApiHandler;

// ---------- Categories (Category System v2) ----------
const categoriesHandler = {
  ...bizHandler,
  handler: "packages/functions/src/categories.handler",
} satisfies ApiHandler;

// ---------- Bookkeeping Preferences ----------
const bookkeepingPreferencesHandler = {
  ...bizHandler,
  handler: "packages/functions/src/bookkeepingPreferences.handler",
} satisfies ApiHandler;

// ---------- Category Migration (Category System v2) ----------
const categoryMigrationHandler = {
  ...bizHandler,
  handler: "packages/functions/src/categoryMigration.handler",
} satisfies ApiHandler;

const closedPeriodsHandler = {
  ...bizHandler,
  handler: "packages/functions/src/closedPeriods.handler",
} satisfies ApiHandler;

const vendorsHandler = {
  ...bizHandler,
  handler: "packages/functions/src/vendors.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/budgets", budgetsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("PUT /v1/businesses/{businessId}/budgets", budgetsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/goals", goalsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/goals", goalsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("PATCH /v1/businesses/{businessId}/goals/{goalId}", goalsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/categories", categoriesHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/categories", categoriesHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("PATCH /v1/businesses/{businessId}/categories/{categoryId}", categoriesHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("DELETE /v1/businesses/{businessId}/categories/{categoryId}", categoriesHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/bookkeeping/preferences", bookkeepingPreferencesHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("PUT /v1/businesses/{businessId}/bookkeeping/preferences", bookkeepingPreferencesHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/category-migration/preview", categoryMigrationHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/category-migration/apply", categoryMigrationHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/reports/payees", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/reports/cashflow", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/reports/activity", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/reports/categories", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/closed-periods", closedPeriodsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/closed-periods/preview", closedPeriodsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/closed-periods", closedPeriodsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("DELETE /v1/businesses/{businessId}/closed-periods/{month}", closedPeriodsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/vendors", vendorsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/vendors", vendorsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/vendors/{vendorId}", vendorsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("PATCH /v1/businesses/{businessId}/vendors/{vendorId}", vendorsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Role Policies (store-only) ----------
const rolePoliciesHandler = {
  ...bizHandler,
  handler: "packages/functions/src/rolePolicies.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/role-policies", rolePoliciesHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("PUT /v1/businesses/{businessId}/role-policies/{role}", rolePoliciesHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Activity Log (Phase 6D) ----------
const activityHandler = {
  ...bizHandler,
  handler: "packages/functions/src/activity.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/activity", activityHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Reconcile Snapshots (Phase 6B) ----------
const reconcileSnapshotsHandler = {
  ...bizHandler,
  handler: "packages/functions/src/reconcileSnapshots.handler",
  environment: {
    ...bizHandler.environment,
    UPLOADS_BUCKET_NAME: "ledrigo-dev-uploads-116846786465-us-east-1",
  },
  permissions: [
    ...(bizHandler as any).permissions,

    // S3 least-privilege: only our private business prefix
    {
      actions: ["s3:PutObject", "s3:GetObject"],
      resources: ["arn:aws:s3:::ledrigo-dev-uploads-116846786465-us-east-1/private/biz/*"],
    },

    // KMS scoped to key ARN (SSE-KMS)
    {
      actions: ["kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey", "kms:Decrypt"],
      resources: ["arn:aws:kms:us-east-1:116846786465:key/7f953e5a-b3c9-4354-9ba9-e4f980717c36"],
    },
  ],
} satisfies ApiHandler;

api.route(
  "GET /v1/businesses/{businessId}/accounts/{accountId}/reconcile-snapshots",
  reconcileSnapshotsHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/reconcile-snapshots",
  reconcileSnapshotsHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "GET /v1/businesses/{businessId}/accounts/{accountId}/reconcile-snapshots/{snapshotId}",
  reconcileSnapshotsHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "GET /v1/businesses/{businessId}/accounts/{accountId}/reconcile-snapshots/{snapshotId}/exports/{kind}",
  reconcileSnapshotsHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

// Phase 4D v1: VOID matches for a bank transaction (audit safe)
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/{bankTransactionId}/unmatch", bankTxHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/{bankTransactionId}/create-entry", bankTxHandler, { auth: { jwt: { authorizer: authorizer.id } } });


// Phase 4D v1: Mark entry as adjustment (ledger-only)
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/mark-adjustment", entryHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// Phase 6D: Unmark adjustment (ledger-only)
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/unmark-adjustment", entryHandler, { auth: { jwt: { authorizer: authorizer.id } } });

    api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/entries", entryHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("DELETE /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}", entryHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/restore", entryHandler, { auth: { jwt: { authorizer: authorizer.id } } });

    // ---------- Transfers ----------
    const transferHandler = {
      ...bizHandler,
      handler: "packages/functions/src/transfers.handler",
    } satisfies ApiHandler;

    api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/transfers", transferHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("PUT /v1/businesses/{businessId}/accounts/{accountId}/transfers/{transferId}", transferHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("PATCH /v1/businesses/{businessId}/accounts/{accountId}/transfers/{transferId}", transferHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("DELETE /v1/businesses/{businessId}/accounts/{accountId}/transfers/{transferId}", transferHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/transfers/{transferId}/restore", transferHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    // ---------- Issues Scan ----------
    const issuesScanHandler = {
      handler: "packages/functions/src/issuesScan.handler",
      runtime: RUNTIME,
      memory: "512 MB",
      timeout: "20 seconds",
      vpc: {
        securityGroups: ["sg-0fe7b2ad87e2b2bb8"],
        privateSubnets: ["subnet-016a9caf338ab17e3", "subnet-04ff62b426b19d70b"],
      },
      environment: {
        DB_URL_SECRET_ID: "ledrigo-dev/rds/database_url",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        CACHE_BUSTER: "202601030001",
      },
      permissions: [
        // CloudWatch Logs (required for any console.log / error logging)
        {
          actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
          resources: ["*"],
        },

        {
          actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
          resources: [
            "arn:aws:secretsmanager:us-east-1:116846786465:secret:ledrigo-dev/rds/database_url-*",
          ],
        },
        {
          actions: ["kms:Decrypt"],
          resources: ["arn:aws:kms:us-east-1:116846786465:key/7f953e5a-b3c9-4354-9ba9-e4f980717c36"],
        },
      ],
    } satisfies ApiHandler;

api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/issues/scan", issuesScanHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Issues List ----------
const issuesListHandler = {
  ...issuesScanHandler,
  handler: "packages/functions/src/issuesList.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/accounts/{accountId}/issues", issuesListHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Issues Resolve ----------
const issuesResolveHandler = {
  ...issuesScanHandler,
  handler: "packages/functions/src/issuesResolve.handler",
} satisfies ApiHandler;

api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/issues/{issueId}/resolve", issuesResolveHandler, { auth: { jwt: { authorizer: authorizer.id } } });
// ---------- Issues Count (Bundle 1) ----------
const issuesCountHandler = {
  ...issuesScanHandler,
  handler: "packages/functions/src/issuesCount.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/issues/count", issuesCountHandler, { auth: { jwt: { authorizer: authorizer.id } } });

    // ---------- Entry Update ----------
    const entryUpdateHandler = {
      ...entryHandler,
      handler: "packages/functions/src/entryUpdate.handler",
    } satisfies ApiHandler;

    api.route("PUT /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}", entryUpdateHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("PATCH /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}", entryUpdateHandler, { auth: { jwt: { authorizer: authorizer.id } } });

    // ---------- Entry Hard Delete ----------
    const entryHardDeleteHandler = {
      ...entryHandler,
      handler: "packages/functions/src/entryHardDelete.handler",
    } satisfies ApiHandler;

    api.route("DELETE /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/hard", entryHardDeleteHandler, { auth: { jwt: { authorizer: authorizer.id } } });

    // ---------- Ledger Summary ----------
    const ledgerSummaryHandler = {
      ...bizHandler,
      handler: "packages/functions/src/ledgerSummary.handler",
    } satisfies ApiHandler;

    api.route("GET /v1/businesses/{businessId}/accounts/{accountId}/ledger-summary", ledgerSummaryHandler, { auth: { jwt: { authorizer: authorizer.id } } });

    return { apiUrl: api.url };
  },
});
