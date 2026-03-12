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

function pushCount(map: Record<string, number>, key: string) {
  map[key] = (map[key] || 0) + 1;
}

function pluralize(count: number, singular: string, plural?: string) {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

function buildSummaryLines(params: {
  appliedByAction: Record<string, number>;
  skippedByReason: Record<string, number>;
  appliedCount: number;
  skippedCount: number;
  blockedCount: number;
}) {
  const { appliedByAction, skippedByReason, appliedCount, skippedCount, blockedCount } = params;
  const lines: string[] = [];

  const staleCount = appliedByAction.ACK_STALE || 0;
  const legitimizeCount = appliedByAction.LEGITIMIZE || 0;

  if (staleCount > 0) {
    lines.push(`${staleCount} ${pluralize(staleCount, "stale check")} acknowledged.`);
  }
  if (legitimizeCount > 0) {
    lines.push(`${legitimizeCount} ${pluralize(legitimizeCount, "duplicate issue")} marked legitimate.`);
  }
  if (skippedCount > 0) {
    lines.push(`${skippedCount} ${pluralize(skippedCount, "selected item")} were skipped.`);
  }
  if (blockedCount > 0) {
    lines.push(`${blockedCount} ${pluralize(blockedCount, "selected item")} were blocked.`);
  }
  if (appliedCount === 0 && skippedCount === 0 && blockedCount === 0) {
    lines.push("No eligible open issues were applied.");
  }

  const orderedReasons = [
    "NOT_FOUND",
    "OUT_OF_SCOPE",
    "ALREADY_RESOLVED",
    "NOT_OPEN",
    "ENTRY_NOT_FOUND_OR_DELETED",
    "REVIEW_REQUIRED",
    "UNSUPPORTED_TYPE",
  ] as const;

  for (const reason of orderedReasons) {
    const count = skippedByReason[reason] || 0;
    if (count > 0) {
      if (reason === "NOT_FOUND") {
        lines.push(`${count} ${pluralize(count, "selected item")} could not be found.`);
      } else if (reason === "OUT_OF_SCOPE") {
        lines.push(`${count} ${pluralize(count, "selected item")} were outside this business or account.`);
      } else if (reason === "ALREADY_RESOLVED") {
        lines.push(`${count} ${pluralize(count, "selected item")} were already resolved.`);
      } else if (reason === "NOT_OPEN") {
        lines.push(`${count} ${pluralize(count, "selected item")} were not open.`);
      } else if (reason === "ENTRY_NOT_FOUND_OR_DELETED") {
        lines.push(`${count} ${pluralize(count, "selected item")} were skipped because the linked entry is missing or deleted.`);
      } else if (reason === "REVIEW_REQUIRED") {
        lines.push(`${count} ${pluralize(count, "selected item")} still require manual review and were not bulk applied.`);
      } else if (reason === "UNSUPPORTED_TYPE") {
        lines.push(`${count} ${pluralize(count, "selected item")} are not supported in bulk apply.`);
      }
    }
  }

  return lines;
}

function classifySafeAction(issueTypeRaw: any): SafeAction | null {
  const issueType = String(issueTypeRaw ?? "").toUpperCase();
  if (issueType === "STALE_CHECK") return "ACK_STALE";
  if (issueType === "DUPLICATE") return "LEGITIMIZE";
  return null;
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;

  if (method !== "POST" || !path?.includes("/issues/bulk-apply")) {
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

    const rawSafeIssueIds = Array.isArray(body?.safe_issue_ids) ? body.safe_issue_ids : [];
    const safeIssueIds: string[] = Array.from(
      new Set<string>(
        rawSafeIssueIds
          .map((v: any) => String(v ?? "").trim())
          .filter((v: string): v is string => !!v)
      )
    );
    const safeIssueIdSet = new Set<string>(safeIssueIds);

    const prisma = await getPrisma();

    const role = await requireRole(prisma, sub, biz);
    if (!role) return json(403, { ok: false, error: "Forbidden" });

    const acctOk = await requireAccountInBusiness(prisma, biz, acct);
    if (!acctOk) return json(404, { ok: false, error: "Account not found" });

    const allSelectedRows = await prisma.entryIssue.findMany({
      where: {
        id: { in: issueIds },
      },
      select: {
        id: true,
        business_id: true,
        account_id: true,
        entry_id: true,
        issue_type: true,
        status: true,
        resolved_at: true,
      },
    });

    const rowById = new Map<string, any>(allSelectedRows.map((r: any) => [String(r.id), r]));

    const openScopedRows = allSelectedRows.filter((row: any) => {
      return (
        String(row.business_id) === biz &&
        String(row.account_id) === acct &&
        String(row.status ?? "") === "OPEN"
      );
    });

    const entryIds = Array.from(new Set(openScopedRows.map((r: any) => String(r.entry_id))));
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
          },
        })
      : [];

    const entryIdSet = new Set<string>(entryRows.map((e: any) => String(e.id)));

    const skippedByReason: Record<string, number> = {};
    const appliedByAction: Record<string, number> = {};

    const applyIdsByAction: Record<SafeAction, string[]> = {
      ACK_STALE: [],
      LEGITIMIZE: [],
    };

    for (const requestedId of issueIds) {
      const row = rowById.get(String(requestedId));

      if (!row) {
        pushCount(skippedByReason, "NOT_FOUND");
        continue;
      }

      if (String(row.business_id) !== biz || String(row.account_id) !== acct) {
        pushCount(skippedByReason, "OUT_OF_SCOPE");
        continue;
      }

      if (String(row.status ?? "") !== "OPEN") {
        if (row.resolved_at) {
          pushCount(skippedByReason, "ALREADY_RESOLVED");
        } else {
          pushCount(skippedByReason, "NOT_OPEN");
        }
        continue;
      }

      if (!entryIdSet.has(String(row.entry_id))) {
        pushCount(skippedByReason, "ENTRY_NOT_FOUND_OR_DELETED");
        continue;
      }

      const action = classifySafeAction(row.issue_type);
      if (!action) {
        pushCount(skippedByReason, "UNSUPPORTED_TYPE");
        continue;
      }

      if (action === "LEGITIMIZE" && !safeIssueIdSet.has(String(row.id))) {
        pushCount(skippedByReason, "REVIEW_REQUIRED");
        continue;
      }

      applyIdsByAction[action].push(String(row.id));
    }

    const now = new Date();
    const actor = sub;

    let appliedCount = 0;

    await prisma.$transaction(async (tx: any) => {
      for (const action of ["ACK_STALE", "LEGITIMIZE"] as const) {
        const ids = Array.from(new Set(applyIdsByAction[action]));
        if (!ids.length) continue;

        const result = await tx.entryIssue.updateMany({
          where: {
            id: { in: ids },
            business_id: biz,
            account_id: acct,
            status: "OPEN",
          },
          data: {
            status: "RESOLVED",
            resolution:
              action === "ACK_STALE"
                ? "ACK_STALE"
                : "LEGITIMIZE",
            resolved_at: now,
            updated_at: now,
          },
        });

        const count = Number(result?.count ?? 0);
        if (count > 0) {
          appliedCount += count;
          pushCount(appliedByAction, action);
          if (count > 1) {
            appliedByAction[action] = count;
          }
        }
      }
    });

    const requestedCount = issueIds.length;
    const eligibleCount =
      Array.from(new Set(applyIdsByAction.ACK_STALE)).length +
      Array.from(new Set(applyIdsByAction.LEGITIMIZE)).length;
    const skippedCount = Object.values(skippedByReason).reduce((sum, n) => sum + Number(n || 0), 0);
    const blockedCount = Math.max(eligibleCount - appliedCount, 0);

    return json(200, {
      ok: true,
      requested_count: requestedCount,
      eligible_count: eligibleCount,
      applied_count: appliedCount,
      skipped_count: skippedCount,
      blocked_count: blockedCount,
      applied_by_action: {
        ACK_STALE: appliedByAction.ACK_STALE || 0,
        LEGITIMIZE: appliedByAction.LEGITIMIZE || 0,
      },
      skipped_by_reason: skippedByReason,
      summary_lines: buildSummaryLines({
        appliedByAction: {
          ACK_STALE: appliedByAction.ACK_STALE || 0,
          LEGITIMIZE: appliedByAction.LEGITIMIZE || 0,
        },
        skippedByReason,
        appliedCount,
        skippedCount,
        blockedCount,
      }),
    });
  } catch (err: any) {
    console.error("issuesBulkApply error:", err);
    return json(500, { ok: false, error: "Internal Server Error" });
  }
}