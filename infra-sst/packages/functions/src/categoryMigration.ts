import { getPrisma } from "./lib/db";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getClaims(event: any) {
  const claims =
    event?.requestContext?.authorizer?.jwt?.claims ??
    event?.requestContext?.authorizer?.claims ??
    {};
  return claims as any;
}

function pp(event: any) {
  const p = event?.pathParameters ?? {};
  return { businessId: p.businessId };
}

async function requireRole(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

function isOwner(role: string | null) {
  return role === "OWNER";
}

function normalizeMemo(s: string) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

function looksLikeCategoryLabel(s: string) {
  const t = normalizeMemo(s);
  if (!t) return false;
  if (t.length > 64) return false;
  if (t.includes("\n") || t.includes("\r") || t.includes("\t")) return false;
  // Avoid obvious sentence-y memos
  if (t.length >= 40 && t.includes(".")) return false;
  return true;
}

export async function handler(event: any) {
  try {
    const method = event?.requestContext?.http?.method;
    const path = event?.requestContext?.http?.path ?? event?.rawPath ?? "";

  const claims = getClaims(event);
  const sub = (claims.sub as string | undefined) ?? "";
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "" } = pp(event);
  const biz = businessId.toString().trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  const prisma = await getPrisma();
  const role = await requireRole(prisma, biz, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden" });
  if (!isOwner(role)) return json(403, { ok: false, error: "Owner only" });

  // GET preview
  if (method === "GET" && path === `/v1/businesses/${biz}/category-migration/preview`) {
    const qs = event?.queryStringParameters ?? {};
    const accountIdRaw = String(qs.accountId ?? "all").trim();
    const accountId = !accountIdRaw || accountIdRaw.toLowerCase() === "all" ? "all" : accountIdRaw;

    const minCount = Math.max(2, Math.min(50, Number(qs.minCount ?? 2) || 2));

    const groups = await prisma.entry.groupBy({
      by: ["memo"],
      where: {
        business_id: biz,
        ...(accountId === "all" ? {} : { account_id: accountId }),
        deleted_at: null,
        category_id: null,
        memo: { not: null },
      },
      _count: { memo: true },
      orderBy: [{ _count: { memo: "desc" } }],
      take: 200,
    });

    const memos = groups
      .map((g: any) => ({ memo: normalizeMemo(g.memo ?? ""), count: Number(g._count?.memo ?? 0) }))
      .filter((x) => x.count >= minCount && looksLikeCategoryLabel(x.memo));

    // Preload existing categories for exact name match
    const existingCats = await prisma.category.findMany({
      where: { business_id: biz, archived_at: null },
      select: { id: true, name: true },
    });

    const catByNameLower = new Map<string, { id: string; name: string }>(
      existingCats.map((c: any) => [String(c.name).toLowerCase(), { id: String(c.id), name: String(c.name) }])
    );

    // sample entry ids (small)
    const out = [];
    for (const m of memos.slice(0, 100)) {
      const sample = await prisma.entry.findMany({
        where: {
          business_id: biz,
          ...(accountId === "all" ? {} : { account_id: accountId }),
          deleted_at: null,
          category_id: null,
          memo: m.memo,
        },
        select: { id: true },
        take: 5,
        orderBy: [{ date: "desc" }, { id: "desc" }],
      });

      const hit = catByNameLower.get(m.memo.toLowerCase()) ?? null;

      out.push({
        memoValue: m.memo,
        count: m.count,
        sampleEntryIds: sample.map((x: any) => String(x.id)),
        existingCategoryId: hit?.id ?? null,
        existingCategoryName: hit?.name ?? null,
      });
    }

    return json(200, {
      ok: true,
      accountId,
      minCount,
      rows: out,
    });
  }

  // POST apply
  if (method === "POST" && path === `/v1/businesses/${biz}/category-migration/apply`) {
    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const accountIdRaw = String(body.accountId ?? "all").trim();
    const accountId = !accountIdRaw || accountIdRaw.toLowerCase() === "all" ? "all" : accountIdRaw;

    const dryRun = !!body.dryRun;
    const mappings = Array.isArray(body.mappings) ? body.mappings : [];
    if (mappings.length === 0) return json(400, { ok: false, error: "Missing mappings" });
    if (mappings.length > 200) return json(400, { ok: false, error: "Too many mappings" });

    const results: any[] = [];

    for (const m of mappings) {
      const memoValue = normalizeMemo(String(m.memoValue ?? ""));
      const categoryName = normalizeMemo(String(m.categoryName ?? memoValue));

      if (!looksLikeCategoryLabel(memoValue)) {
        results.push({ memoValue, ok: false, error: "Memo value not eligible" });
        continue;
      }
      if (!categoryName) {
        results.push({ memoValue, ok: false, error: "Missing categoryName" });
        continue;
      }

      // Find or create category
      let category = await prisma.category.findFirst({
        where: { business_id: biz, name: categoryName, archived_at: null },
        select: { id: true, name: true },
      });

      if (!category && !dryRun) {
        try {
          category = await prisma.category.create({
            data: { business_id: biz, name: categoryName },
            select: { id: true, name: true },
          });
        } catch {
          category = await prisma.category.findFirst({
            where: { business_id: biz, name: categoryName, archived_at: null },
            select: { id: true, name: true },
          });
        }
      }

      const catId = category?.id ? String(category.id) : null;

      const where = {
        business_id: biz,
        ...(accountId === "all" ? {} : { account_id: accountId }),
        deleted_at: null,
        category_id: null,
        memo: memoValue,
      } as any;

      if (dryRun) {
        const cnt = await prisma.entry.count({ where });
        results.push({ memoValue, ok: true, dryRun: true, wouldUpdate: cnt, categoryId: catId, categoryName });
        continue;
      }

      if (!catId) {
        results.push({ memoValue, ok: false, error: "Failed to resolve category" });
        continue;
      }

      const updated = await prisma.entry.updateMany({
        where,
        data: { category_id: catId, updated_at: new Date() },
      });

      results.push({
        memoValue,
        ok: true,
        updatedCount: Number(updated?.count ?? 0),
        categoryId: catId,
        categoryName,
      });
    }

    return json(200, {
      ok: true,
      dryRun,
      accountId,
      results,
    });
  }

    return json(404, { ok: false, error: "Not found" });
  } catch (err: any) {
    return json(500, {
      ok: false,
      error: "INTERNAL",
      name: String(err?.name ?? "Error"),
      message: String(err?.message ?? err),
      code: err?.code ?? undefined,
    });
  }
}
