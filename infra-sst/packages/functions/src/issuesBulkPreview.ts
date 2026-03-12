import { buildDuplicateEvidence } from "./issuesDuplicateEvidence";
import { reviewDuplicateEvidenceWithAI } from "./issuesDuplicateReviewAI";
import { getPrisma } from "./lib/db";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function pp(event: any) {
  const p = event?.pathParameters ?? {};
  return {
    businessId: p.businessId,
    accountId: p.accountId,
  };
}

function getClaims(event: any) {
  const claims =
    event?.requestContext?.authorizer?.jwt?.claims ??
    event?.requestContext?.authorizer?.claims ??
    {};
  return claims as any;
}

async function requireRole(prisma: any, userId: string, businessId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

async function requireAccountInBusiness(prisma: any, businessId: string, accountId: string) {
  const acct = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true },
  });
  return !!acct;
}

type SafeAction = "ACK_STALE" | "LEGITIMIZE";
type PreviewBucket = "safe_auto_fix" | "likely_duplicate" | "needs_review" | "unsupported";
type PreviewClass = "LIKELY_DUPLICATE" | "LIKELY_LEGITIMATE_REPEAT" | "NEEDS_REVIEW";
type PreviewConfidence = "HIGH" | "MEDIUM" | "REVIEW";
type SuggestedNextStep = "MARK_LEGITIMATE" | "REVIEW_MANUALLY";

type PreviewItem = {
  issue_id: string;
  entry_id: string;
  issue_type: string;
  bucket: PreviewBucket;
  action: SafeAction | null;
  date: string | null;
  payee: string;
  amount_cents: string;
  method: string | null;
  details: string;
  group_key: string | null;
  status: string;
  classification?: PreviewClass;
  confidence_label?: PreviewConfidence;
  explanation?: string;
  suggested_next_step?: SuggestedNextStep;
};

function toYmd(value: any): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function makePreviewItem(
  issue: any,
  entry: any,
  bucket: PreviewBucket,
  action: SafeAction | null,
  extra?: Partial<Pick<PreviewItem, "classification" | "confidence_label" | "explanation" | "suggested_next_step">>
): PreviewItem {
  return {
    issue_id: String(issue.id),
    entry_id: String(issue.entry_id),
    issue_type: String(issue.issue_type ?? ""),
    bucket,
    action,
    date: toYmd(entry?.date),
    payee: String(entry?.payee ?? "").trim(),
    amount_cents: String(entry?.amount_cents ?? "0"),
    method: entry?.method ? String(entry.method) : null,
    details: String(issue.details ?? ""),
    group_key: issue?.group_key ? String(issue.group_key) : null,
    status: String(issue.status ?? ""),
    classification: extra?.classification,
    confidence_label: extra?.confidence_label,
    explanation: extra?.explanation,
    suggested_next_step: extra?.suggested_next_step,
  };
}
function pushCount(map: Record<string, number>, key: string) {
  map[key] = (map[key] || 0) + 1;
}

