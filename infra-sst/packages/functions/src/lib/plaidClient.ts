import { PlaidApi, Configuration, PlaidEnvironments } from "plaid";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

async function getSecretString(secretId: string): Promise<string> {
  const sm = new SecretsManagerClient({});
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  const raw = (res.SecretString ?? "").toString().trim();
  if (!raw) return "";

  // Support both formats:
  // 1) Plain string secret: "abcd..."
  // 2) JSON secret: {"value":"abcd..."} or {"client_id":"..."} etc.
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const obj: any = JSON.parse(raw);
      const v =
        obj?.value ??
        obj?.client_id ??
        obj?.clientId ??
        obj?.secret ??
        obj?.PLAID_CLIENT_ID ??
        obj?.PLAID_SECRET ??
        "";
      return String(v || "").trim();
    } catch {
      // If JSON parse fails, fall back to raw
      return raw;
    }
  }

  return raw;
}

export async function getPlaidClient() {
  const env = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();

  const clientIdSecretId = process.env.PLAID_CLIENT_ID_SECRET_ID ?? "";
  const secretSecretId = process.env.PLAID_SECRET_SECRET_ID ?? "";
  if (!clientIdSecretId || !secretSecretId) {
    throw new Error("Missing Plaid secret ids (PLAID_CLIENT_ID_SECRET_ID / PLAID_SECRET_SECRET_ID)");
  }

  const clientId = await getSecretString(clientIdSecretId);
  const secret = await getSecretString(secretSecretId);

  const configuration = new Configuration({
    basePath:
      env === "production"
        ? PlaidEnvironments.production
        : env === "development"
          ? PlaidEnvironments.development
          : PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  return new PlaidApi(configuration);
}
