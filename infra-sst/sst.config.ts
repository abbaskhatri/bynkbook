/// <reference path="./sst.config.types.d.ts" />

export default $config({
  app(input) {
    return {
      name: "ledrigo",
      home: "aws",
    };
  },

  async run() {
    const optionalEnv = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
    const csvEnv = (name: string, fallback: string[]) =>
      (process.env[name]?.trim()
        ? process.env[name]!.split(",").map((part) => part.trim()).filter(Boolean)
        : fallback);
    const awsAccountId = optionalEnv("BYNKBOOK_AWS_ACCOUNT_ID", "116846786465");
    const region = optionalEnv("BYNKBOOK_AWS_REGION", "us-east-1");
    const isProd = $app.stage === "prod";
    const resourcePrefix = isProd ? "ledrigo-prod" : "ledrigo-dev";
    const secretArnFor = (secretId: string) =>
      secretId.startsWith("arn:")
        ? secretId
        : `arn:aws:secretsmanager:${region}:${awsAccountId}:secret:${secretId}-*`;
    const requiredEnv = (name: string) => {
      const value = process.env[name]?.trim();
      if (!value) throw new Error(`Missing required environment variable ${name} for ${$app.stage} stage`);
      return value;
    };
    const uploadsBucketName = isProd
      ? process.env.BYNKBOOK_PROD_UPLOADS_BUCKET_NAME
      : optionalEnv("BYNKBOOK_DEV_UPLOADS_BUCKET_NAME", "ledrigo-dev-uploads-116846786465-us-east-1");
    const cognitoUserPoolId = isProd
      ? process.env.BYNKBOOK_PROD_COGNITO_USER_POOL_ID
      : optionalEnv("BYNKBOOK_DEV_COGNITO_USER_POOL_ID", "us-east-1_tmyPJwsJb");
    const cognitoAppClientId = isProd
      ? process.env.BYNKBOOK_PROD_COGNITO_APP_CLIENT_ID
      : optionalEnv("BYNKBOOK_DEV_COGNITO_APP_CLIENT_ID", "38gus49pnfilbc4u2f7b68ist7");

    if (!uploadsBucketName) throw new Error("Missing BYNKBOOK_PROD_UPLOADS_BUCKET_NAME for prod stage");
    if (!cognitoUserPoolId) throw new Error("Missing BYNKBOOK_PROD_COGNITO_USER_POOL_ID for prod stage");
    if (!cognitoAppClientId) throw new Error("Missing BYNKBOOK_PROD_COGNITO_APP_CLIENT_ID for prod stage");
    if (isProd && cognitoUserPoolId === "us-east-1_CgE7Dozj4") {
      throw new Error(
        "Refusing prod deploy with stale Cognito pool us-east-1_CgE7Dozj4. Production auth uses us-east-1_tmyPJwsJb."
      );
    }
    if (isProd && cognitoAppClientId === "2iqmddh5hu90ic1os90p59ls1d") {
      throw new Error(
        "Refusing prod deploy with stale Cognito app client 2iqmddh5hu90ic1os90p59ls1d. Production auth uses 38gus49pnfilbc4u2f7b68ist7."
      );
    }

    const databaseSecretId = `${resourcePrefix}/rds/database_url`;
    const databaseCaSecretId = isProd
      ? process.env.BYNKBOOK_PROD_DB_CA_SECRET_ID
      : optionalEnv("BYNKBOOK_DEV_DB_CA_SECRET_ID", "ledrigo-dev/rds/ca_bundle_us_east_1");

    if (!databaseCaSecretId) throw new Error("Missing BYNKBOOK_PROD_DB_CA_SECRET_ID for prod stage");

    const databaseSecretArn = secretArnFor(databaseSecretId);
    const databaseCaSecretArn = secretArnFor(databaseCaSecretId);
    const uploadsBucketPrivateArn = `arn:aws:s3:::${uploadsBucketName}/private/biz/*`;
    const sharedKmsKeyArn = isProd
      ? optionalEnv("BYNKBOOK_PROD_KMS_KEY_ARN", `arn:aws:kms:${region}:${awsAccountId}:key/7f953e5a-b3c9-4354-9ba9-e4f980717c36`)
      : optionalEnv("BYNKBOOK_DEV_KMS_KEY_ARN", `arn:aws:kms:${region}:${awsAccountId}:key/7f953e5a-b3c9-4354-9ba9-e4f980717c36`);
    const plaidEnv = isProd
      ? requiredEnv("BYNKBOOK_PROD_PLAID_ENV")
      : (process.env.BYNKBOOK_DEV_PLAID_ENV?.trim() || "sandbox");
    const plaidClientIdSecretId = isProd
      ? requiredEnv("BYNKBOOK_PROD_PLAID_CLIENT_ID_SECRET_ID")
      : (process.env.BYNKBOOK_DEV_PLAID_CLIENT_ID_SECRET_ID?.trim() || `${resourcePrefix}/plaid/client_id`);
    const plaidSecretSecretId = isProd
      ? requiredEnv("BYNKBOOK_PROD_PLAID_SECRET_SECRET_ID")
      : (process.env.BYNKBOOK_DEV_PLAID_SECRET_SECRET_ID?.trim() || `${resourcePrefix}/plaid/secret`);
    const plaidLinkCustomizationName = isProd
      ? requiredEnv("BYNKBOOK_PROD_PLAID_LINK_CUSTOMIZATION_NAME")
      : optionalEnv("BYNKBOOK_DEV_PLAID_LINK_CUSTOMIZATION_NAME", "default");
    const validPlaidEnvs = new Set(["sandbox", "development", "production"]);
    if (!validPlaidEnvs.has(plaidEnv)) {
      throw new Error(`Invalid Plaid environment "${plaidEnv}" for ${$app.stage} stage`);
    }
    if (isProd && plaidEnv !== "production") {
      throw new Error("Prod stage requires BYNKBOOK_PROD_PLAID_ENV=production");
    }
    if (!isProd && plaidEnv === "production") {
      throw new Error("Dev stage must not use Plaid production; set BYNKBOOK_DEV_PLAID_ENV to sandbox or development");
    }
    if (!isProd && (plaidClientIdSecretId.includes("ledrigo-prod/") || plaidSecretSecretId.includes("ledrigo-prod/"))) {
      throw new Error("Dev stage must not use ledrigo-prod Plaid secrets");
    }
    const plaidClientIdSecretArn = secretArnFor(plaidClientIdSecretId);
    const plaidSecretSecretArn = secretArnFor(plaidSecretSecretId);

    const vpcSecurityGroups = csvEnv("BYNKBOOK_VPC_SECURITY_GROUP_IDS", ["sg-0fe7b2ad87e2b2bb8"]);
    const vpcPrivateSubnets = csvEnv("BYNKBOOK_VPC_PRIVATE_SUBNET_IDS", ["subnet-016a9caf338ab17e3", "subnet-04ff62b426b19d70b"]);

    const plaidSyncDeadLetterQueue = new sst.aws.Queue("PlaidSyncDeadLetterQueue", {
      visibilityTimeout: "5 minutes",
    });
    const plaidSyncQueue = new sst.aws.Queue("PlaidSyncQueue", {
      visibilityTimeout: "6 minutes",
      dlq: { queue: plaidSyncDeadLetterQueue.arn, retry: 5 },
    });
    const configuredAlarmTopicArn = process.env.BYNKBOOK_ALARM_TOPIC_ARN?.trim();
    const managedAlarmTopic = configuredAlarmTopicArn
      ? null
      : new aws.sns.Topic("PlaidOperationsAlarmTopic", {
          name: `${resourcePrefix}-plaid-operations-alarms`,
          displayName: "BynkBook Plaid operations alarms",
          tags: { Application: "BynkBook", Stage: $app.stage, ManagedBy: "SST" },
        });
    const alarmTopicArn = configuredAlarmTopicArn || managedAlarmTopic!.arn;
    const alarmActions = [alarmTopicArn];

    new aws.cloudwatch.MetricAlarm("PlaidSyncDeadLettersAlarm", {
      alarmDescription: "Plaid transaction sync messages reached the dead-letter queue.",
      namespace: "AWS/SQS",
      metricName: "ApproximateNumberOfMessagesVisible",
      dimensions: { QueueName: plaidSyncDeadLetterQueue.name },
      statistic: "Maximum",
      period: 60,
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: "GreaterThanThreshold",
      treatMissingData: "notBreaching",
      alarmActions,
    });

    new aws.cloudwatch.MetricAlarm("PlaidSyncBacklogAgeAlarm", {
      alarmDescription: "The oldest queued Plaid sync job has waited more than five minutes.",
      namespace: "AWS/SQS",
      metricName: "ApproximateAgeOfOldestMessage",
      dimensions: { QueueName: plaidSyncQueue.name },
      statistic: "Maximum",
      period: 60,
      evaluationPeriods: 2,
      threshold: 300,
      comparisonOperator: "GreaterThanThreshold",
      treatMissingData: "notBreaching",
      alarmActions,
    });

    const api = new sst.aws.ApiGatewayV2(optionalEnv("BYNKBOOK_API_NAME", `${resourcePrefix}-sst-api`), {
      accessLog: { retention: "3 months" },
      transform: {
        stage: {
          defaultRouteSettings: {
            throttlingBurstLimit: Number(optionalEnv("BYNKBOOK_API_BURST_LIMIT", isProd ? "200" : "100")),
            throttlingRateLimit: Number(optionalEnv("BYNKBOOK_API_RATE_LIMIT", isProd ? "100" : "50")),
          },
        },
      },
      cors: {
        allowHeaders: ["authorization", "content-type"],
        allowMethods: ["GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"],
        allowOrigins:
  $app.stage === "prod"
    ? ["https://app.bynkbook.com", "https://bynkbook.com"]
    : ["http://localhost:3000"],
      },
    });
    const plaidWebhookUrl = isProd
      ? requiredEnv("BYNKBOOK_PROD_PLAID_WEBHOOK_URL")
      : (process.env.BYNKBOOK_DEV_PLAID_WEBHOOK_URL?.trim() || `${api.url}/v1/plaid/webhook`);

    const authorizer = api.addAuthorizer({
      name: `${resourcePrefix}-cognito-jwt`,
      jwt: {
        issuer: `https://cognito-idp.${region}.amazonaws.com/${cognitoUserPoolId}`,
        audiences: [cognitoAppClientId],
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
        securityGroups: vpcSecurityGroups,
        privateSubnets: vpcPrivateSubnets,
      },
      environment: {
        DB_URL_SECRET_ID: databaseSecretId,
        DB_SSL_CA_SECRET_ID: databaseCaSecretId,
        DB_SSL_REJECT_UNAUTHORIZED: "true",
        CACHE_BUSTER: optionalEnv("BYNKBOOK_CACHE_BUSTER", "20260207171000"),
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
            databaseSecretArn,
            databaseCaSecretArn,
          ],
        },
        {
          actions: ["kms:Decrypt"],
          resources: [sharedKmsKeyArn],
        },
      ],
    } satisfies ApiHandler;

    api.route("GET /v1/businesses", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("POST /v1/businesses", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });

    // Single business (profile)
    api.route("GET /v1/businesses/{businessId}", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("PATCH /v1/businesses/{businessId}", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("DELETE /v1/businesses/{businessId}", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });

    // Settings usage stats (minimal, business-scoped)
    api.route("GET /v1/businesses/{businessId}/usage", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("GET /v1/businesses/{businessId}/backup", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("POST /v1/businesses/{businessId}/reset", bizHandler, { auth: { jwt: { authorizer: authorizer.id } } });

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
        UPLOADS_BUCKET_NAME: uploadsBucketName,
      },
      permissions: [
        ...(bizHandler as any).permissions,

        // S3 least-privilege: only our uploads prefix
        {
          actions: ["s3:PutObject", "s3:GetObject"],
          resources: [uploadsBucketPrivateArn],
        },

        // KMS scoped to key ARN (SSE-KMS)
        {
          actions: ["kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey", "kms:Decrypt"],
          resources: [sharedKmsKeyArn],
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

// Accounts Payable
api.route("POST /v1/businesses/{businessId}/uploads/create-bills", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/uploads/backfill-bills", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/uploads/{uploadId}/delete", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// Phase 4C: Manual CSV import (BANK_STATEMENT only)
api.route("POST /v1/businesses/{businessId}/uploads/{uploadId}/import", uploadsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Plaid (Phase 4B: connect + sync only) ----------
const plaidHandler = {
  ...bizHandler,
  handler: "packages/functions/src/plaidLinkToken.handler",
  environment: {
    ...bizHandler.environment,
    PLAID_ENV: plaidEnv,
    PLAID_CLIENT_ID_SECRET_ID: plaidClientIdSecretId,
    PLAID_SECRET_SECRET_ID: plaidSecretSecretId,
    PLAID_LINK_CUSTOMIZATION_NAME: plaidLinkCustomizationName,
    PLAID_TOKEN_KMS_KEY_ARN: sharedKmsKeyArn,
    PLAID_WEBHOOK_URL: plaidWebhookUrl,
  },
  permissions: [
    ...(bizHandler as any).permissions,

    // Read Plaid creds from Secrets Manager (IDs/names referenced above)
    {
      actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      resources: [plaidClientIdSecretArn, plaidSecretSecretArn],
    },

    // Encrypt/decrypt Plaid access tokens
    {
      actions: ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
      resources: [sharedKmsKeyArn],
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

const plaidRepairAccountHandler = {
  ...plaidHandler,
  handler: "packages/functions/src/plaidRepairAccount.handler",
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

plaidSyncQueue.subscribe(
  {
    ...plaidHandler,
    handler: "packages/functions/src/plaidSyncWorker.handler",
    timeout: "5 minutes",
    memory: "1024 MB",
  },
  { batch: { size: 5, partialResponses: true } },
);

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

api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/plaid/repair-account",
  plaidRepairAccountHandler,
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
    PLAID_ENV: plaidEnv,
    PLAID_CLIENT_ID_SECRET_ID: plaidClientIdSecretId,
    PLAID_SECRET_SECRET_ID: plaidSecretSecretId,
    PLAID_TOKEN_KMS_KEY_ARN: sharedKmsKeyArn,
    PLAID_WEBHOOK_URL: plaidWebhookUrl,
    PLAID_SYNC_QUEUE_URL: plaidSyncQueue.url,
  },
  permissions: [
    ...(bizHandler as any).permissions,

    // Read Plaid creds from Secrets Manager
    {
      actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      resources: [plaidClientIdSecretArn, plaidSecretSecretArn],
    },

    // Encrypt/decrypt Plaid access tokens if webhook needs it (safe, broad)
    {
      actions: ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
      resources: [sharedKmsKeyArn],
    },
    {
      actions: ["sqs:SendMessage"],
      resources: [plaidSyncQueue.arn],
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
    api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/merge", entryHandler, { auth: { jwt: { authorizer: authorizer.id } } });
    api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/unmatch-and-delete", entryHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Bank Transactions (Phase 4C read-only) ----------
const bankTxHandler = {
  ...bizHandler,
  handler: "packages/functions/src/bankTransactions.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions", bankTxHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// Best-effort batch create entries from selected bank txns (B2)
api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/create-entries-batch",
  bankTxHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);
api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/cleanup-plaid-overlap",
  bankTxHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

// ---------- Matches (Phase 4D v1) ----------
const matchesHandler = {
  ...bizHandler,
  handler: "packages/functions/src/matches.handler",
} satisfies ApiHandler;

// Legacy BankMatch is read-only for historical compatibility. New matching
// writes use MatchGroup exclusively, preventing two accounting models from
// continuing to accumulate in parallel.
api.route("GET /v1/businesses/{businessId}/accounts/{accountId}/matches", matchesHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Match Groups (CPA-clean; full match only) ----------
const matchGroupsHandler = {
  ...bizHandler,
  handler: "packages/functions/src/matchGroups.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/accounts/{accountId}/match-groups", matchGroupsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/accounts/{accountId}/match-groups/revert-preview", matchGroupsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/match-groups/placement-summary", matchGroupsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/match-groups", matchGroupsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/match-groups/batch", matchGroupsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/match-groups/revert", matchGroupsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/match-groups/{matchGroupId}/void", matchGroupsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

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

const checksHandler = {
  ...bizHandler,
  handler: "packages/functions/src/checks.handler",
} satisfies ApiHandler;

// ---------- Phase F: AI (heuristics-only) + Insights + Search ----------
const stagePrefix = resourcePrefix;

const aiCategorySuggestionsHandler = {
  ...bizHandler,
  handler: "packages/functions/src/aiCategorySuggestions.handler",
  environment: {
    ...bizHandler.environment,
    OPENAI_API_KEY_SECRET_ID: `${stagePrefix}/openai/api_key`,
    OPENAI_MODEL_SECRET_ID: `${stagePrefix}/openai/model`,
    AI_CATEGORY_FALLBACK_MAX_ROWS: optionalEnv("BYNKBOOK_AI_CATEGORY_FALLBACK_MAX_ROWS", "12"),
  },
  permissions: [
    ...(bizHandler as any).permissions,
    {
      actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      resources: [
        secretArnFor(`${stagePrefix}/openai/api_key`),
        secretArnFor(`${stagePrefix}/openai/model`),
      ],
    },
  ],
} satisfies ApiHandler;

// ---------- AI (Bundle E) ----------
const aiHandler = {
  ...bizHandler,
  handler: "packages/functions/src/ai.handler",
  environment: {
    ...bizHandler.environment,

    // Secret IDs (repo pattern; stage-specific prefix)
    OPENAI_API_KEY_SECRET_ID: `${stagePrefix}/openai/api_key`,
    OPENAI_MODEL_SECRET_ID: `${stagePrefix}/openai/model`,

    // Usage limits (per business, daily)
    AI_DAILY_LIMIT: optionalEnv("BYNKBOOK_AI_DAILY_LIMIT", $app.stage === "prod" ? "100" : "25"),
    AI_CATEGORY_FALLBACK_MAX_ROWS: optionalEnv("BYNKBOOK_AI_CATEGORY_FALLBACK_MAX_ROWS", "12"),
  },
  permissions: [
    ...(bizHandler as any).permissions,

    // OpenAI secrets (stage-scoped; stagePrefix selects which SecretId is used)
    {
      actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      resources: [
        secretArnFor(`${stagePrefix}/openai/api_key`),
        secretArnFor(`${stagePrefix}/openai/model`),
      ],
    },
  ],
} satisfies ApiHandler;

const insightsDashboardHandler = {
  ...bizHandler,
  handler: "packages/functions/src/insightsDashboard.handler",
} satisfies ApiHandler;

const operationsOverviewHandler = {
  ...bizHandler,
  handler: "packages/functions/src/operationsOverview.handler",
} satisfies ApiHandler;

const searchQueryHandler = {
  ...bizHandler,
  handler: "packages/functions/src/searchQuery.handler",
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

// Phase F1/F2: heuristic category suggestions (batch-only)
api.route(
  "POST /v1/businesses/{businessId}/ai/category-suggestions",
  aiCategorySuggestionsHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

// Bundle E/F: AI surfaces (read-only + suggestion-only; businessId in body)
api.route("POST /v1/ai/explain-entry", aiHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/ai/explain-report", aiHandler, { auth: { jwt: { authorizer: authorizer.id } } });
// POST /v1/ai/suggest-category retired 2026-06-04. Use POST /v1/businesses/{businessId}/ai/category-suggestions instead.
api.route("POST /v1/ai/suggest-reconcile-bank", aiHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/ai/suggest-reconcile-entry", aiHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/ai/chat", aiHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// Bundle F additions
api.route("POST /v1/ai/anomalies", aiHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/ai/merchant-normalize", aiHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// Phase F4: dashboard insights (computed; non-hallucinated)
api.route(
  "GET /v1/businesses/{businessId}/insights/dashboard",
  insightsDashboardHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route(
  "GET /v1/businesses/{businessId}/operations/overview",
  operationsOverviewHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);
api.route(
  "POST /v1/businesses/{businessId}/operations/transfer-pairs",
  operationsOverviewHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

// Phase F5: global search (structured parse + scoped querying; no reindex yet)
api.route(
  "POST /v1/businesses/{businessId}/search/query",
  searchQueryHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

api.route("GET /v1/businesses/{businessId}/bookkeeping/preferences", bookkeepingPreferencesHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("PUT /v1/businesses/{businessId}/bookkeeping/preferences", bookkeepingPreferencesHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/category-migration/preview", categoryMigrationHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/category-migration/apply", categoryMigrationHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/reports/payees", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/reports/cashflow", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/reports/activity", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/reports/categories", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// Reports vNext (CPA-grade aggregates; cash-basis from INCOME+EXPENSE only)
api.route("GET /v1/businesses/{businessId}/reports/pnl/summary", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/reports/cashflow/series", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/reports/accounts/summary", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/reports/ap/aging", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/reports/ap/aging/{vendorId}", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/reports/categories/detail", reportsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/closed-periods", closedPeriodsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/closed-periods/preview", closedPeriodsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/closed-periods", closedPeriodsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/closed-periods/close-through", closedPeriodsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("DELETE /v1/businesses/{businessId}/closed-periods/{month}", closedPeriodsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/vendors", vendorsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/vendors", vendorsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/vendors/{vendorId}", vendorsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("PATCH /v1/businesses/{businessId}/vendors/{vendorId}", vendorsHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("DELETE /v1/businesses/{businessId}/vendors/{vendorId}", vendorsHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/checks", checksHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/checks", checksHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("PUT /v1/businesses/{businessId}/checks/settings/{accountId}", checksHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/checks/{checkId}/confirm-print", checksHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/checks/{checkId}/void", checksHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Accounts Payable (Bills) ----------
const apHandler = {
  ...bizHandler,
  handler: "packages/functions/src/ap.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/vendors/{vendorId}/bills", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/vendors/{vendorId}/bills", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("PATCH /v1/businesses/{businessId}/vendors/{vendorId}/bills/{billId}", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/vendors/{vendorId}/bills/{billId}/void", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("GET /v1/businesses/{businessId}/vendors/{vendorId}/ap/summary", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/vendors/{vendorId}/ap/payments-summary", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/vendors/{vendorId}/payments", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/vendors/{vendorId}/ap/statement.csv", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("GET /v1/businesses/{businessId}/ap/vendors-summary", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });

api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/ap/apply", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/ap/unapply", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });
api.route("POST /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/ap/unapply-and-delete", apHandler, { auth: { jwt: { authorizer: authorizer.id } } });

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
    UPLOADS_BUCKET_NAME: uploadsBucketName,
  },
  permissions: [
    ...(bizHandler as any).permissions,

    // S3 least-privilege: only our private business prefix
    {
      actions: ["s3:PutObject", "s3:GetObject"],
      resources: [uploadsBucketPrivateArn],
    },

    // KMS scoped to key ARN (SSE-KMS)
    {
      actions: ["kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey", "kms:Decrypt"],
      resources: [sharedKmsKeyArn],
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

    // Phase F2: apply category suggestions in bulk (per-item results; CLOSED_PERIOD per row)
    api.route(
      "POST /v1/businesses/{businessId}/accounts/{accountId}/entries/apply-category-batch",
      entryHandler,
      { auth: { jwt: { authorizer: authorizer.id } } }
    );

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
        securityGroups: vpcSecurityGroups,
        privateSubnets: vpcPrivateSubnets,
      },
      environment: {
        DB_URL_SECRET_ID: databaseSecretId,
        DB_SSL_CA_SECRET_ID: databaseCaSecretId,
        DB_SSL_REJECT_UNAUTHORIZED: "true",
        CACHE_BUSTER: optionalEnv("BYNKBOOK_ISSUES_CACHE_BUSTER", "202601030001"),
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
            databaseSecretArn,
            databaseCaSecretArn,
          ],
        },
        {
          actions: ["kms:Decrypt"],
          resources: [sharedKmsKeyArn],
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

// ---------- Issues Bulk Preview (Bundle D) ----------
const issuesBulkPreviewHandler = {
  ...issuesScanHandler,
  handler: "packages/functions/src/issuesBulkPreview.handler",
  environment: {
    ...(issuesScanHandler as any).environment,
    OPENAI_API_KEY_SECRET_ID: `${stagePrefix}/openai/api_key`,
    OPENAI_MODEL_SECRET_ID: `${stagePrefix}/openai/model`,
    OPENAI_DUPLICATE_REVIEW_MAX_ITEMS: optionalEnv("BYNKBOOK_OPENAI_DUPLICATE_REVIEW_MAX_ITEMS", "12"),
    OPENAI_DUPLICATE_REVIEW_MAX_OUTPUT_TOKENS: optionalEnv("BYNKBOOK_OPENAI_DUPLICATE_REVIEW_MAX_OUTPUT_TOKENS", "1000"),
  },
  permissions: [
    ...(issuesScanHandler as any).permissions,
    {
      actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      resources: [
        secretArnFor(`${stagePrefix}/openai/api_key`),
        secretArnFor(`${stagePrefix}/openai/model`),
      ],
    },
  ],
} satisfies ApiHandler;

api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/issues/bulk-preview",
  issuesBulkPreviewHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

// ---------- Issues Bulk Apply (Bundle D) ----------
const issuesBulkApplyHandler = {
  ...issuesScanHandler,
  handler: "packages/functions/src/issuesBulkApply.handler",
} satisfies ApiHandler;

api.route(
  "POST /v1/businesses/{businessId}/accounts/{accountId}/issues/bulk-apply",
  issuesBulkApplyHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

// ---------- Issues Count (Bundle 1) ----------
const issuesCountHandler = {
  ...issuesScanHandler,
  handler: "packages/functions/src/issuesCount.handler",
} satisfies ApiHandler;

api.route("GET /v1/businesses/{businessId}/issues/count", issuesCountHandler, { auth: { jwt: { authorizer: authorizer.id } } });

// ---------- Attention Summary (M1 read-only aggregate) ----------
const attentionSummaryHandler = {
  ...issuesScanHandler,
  handler: "packages/functions/src/attentionSummary.handler",
} satisfies ApiHandler;

api.route(
  "GET /v1/businesses/{businessId}/accounts/{accountId}/attention-summary",
  attentionSummaryHandler,
  { auth: { jwt: { authorizer: authorizer.id } } }
);

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

    return { apiUrl: api.url, plaidAlarmTopicArn: alarmTopicArn };
  },
});
