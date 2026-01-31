import { apiFetch } from "@/lib/api/client";

export type EntryIssueRow = {
  id: string;
  business_id: string;
  account_id: string;
  entry_id: string;
  issue_type: "DUPLICATE" | "MISSING_CATEGORY" | "STALE_CHECK" | string;
  status: "OPEN" | "RESOLVED" | string;
  severity?: string;
  group_key?: string | null;
  details?: string;
  detected_at?: string;
  resolved_at?: string | null;
};

export async function listAccountIssues(params: {
  businessId: string;
  accountId: string;
  status?: "OPEN" | "RESOLVED";
  limit?: number;
}): Promise<{ ok: true; issues: EntryIssueRow[] }> {
  const { businessId, accountId, status = "OPEN", limit = 200 } = params;
  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/issues?status=${encodeURIComponent(status)}&limit=${limit}`,
    { method: "GET" }
  );
}

export async function resolveIssue(params: {
  businessId: string;
  accountId: string;
  issueId: string;
  action: "LEGITIMIZE" | "ACK_STALE" | "FIX_MISSING_CATEGORY";
  category_id?: string;
}): Promise<any> {
  const { businessId, accountId, issueId, action, category_id } = params;
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/issues/${issueId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ action, category_id }),
  });
}

export async function getBusinessIssuesCount(params: {
  businessId: string;
}): Promise<{ ok: true; total_open: number; by_account?: Record<string, number> }> {
  const { businessId } = params;
  const res: any = await apiFetch(`/v1/businesses/${businessId}/issues/count`, { method: "GET" });

  // Be flexible: different shapes across versions
  const total_open =
    Number(res?.total_open ?? res?.open ?? res?.count ?? res?.total ?? 0) || 0;

  const by_account =
    (res?.by_account ?? res?.byAccount ?? res?.accounts ?? null) as Record<string, number> | null;

  return { ok: true, total_open, by_account: by_account ?? undefined };
}

// Backwards-compatible alias (Dashboard imports getIssuesCount)
// Older callers pass (businessId, { status, accountId })
export async function getIssuesCount(
  businessId: string,
  opts?: { status?: "OPEN" | "RESOLVED"; accountId?: string }
): Promise<{ ok: true; count: number }> {
  const status = opts?.status ?? "OPEN";
  const accountId = opts?.accountId ?? "all";

  // We only have an authoritative count endpoint (business-wide).
  // If accountId === "all" use business count; otherwise use account issues list count.
  if (accountId === "all" || !accountId) {
    const res = await getBusinessIssuesCount({ businessId });
    return { ok: true, count: res.total_open };
  }

  const list = await listAccountIssues({ businessId, accountId, status, limit: 500 });
  return { ok: true, count: list.issues.length };
}