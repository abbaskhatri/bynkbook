import { fetchAuthSession } from "aws-amplify/auth";
import { metrics } from "@/lib/perf/metrics";

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const DEFAULT_TIMEOUT_MS = 30_000;
const AUTH_TOKEN_TIMEOUT_MS = 15_000;

export type ApiFetchInit = RequestInit & {
  timeoutMs?: number;
};

// Phase 2 Performance: in-memory token cache + coalescing
let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let tokenPromise: Promise<string | null> | null = null;

function timeoutError(label: string, ms: number) {
  const err: any = new Error(`${label} timed out after ${ms}ms`);
  err.code = "TIMEOUT";
  return err;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = globalThis.setTimeout(() => reject(timeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timeout) globalThis.clearTimeout(timeout);
  }
}

async function fetchSessionToken(forceRefresh: boolean): Promise<string | null> {
  const session = await withTimeout(
    fetchAuthSession(forceRefresh ? { forceRefresh: true } : undefined),
    AUTH_TOKEN_TIMEOUT_MS,
    forceRefresh ? "Auth session refresh" : "Auth session"
  );
  const accessToken = session.tokens?.accessToken?.toString();
  const idToken = session.tokens?.idToken?.toString();
  return accessToken ?? idToken ?? null;
}

async function getAuthToken(): Promise<string | null> {
  const now = Date.now();

  // Valid cached token
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  // If a token fetch is already in-flight, reuse it
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    let token: string | null = null;

    try {
      token = await fetchSessionToken(false);
    } catch {
      token = null;
    }

    if (!token) {
      token = await fetchSessionToken(true).catch(() => null);
    }

    try {
      cachedToken = token;
      tokenExpiresAt = token ? Date.now() + 60_000 : 0; // 60s cache window

      return token;
    } finally {
      tokenPromise = null;
    }
  })();

  return tokenPromise;
}

if (!API_BASE && process.env.NODE_ENV !== "production") {
  throw new Error("Missing NEXT_PUBLIC_API_URL. Set it in .env.local (see .env.example).");
}

function joinSignals(signals: Array<AbortSignal | null | undefined>) {
  const activeSignals = signals.filter((signal): signal is AbortSignal => !!signal);
  if (activeSignals.length === 0) return null;
  if (activeSignals.length === 1) return activeSignals[0];

  const controller = new AbortController();
  const abort = () => controller.abort();

  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }

  return controller.signal;
}

export async function apiFetch(path: string, init?: ApiFetchInit) {
  const t0 = performance.now();

  const token = await getAuthToken();
  if (!token) {
    const err: any = new Error("Auth session unavailable. Please sign in again.");
    err.status = 401;
    err.code = "AUTH_SESSION_UNAVAILABLE";
    throw err;
  }

  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const timeoutMs = Math.max(Number(init?.timeoutMs ?? DEFAULT_TIMEOUT_MS), 1);
  const timeoutController = new AbortController();
  const timeout = globalThis.setTimeout(() => timeoutController.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_BASE ?? ""}${path}`, {
      ...init,
      headers,
      signal: joinSignals([init?.signal, timeoutController.signal]) ?? undefined,
      cache: "no-store",
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }

  const ms = performance.now() - t0;
  const method = (init?.method ?? "GET").toUpperCase();
  metrics.api(`${method} ${path}`, ms, res.status);

  if (!res.ok) {
    // Centralized CLOSED_PERIOD UX (Operational Core Ready)
    const contentType = res.headers.get("content-type") || "";
    let payload: any = null;
    let text = "";

    if (contentType.includes("application/json")) {
      payload = await res.json().catch(() => null);
    } else {
      text = await res.text().catch(() => "");
    }

    if (res.status === 409 && payload?.code === "CLOSED_PERIOD") {
      const err: any = new Error(payload?.error || "This period is closed. Reopen period to modify.");
      err.status = 409;
      err.code = "CLOSED_PERIOD";
      err.payload = payload;
      throw err;
    }

    if (res.status === 409 && payload?.code === "CANNOT_CLOSE_BEYOND_TODAY") {
      const err: any = new Error(payload?.error || "Cannot close beyond today.");
      err.status = 409;
      err.code = "CANNOT_CLOSE_BEYOND_TODAY";
      err.payload = payload;
      throw err;
    }

    if (res.status === 409 && payload?.code === "ENTRY_MATCHED_REQUIRES_UNMATCH") {
      const err: any = new Error(
        payload?.message ||
          "This entry is matched to a bank transaction. Unmatch or revert the match before deleting it."
      );
      err.status = 409;
      err.code = "ENTRY_MATCHED_REQUIRES_UNMATCH";
      err.payload = payload;
      throw err;
    }

    if (
      payload?.code &&
      [
        "CONFIRMATION_REQUIRED",
        "HARD_DELETE_NOT_ALLOWED",
        "ENTRY_NOT_ACTIVE_MATCHED",
        "MATCH_GROUP_NOT_ACTIVE",
        "MATCHED_DELETE_AMBIGUOUS",
        "MATCHED_BANK_TRANSACTION_NOT_FOUND",
        "MATCHED_DELETE_FAILED",
      ].includes(String(payload.code))
    ) {
      const err: any = new Error(payload?.error || "Matched entry could not be unmatched and deleted.");
      err.status = res.status;
      err.code = payload.code;
      err.payload = payload;
      throw err;
    }

    if (!text) {
      text = payload ? JSON.stringify(payload) : res.statusText;
    }

    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}
