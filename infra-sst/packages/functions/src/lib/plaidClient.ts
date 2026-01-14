import { PlaidApi, Configuration, PlaidEnvironments } from "plaid";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

async function getSecretString(secretId: string): Promise<string> {
  const sm = new SecretsManagerClient({});
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  const v = res.SecretString ?? "";
  return v.toString();
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
      env === "development"
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
