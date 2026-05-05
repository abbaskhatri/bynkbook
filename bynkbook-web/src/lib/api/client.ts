import { fetchAuthSession } from "aws-amplify/auth";
import { metrics } from "@/lib/perf/metrics";

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
// Phase 2 Performance: in-memory token cache + coalescing
let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let tokenPromise: Promise<string | null> | null = null;

async function getAuthToken(): Promise<string | null> {
  const now = Date.now();

  // Valid cached token
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  // If a token fetch is already in-flight, reuse it
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    try {
      const session = await fetchAuthSession();
      const accessToken = session.tokens?.accessToken?.toString();
      const idToken = session.tokens?.idToken?.toString();
      const token = accessToken ?? idToken ?? null;

      cachedToken = token;
      tokenExpiresAt = Date.now() + 60_000; // 60s cache window

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

export async function apiFetch(path: string, init?: RequestInit) {
  const t0 = performance.now();

const token = await getAuthToken();

  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${API_BASE ?? ""}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

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