function pluralize(count: number, singular: string, plural?: string) {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

function buildSummaryLines(params: {
  safeByAction: Record<string, number>;
  likelyDuplicateCount: number;
  needsReviewCount: number;
  unsupportedCount: number;
  skippedCount: number;
}) {
  const {
    safeByAction,
    likelyDuplicateCount,
    needsReviewCount,
    unsupportedCount,
    skippedCount,
  } = params;

  const lines: string[] = [];

  const staleCount = safeByAction.ACK_STALE || 0;
  const legitimizeCount = safeByAction.LEGITIMIZE || 0;

  if (staleCount > 0) {
    lines.push(`${staleCount} ${pluralize(staleCount, "stale check")} can be acknowledged.`);
  }
  if (legitimizeCount > 0) {
    lines.push(`${legitimizeCount} ${pluralize(legitimizeCount, "duplicate issue")} can be marked legitimate.`);
  }
  if (likelyDuplicateCount > 0) {
    lines.push(`${likelyDuplicateCount} ${pluralize(likelyDuplicateCount, "duplicate issue")} look like posted-twice transactions and should be reviewed manually.`);
  }
  if (needsReviewCount > 0) {
    lines.push(`${needsReviewCount} ${pluralize(needsReviewCount, "selected item")} need manual review before any action.`);
  }
  if (unsupportedCount > 0) {
    lines.push(`${unsupportedCount} ${pluralize(unsupportedCount, "selected item")} are not supported in bulk.`);
  }
  if (skippedCount > 0) {
    lines.push(`${skippedCount} ${pluralize(skippedCount, "selected item")} were skipped because they are missing, out of scope, deleted, or not open.`);
  }
  if (lines.length === 0) {
    lines.push("No eligible open issues were found for bulk preview.");
  }

  return lines;
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;

  if (method !== "POST" || !path?.includes("/issues/bulk-preview")) {
    return json(404, { ok: false, error: "Not found" });
  }

  try {
    const claims = getClaims(event);
    const sub = (claims.sub as string | undefined) ?? "";
    if (!sub) return json(401, { ok: false, error: "Unauthorized" });

    const { businessId = "", accountId = "" } = pp(event);
    const biz = businessId.toString().trim();
    const acct = accountId.toString().trim();
    if (!biz || !acct) return json(400, { ok: false, error: "Missing businessId/accountId" });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const rawIssueIds = Array.isArray(body?.issue_ids) ? body.issue_ids : null;
    if (!rawIssueIds) {
      return json(400, { ok: false, error: "issue_ids must be an array" });
    }

    const issueIds: string[] = Array.from(
      new Set<string>(
        rawIssueIds
          .map((v: any) => String(v ?? "").trim())
          .filter((v: string): v is string => !!v)
      )
    );

    if (issueIds.length === 0) {
      return json(400, { ok: false, error: "issue_ids must contain at least one issue id" });
    }

    const prisma = await getPrisma();

    const role = await requireRole(prisma, sub, biz);
    if (!role) return json(403, { ok: false, error: "Forbidden" });

    const acctOk = await requireAccountInBusiness(prisma, biz, acct);
    if (!acctOk) return json(404, { ok: false, error: "Account not found" });

    const issueRows = await prisma.entryIssue.findMany({
      where: {
        id: { in: issueIds },
        business_id: biz,
        account_id: acct,
        status: "OPEN",
      },
      orderBy: [
        { issue_type: "asc" },
        { detected_at: "desc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        entry_id: true,
        issue_type: true,
        status: true,
        severity: true,
        group_key: true,
        details: true,
        detected_at: true,
        resolved_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    const entryIds = Array.from(new Set(issueRows.map((r: any) => String(r.entry_id))));
    const entryRows = entryIds.length
      ? await prisma.entry.findMany({
          where: {
            id: { in: entryIds },
            business_id: biz,
            account_id: acct,
            deleted_at: null,
          },
          select: {
            id: true,
            date: true,
            payee: true,
            amount_cents: true,
            method: true,
            memo: true,
          },
        })
      : [];

    const entryById = new Map<string, any>(entryRows.map((e: any) => [String(e.id), e]));

    const safeAutoFix: PreviewItem[] = [];
    const likelyDuplicate: PreviewItem[] = [];
    const needsReview: PreviewItem[] = [];
    const unsupported: PreviewItem[] = [];

    const countsByIssueType: Record<string, number> = {};
    const safeByAction: Record<string, number> = {};
    const skippedByReason: Record<string, number> = {};

    const duplicateIssues: any[] = [];
    const duplicateEntries: any[] = [];

    for (const issue of issueRows) {
      const entry = entryById.get(String(issue.entry_id));
      if (!entry) {
        pushCount(skippedByReason, "ENTRY_NOT_FOUND_OR_DELETED");
        continue;
      }

      const issueType = String(issue.issue_type ?? "").toUpperCase();
      pushCount(countsByIssueType, issueType);

      if (issueType === "STALE_CHECK") {
        safeAutoFix.push(
          makePreviewItem(issue, entry, "safe_auto_fix", "ACK_STALE")
        );
        pushCount(safeByAction, "ACK_STALE");
        continue;
      }

      if (issueType === "DUPLICATE") {
        duplicateIssues.push(issue);
        duplicateEntries.push(entry);
        continue;
      }

      unsupported.push(
        makePreviewItem(issue, entry, "unsupported", null)
      );
    }

    const duplicateEvidence = buildDuplicateEvidence({
      issues: duplicateIssues,
      entries: duplicateEntries,
    });

    const aiResults = await reviewDuplicateEvidenceWithAI(duplicateEvidence);
    const aiByIssueId = new Map<string, (typeof aiResults)[number]>(
      aiResults.map((it) => [it.issue_id, it])
    );

    for (const issue of duplicateIssues) {
      const entry = entryById.get(String(issue.entry_id));
      if (!entry) continue;

      const ai = aiByIssueId.get(String(issue.id));

      if (!ai) {
        needsReview.push(
          makePreviewItem(issue, entry, "needs_review", null, {
            classification: "NEEDS_REVIEW",
            confidence_label: "REVIEW",
            explanation: "Review manually before resolving this duplicate.",
            suggested_next_step: "REVIEW_MANUALLY",
          })
        );
        continue;
      }

      if (ai.classification === "LIKELY_LEGITIMATE_REPEAT") {
        safeAutoFix.push(
          makePreviewItem(issue, entry, "safe_auto_fix", "LEGITIMIZE", {
            classification: ai.classification,
            confidence_label: ai.confidence_label,
            explanation: ai.explanation,
            suggested_next_step: ai.suggested_next_step,
          })
        );
        pushCount(safeByAction, "LEGITIMIZE");
        continue;
      }

      if (ai.classification === "LIKELY_DUPLICATE") {
        likelyDuplicate.push(
          makePreviewItem(issue, entry, "likely_duplicate", null, {
            classification: ai.classification,
            confidence_label: ai.confidence_label,
            explanation: ai.explanation,
            suggested_next_step: ai.suggested_next_step,
          })
        );
        continue;
      }

      needsReview.push(
        makePreviewItem(issue, entry, "needs_review", null, {
          classification: ai.classification,
          confidence_label: ai.confidence_label,
          explanation: ai.explanation,
          suggested_next_step: ai.suggested_next_step,
        })
      );
    }

    const requestedCount = issueIds.length;
    const validOpenSelectedCount = issueRows.length;
    const eligiblePreviewedCount = validOpenSelectedCount;
    const skippedCount = Math.max(requestedCount - validOpenSelectedCount, 0);

    return json(200, {
      ok: true,
      requested_count: requestedCount,
      valid_open_selected_count: validOpenSelectedCount,
      eligible_previewed_count: eligiblePreviewedCount,
      skipped_count: skippedCount < 0 ? 0 : skippedCount,
      counts_by_issue_type: countsByIssueType,
      safe_by_action: safeByAction,
      skipped_by_reason: skippedByReason,
      safe_auto_fix: safeAutoFix,
      likely_duplicate: likelyDuplicate,
      needs_review: needsReview,
      unsupported,
      summary_lines: buildSummaryLines({
        safeByAction,
        likelyDuplicateCount: likelyDuplicate.length,
        needsReviewCount: needsReview.length,
        unsupportedCount: unsupported.length,
        skippedCount: skippedCount < 0 ? 0 : skippedCount,
      }),
    });
  } catch (err: any) {
    console.error("issuesBulkPreview error:", err);
    return json(500, { ok: false, error: "Internal Server Error" });
  }
}