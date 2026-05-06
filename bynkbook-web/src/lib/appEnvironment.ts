"use client";

export type AppEnvironmentLabel = "PROD" | "DEV" | "LOCAL" | "TEST" | "STAGE";

export type ConfiguredAppEnvironment = {
  label: AppEnvironmentLabel;
  source: "NEXT_PUBLIC_APP_ENV" | "NEXT_PUBLIC_DEPLOY_ENV" | "NEXT_PUBLIC_ENV" | "NODE_ENV";
  raw: string;
  explicit: boolean;
};

function normalizeEnv(raw: string): AppEnvironmentLabel | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;

  if (["prod", "production", "live"].includes(v)) return "PROD";
  if (["stage", "staging", "preview", "qa"].includes(v)) return "STAGE";
  if (["test", "testing"].includes(v)) return "TEST";
  if (["local", "localhost"].includes(v)) return "LOCAL";
  if (["dev", "development", "sandbox"].includes(v)) return "DEV";

  return null;
}

export function getConfiguredAppEnvironment(): ConfiguredAppEnvironment {
  const candidates = [
    ["NEXT_PUBLIC_APP_ENV", process.env.NEXT_PUBLIC_APP_ENV],
    ["NEXT_PUBLIC_DEPLOY_ENV", process.env.NEXT_PUBLIC_DEPLOY_ENV],
    ["NEXT_PUBLIC_ENV", process.env.NEXT_PUBLIC_ENV],
  ] as const;

  for (const [source, value] of candidates) {
    const raw = String(value ?? "").trim();
    const label = normalizeEnv(raw);
    if (label) return { label, source, raw, explicit: true };
  }

  const raw = String(process.env.NODE_ENV ?? "").trim();
  const label = normalizeEnv(raw) ?? "LOCAL";

  return {
    label,
    source: "NODE_ENV",
    raw,
    explicit: false,
  };
}
