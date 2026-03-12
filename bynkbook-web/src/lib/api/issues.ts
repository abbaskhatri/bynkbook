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

export type BulkIssueSafeAction = "ACK_STALE" | "LEGITIMIZE";
export type BulkIssuePreviewBucket =
  | "safe_auto_fix"
  | "likely_duplicate"
  | "needs_review"
  | "unsupported";

export type BulkIssuePreviewClass =
  | "LIKELY_DUPLICATE"
  | "LIKELY_LEGITIMATE_REPEAT"
  | "NEEDS_REVIEW";

export type BulkIssueConfidenceLabel = "HIGH" | "MEDIUM" | "REVIEW";

export type BulkIssueSuggestedNextStep =
  | "MARK_LEGITIMATE"
  | "REVIEW_MANUALLY";

export type BulkIssuePreviewItem = {
  issue_id: string;
  entry_id: string;
  issue_type: string;
  bucket: BulkIssuePreviewBucket;
  action: BulkIssueSafeAction | null;
  date: string | null;
  payee: string;
  amount_cents: string;
  method: string | null;
  details: string;
  group_key: string | null;
  status: string;
  classification?: BulkIssuePreviewClass;
  confidence_label?: BulkIssueConfidenceLabel;
  explanation?: string;
  suggested_next_step?: BulkIssueSuggestedNextStep;
};

export type BulkPreviewIssuesResponse = {
  ok: true;
  requested_count: number;
  valid_open_selected_count: number;
  eligible_previewed_count: number;
  skipped_count: number;
  counts_by_issue_type: Record<string, number>;
  safe_by_action: Record<string, number>;
  skipped_by_reason: Record<string, number>;
  safe_auto_fix: BulkIssuePreviewItem[];
  likely_duplicate: BulkIssuePreviewItem[];
  needs_review: BulkIssuePreviewItem[];
  unsupported: BulkIssuePreviewItem[];
  summary_lines: string[];
};

export type BulkApplyIssuesResponse = {
  ok: true;
  requested_count: number;
  eligible_count: number;
  applied_count: number;
  skipped_count: number;
  blocked_count: number;
  applied_by_action: Record<BulkIssueSafeAction, number>;
  skipped_by_reason: Record<string, number>;
  summary_lines: string[];
};

export const ISSUES_PAGE_TYPES = ["DUPLICATE", "STALE_CHECK"] as const;
export type IssuesPageIssueType = (typeof ISSUES_PAGE_TYPES)[number];

export function isIssuesPageIssueType(issueType: unknown): issueType is IssuesPageIssueType {
  const t = String(issueType ?? "").toUpperCase();
  return t === "DUPLICATE" || t === "STALE_CHECK";
}

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

  // Sidebar "Issues" must match the Issues page universe exactly:
  // OPEN issues of type DUPLICATE + STALE_CHECK only (no mixed scopes).
  // Keep it server-derived and deterministic by counting from the authoritative list endpoint.
  //
  // NOTE: Backend /issues/count does not support type filtering today, so we filter deterministically client-side.
  if (accountId && accountId !== "all") {
    const list = await listAccountIssues({ businessId, accountId, status, limit: 500 });
    const count = (list.issues ?? []).filter((it) => isIssuesPageIssueType((it as any).issue_type)).length;
    return { ok: true, count };
  }

  // Business-wide fallback (not used by single-account routes)
  const res: any = await apiFetch(
    `/v1/businesses/${businessId}/issues/count?status=${encodeURIComponent(status)}&accountId=${encodeURIComponent(accountId)}`,
    { method: "GET" }
  );

  const n = Number(res?.count ?? res?.total_open ?? res?.open ?? 0) || 0;
  return { ok: true, count: n };
}

export async function bulkPreviewIssues(params: {
  businessId: string;
  accountId: string;
  issueIds: string[];
}): Promise<BulkPreviewIssuesResponse> {
  const { businessId, accountId, issueIds } = params;
  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/issues/bulk-preview`,
    {
      method: "POST",
      body: JSON.stringify({ issue_ids: issueIds }),
    }
  );
}

export async function bulkApplyIssues(params: {
  businessId: string;
  accountId: string;
  issueIds: string[];
  safeIssueIds?: string[];
}): Promise<BulkApplyIssuesResponse> {
  const { businessId, accountId, issueIds, safeIssueIds } = params;
  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/issues/bulk-apply`,
    {
      method: "POST",
      body: JSON.stringify({
        issue_ids: issueIds,
        safe_issue_ids: safeIssueIds ?? [],
      }),
    }
  );
}