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
  return { businessId: p.businessId };
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

export async function handler(event: any) {
  try {
    const method = event?.requestContext?.http?.method;
    if (method !== "GET") return json(405, { ok: false, error: "Method not allowed" });

    const claims = getClaims(event);
    const sub = claims.sub as string | undefined;
    if (!sub) return json(401, { ok: false, error: "Unauthorized" });

    const { businessId = "" } = pp(event);
    const biz = businessId.toString().trim();
    if (!biz) return json(400, { ok: false, error: "Missing businessId" });

    const qs = event?.queryStringParameters ?? {};
    const status = (qs.status || "OPEN").toString().toUpperCase();
    const allowed = new Set(["OPEN", "RESOLVED", "ALL"]);
    if (!allowed.has(status)) return json(400, { ok: false, error: "Invalid status" });

    const accountIdRaw = (qs.accountId || "all").toString().trim();
    const accountId = !accountIdRaw || accountIdRaw.toLowerCase() === "all" ? "all" : accountIdRaw;

    const prisma = await getPrisma();

    const role = await requireRole(prisma, sub, biz);
    if (!role) return json(403, { ok: false, error: "Forbidden" });

    if (accountId !== "all") {
      const okAcct = await requireAccountInBusiness(prisma, biz, accountId);
      if (!okAcct) return json(404, { ok: false, error: "Account not found" });
    }

    const where: any = { business_id: biz };
    if (accountId !== "all") where.account_id = accountId;
    if (status !== "ALL") where.status = status;

    // Deleted entries must never appear as issues.
    // NOTE: Prisma schema does NOT expose an EntryIssue→Entry relation (no "entry" field),
    // so we filter by non-deleted Entry ids via a two-step fallback.
    const issueEntries = await prisma.entryIssue.findMany({
      where,
      select: { entry_id: true },
    });

      const seen = new Set<string>();
      const candidateIds: any[] = [];
      for (const r of issueEntries) {
        const id = String((r as any).entry_id);
        if (!seen.has(id)) {
          seen.add(id);
          candidateIds.push((r as any).entry_id);
        }
      }

      if (candidateIds.length === 0) {
        return json(200, { ok: true, status, accountId, count: 0 });
      }

      const CHUNK = 200;

      const nonDeletedIds: any[] = [];
      for (let i = 0; i < candidateIds.length; i += CHUNK) {
        const chunk = candidateIds.slice(i, i + CHUNK);
        const rows = await prisma.entry.findMany({
          where: { business_id: biz, deleted_at: null, id: { in: chunk } },
          select: { id: true },
        });
        for (const r of rows) nonDeletedIds.push(r.id);
      }

      if (nonDeletedIds.length === 0) {
        return json(200, { ok: true, status, accountId, count: 0 });
      }

      let total = 0;
      for (let i = 0; i < nonDeletedIds.length; i += CHUNK) {
        const chunk = nonDeletedIds.slice(i, i + CHUNK);
        const whereChunk: any = { ...where, entry_id: { in: chunk } };
        const c = await prisma.entryIssue.count({ where: whereChunk });
        total += Number(c);
      }

      return json(200, { ok: true, status, accountId, count: total });
  } catch (err: any) {
    // Self-diagnose without CloudWatch access
    return json(500, {
      ok: false,
      error: "INTERNAL",
      message: String(err?.message ?? err),
      name: String(err?.name ?? "Error"),
      code: err?.code ?? undefined,
    });
  }
}
