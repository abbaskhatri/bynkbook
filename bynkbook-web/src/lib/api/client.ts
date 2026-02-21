import { fetchAuthSession } from "aws-amplify/auth";
import { metrics } from "@/lib/perf/metrics";

const API_BASE = process.env.NEXT_PUBLIC_API_URL;

if (!API_BASE && process.env.NODE_ENV !== "production") {
  throw new Error("Missing NEXT_PUBLIC_API_URL. Set it in .env.local (see .env.example).");
}

export async function apiFetch(path: string, init?: RequestInit) {
  const t0 = performance.now();

  const session = await fetchAuthSession();
  const accessToken = session.tokens?.accessToken?.toString();
  const idToken = session.tokens?.idToken?.toString();
  const token = accessToken ?? idToken;

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

    if (!text) {
      text = payload ? JSON.stringify(payload) : res.statusText;
    }

    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}
