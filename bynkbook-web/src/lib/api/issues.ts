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

  entry_date?: string | null;
  entry_payee?: string | null;
  entry_memo?: string | null;
  entry_amount_cents?: string | null;
  entry_type?: string | null;
  entry_method?: string | null;
  entry_category_id?: string | null;
  entry_category_name?: string | null;
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

export type ListAccountIssuesResponse = {
  ok: true;
  issues: EntryIssueRow[];
  hasMore?: boolean;
  nextCursor?: string | null;
};

const DEFAULT_ENTRY_ID_CHUNK_SIZE = 50;
const DEFAULT_ENTRY_ID_CONCURRENCY = 3;

function uniqueEntryIds(entryIds: string[]) {
  return Array.from(new Set(entryIds.map((id) => String(id).trim()).filter(Boolean)));
}

function chunkEntryIds(entryIds: string[], chunkSize: number) {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: string[][] = [];
  for (let i = 0; i < entryIds.length; i += size) {
    chunks.push(entryIds.slice(i, i + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) break;
        results[index] = await mapper(items[index], index);
      }
    })
  );

  return results;
}

function buildAccountIssuesQuery(params: {
  status?: "OPEN" | "RESOLVED" | "ALL";
  limit?: number;
  cursor?: string | null;
  entryIds?: string[];
}) {
  const { status = "OPEN", limit, cursor, entryIds } = params;
  const qs = new URLSearchParams();
  qs.set("status", status);
  if (limit !== undefined) qs.set("limit", String(limit));
  if (cursor) qs.set("cursor", cursor);
  if (entryIds) {
    const ids = uniqueEntryIds(entryIds);
    qs.set("entryIds", ids.join(","));
  }
  return qs;
}

export async function listAccountIssues(params: {
  businessId: string;
  accountId: string;
  status?: "OPEN" | "RESOLVED" | "ALL";
  limit?: number;
  cursor?: string | null;
  entryIds?: string[];
}): Promise<ListAccountIssuesResponse> {
  const { businessId, accountId, status = "OPEN", limit, cursor, entryIds } = params;
  const qs = buildAccountIssuesQuery({ status, limit, cursor, entryIds });

  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/issues?${qs.toString()}`,
    { method: "GET" }
  );
}

export async function listAccountIssuesForEntryIds(params: {
  businessId: string;
  accountId: string;
  status?: "OPEN" | "RESOLVED" | "ALL";
  limit?: number;
  entryIds: string[];
  chunkSize?: number;
  concurrency?: number;
}): Promise<ListAccountIssuesResponse> {
  const {
    businessId,
    accountId,
    status = "OPEN",
    limit,
    entryIds,
    chunkSize = DEFAULT_ENTRY_ID_CHUNK_SIZE,
    concurrency = DEFAULT_ENTRY_ID_CONCURRENCY,
  } = params;
  const ids = uniqueEntryIds(entryIds);
  if (ids.length === 0) {
    return { ok: true, issues: [], hasMore: false, nextCursor: null };
  }

  const chunks = chunkEntryIds(ids, chunkSize);
  const responses = await mapWithConcurrency(chunks, concurrency, (chunk) =>
    listAccountIssues({
      businessId,
      accountId,
      status,
      limit,
      entryIds: chunk,
    })
  );

  const issuesById = new Map<string, EntryIssueRow>();
  let hasMore = false;
  let nextCursor: string | null = null;

  for (const response of responses) {
    hasMore = hasMore || Boolean(response.hasMore);
    nextCursor = nextCursor ?? response.nextCursor ?? null;

    for (const issue of response.issues ?? []) {
      const issueId = String(issue.id ?? "").trim();
      if (!issueId || issuesById.has(issueId)) continue;
      issuesById.set(issueId, issue);
    }
  }

  return {
    ok: true,
    issues: Array.from(issuesById.values()),
    hasMore,
    nextCursor,
  };
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
