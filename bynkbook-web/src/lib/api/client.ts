import { fetchAuthSession } from "aws-amplify/auth";
import { metrics } from "@/lib/perf/metrics";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL!;

export async function apiFetch(path: string, init?: RequestInit) {
  const t0 = performance.now();

  const session = await fetchAuthSession();
  const accessToken = session.tokens?.accessToken?.toString();
  const idToken = session.tokens?.idToken?.toString();
  const token = accessToken ?? idToken;

  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  const ms = performance.now() - t0;
  const method = (init?.method ?? "GET").toUpperCase();
  metrics.api(`${method} ${path}`, ms, res.status);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}
