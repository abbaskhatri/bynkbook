import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolConfig } from "pg";

let prisma: PrismaClient | null = null;
let pool: Pool | null = null;
let cachedDatabaseUrl: string | null = null;
let cachedDatabaseCa: string | null = null;

type DbSslConfig = false | { rejectUnauthorized: boolean; ca?: string };

const CONNECTION_STRING_SSL_PARAMS = new Set([
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslpassword",
  "sslcrl",
]);

export function stripConnectionStringSslParams(databaseUrl: string) {
  const url = new URL(databaseUrl);

  for (const key of Array.from(url.searchParams.keys())) {
    if (CONNECTION_STRING_SSL_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  return url.toString();
}

export function buildPgPoolConfig(args: { databaseUrl: string; ssl: DbSslConfig }): PoolConfig {
  return {
    connectionString: stripConnectionStringSslParams(args.databaseUrl),
    ssl: args.ssl,
  };
}

async function getSecretString(secretId: string) {
  const region = process.env.AWS_REGION || "us-east-1";
  const sm = new SecretsManagerClient({ region });
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!res.SecretString) throw new Error(`SecretString is empty for ${secretId}`);
  return res.SecretString;
}

async function getDatabaseUrl() {
  if (cachedDatabaseUrl) return cachedDatabaseUrl;
  const secretId = process.env.DB_URL_SECRET_ID;
  if (!secretId) throw new Error("Missing env DB_URL_SECRET_ID");
  cachedDatabaseUrl = (await getSecretString(secretId)).trim();
  return cachedDatabaseUrl;
}

async function getDatabaseCa() {
  const inlineCa = (process.env.DB_SSL_CA ?? "").replace(/\\n/g, "\n").trim();
  if (inlineCa) return inlineCa;

  if (cachedDatabaseCa) return cachedDatabaseCa;

  const secretId = process.env.DB_SSL_CA_SECRET_ID;
  if (!secretId) return "";

  cachedDatabaseCa = (await getSecretString(secretId)).replace(/\\n/g, "\n").trim();
  return cachedDatabaseCa;
}

async function getSslConfig(): Promise<DbSslConfig> {
  if ((process.env.DB_SSL ?? "").trim().toLowerCase() === "disable") return false;

  const rejectUnauthorized = (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? "true").trim().toLowerCase() !== "false";
  const ca = await getDatabaseCa();

  return ca ? { rejectUnauthorized, ca } : { rejectUnauthorized };
}

export async function getPrisma() {
  if (prisma) return prisma;

  const url = await getDatabaseUrl();

  pool = new Pool(buildPgPoolConfig({
    databaseUrl: url,
    ssl: await getSslConfig(),
  }));

  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
  return prisma;
}
