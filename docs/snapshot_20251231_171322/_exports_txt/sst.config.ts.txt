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
        allowOrigins: ["http://localhost:3000"],
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

    // ========== Public Routes ==========
    api.route("GET /v1/health", {
      handler: "packages/functions/src/health.handler",
      runtime: "nodejs22.x",
      memory: "256 MB",
      timeout: "10 seconds",
    });

    // ========== Protected Routes ==========
    api.route(
      "GET /v1/me",
      {
        handler: "packages/functions/src/me.handler",
        runtime: "nodejs22.x",
        memory: "256 MB",
        timeout: "10 seconds",
      },
      { auth: { jwt: { authorizer: authorizer.id } } }
    );

    // ---------- Businesses ----------
    const bizHandler = {
      handler: "packages/functions/src/businesses.handler",
      runtime: "nodejs22.x",
      memory: "512 MB",
      timeout: "20 seconds",
      vpc: {
        securityGroups: ["sg-0fe7b2ad87e2b2bb8"],
        privateSubnets: ["subnet-016a9caf338ab17e3", "subnet-04ff62b426b19d70b"],
      },
      environment: {
        DB_URL_SECRET_ID: "ledrigo-dev/rds/database_url",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        CACHE_BUSTER: "20251224095558",
      },
      permissions: [
        {
          actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
          resources: [
            "arn:aws:secretsmanager:us-east-1:116846786465:secret:ledrigo-dev/rds/database_url-*",
          ],
        },
        {
          actions: ["kms:Decrypt"],
          resources: [
            "arn:aws:kms:us-east-1:116846786465:key/7f953e5a-b3c9-4354-9ba9-e4f980717c36",
          ],
        },
      ],
    };

    api.route("GET /v1/businesses", bizHandler, {
      auth: { jwt: { authorizer: authorizer.id } },
    });
    api.route("POST /v1/businesses", bizHandler, {
      auth: { jwt: { authorizer: authorizer.id } },
    });

    // ---------- Accounts ----------
    const acctHandler = {
      ...bizHandler,
      handler: "packages/functions/src/accounts.handler",
    };

    api.route("GET /v1/businesses/{businessId}/accounts", acctHandler, {
      auth: { jwt: { authorizer: authorizer.id } },
    });
    api.route("POST /v1/businesses/{businessId}/accounts", acctHandler, {
      auth: { jwt: { authorizer: authorizer.id } },
    });

    // ---------- Entries ----------
    const entryHandler = {
      ...bizHandler,
      handler: "packages/functions/src/entries.handler",
    };

    api.route(
      "GET /v1/businesses/{businessId}/accounts/{accountId}/entries",
      entryHandler,
      { auth: { jwt: { authorizer: authorizer.id } } }
    );
    api.route(
      "POST /v1/businesses/{businessId}/accounts/{accountId}/entries",
      entryHandler,
      { auth: { jwt: { authorizer: authorizer.id } } }
    );
    api.route(
      "DELETE /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}",
      entryHandler,
      { auth: { jwt: { authorizer: authorizer.id } } }
    );
    api.route(
      "POST /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/restore",
      entryHandler,
      { auth: { jwt: { authorizer: authorizer.id } } }
    );

    // ---------- Entry Update ----------
    const entryUpdateHandler = {
      ...entryHandler,
      handler: "packages/functions/src/entryUpdate.handler",
    };

    api.route(
      "PUT /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}",
      entryUpdateHandler,
      { auth: { jwt: { authorizer: authorizer.id } } }
    );
    api.route(
      "PATCH /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}",
      entryUpdateHandler,
      { auth: { jwt: { authorizer: authorizer.id } } }
    );

    // ---------- Entry Hard Delete (NEW for PR-12) ----------
    const entryHardDeleteHandler = {
      ...entryHandler,
      handler: "packages/functions/src/entryHardDelete.handler",
    };

    api.route(
      "DELETE /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/hard",
      entryHardDeleteHandler,
      { auth: { jwt: { authorizer: authorizer.id } } }
    );

    // ---------- Ledger Summary ----------
    const ledgerSummaryHandler = {
      ...bizHandler,
      handler: "packages/functions/src/ledgerSummary.handler",
    };

    api.route(
      "GET /v1/businesses/{businessId}/accounts/{accountId}/ledger-summary",
      ledgerSummaryHandler,
      { auth: { jwt: { authorizer: authorizer.id } } }
    );

    return { apiUrl: api.url };
  },
});
