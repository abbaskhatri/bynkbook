import { apiFetch } from "./client";

export async function getIssuesCount(
  businessId: string,
  opts: { status: "OPEN" | "RESOLVED" | "ALL"; accountId: string }
): Promise<{ ok: true; status: string; accountId: string; count: number }> {
  const qs = new URLSearchParams({
    status: opts.status,
    accountId: opts.accountId ?? "all",
  }).toString();

  return apiFetch(`/v1/businesses/${businessId}/issues/count?${qs}`);
}
