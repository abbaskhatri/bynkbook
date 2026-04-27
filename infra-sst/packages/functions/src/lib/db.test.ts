import { Client } from "pg";
import { describe, expect, test } from "vitest";
import { buildPgPoolConfig, stripConnectionStringSslParams } from "./db";

describe("buildPgPoolConfig", () => {
  test("lets explicit CA SSL config win over sslmode=require in the connection string", () => {
    const config = buildPgPoolConfig({
      databaseUrl: "postgresql://user:pass@db.example.com:5432/app?sslmode=require&connect_timeout=10",
      ssl: {
        rejectUnauthorized: true,
        ca: "-----BEGIN CERTIFICATE-----\nTEST CA\n-----END CERTIFICATE-----",
      },
    });

    const client = new Client(config);

    expect(config.connectionString).not.toContain("sslmode=");
    expect(config.connectionString).toContain("connect_timeout=10");
    expect((client as any).connectionParameters.ssl).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\nTEST CA\n-----END CERTIFICATE-----",
    });
  });

  test("strips URL SSL parameters without removing unrelated connection options", () => {
    const stripped = stripConnectionStringSslParams(
      "postgresql://user:pass@db.example.com:5432/app?sslmode=require&sslrootcert=/tmp/root.pem&application_name=bynkbook"
    );

    expect(stripped).not.toContain("sslmode=");
    expect(stripped).not.toContain("sslrootcert=");
    expect(stripped).toContain("application_name=bynkbook");
  });
});
