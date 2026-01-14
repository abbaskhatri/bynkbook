import { getPrisma } from "./lib/db";
import { randomUUID } from "crypto";

// --- Helpers copied in-place (no refactors) ---
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

function ymdToDay(ymd: string) {
  const s = (ymd || "").slice(0, 10);
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !y || !m || !d) return NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function todayYmd() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;

  if (method !== "POST" || !path?.includes("/issues/scan")) {
    return json(404, { ok: false, error: "Not found" });
  }

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "", accountId = "" } = pp(event);
  const biz = businessId.toString().trim();
  const acct = accountId.toString().trim();
  if (!biz || !acct) return json(400, { ok: false, error: "Missing businessId/accountId" });

  let body: any = {};
  try {
    body = event?.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const includeMissingCategory = !!body.includeMissingCategory;
  const dryRun = !!body.dryRun;

  const prisma = await getPrisma();

  const role = await requireRole(prisma, sub, biz);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, biz, acct);
  if (!okAcct) return json(404, { ok: false, error: "Account not found" });

  // Fetch entries (deleted entries must never create issues)
    const entries = await prisma.entry.findMany({
    where: {
      business_id: biz,
      account_id: acct,
      deleted_at: null,
      // NOTE: Do NOT filter "opening_balance" here.
      // That row is UI-only (synthetic) and does not exist in the DB as a UUID.
    },
    select: {
      id: true,
      date: true,
      payee: true,
      memo: true,
      amount_cents: true,
      method: true,
    },
  });

  const todayDay = ymdToDay(todayYmd());

  // Detect issues
  type Detected = {
    entry_id: string;
    issue_type: "DUPLICATE" | "STALE_CHECK" | "MISSING_CATEGORY";
    severity: "WARNING";
    status: "OPEN";
    group_key: string | null;
    details: string;
  };

  const detected: Detected[] = [];

  // Missing category (optional)
  if (includeMissingCategory) {
    for (const e of entries) {
      const cat = (e.memo || "").trim();
      if (!cat || cat.toLowerCase() === "uncategorized") {
        detected.push({
          entry_id: e.id,
          issue_type: "MISSING_CATEGORY",
          severity: "WARNING",
          status: "OPEN",
          group_key: null,
          details: "Category missing or uncategorized",
        });
      }
    }
  }

  // Stale checks
  for (const e of entries) {
    const methodUpper = (e.method || "").toString().toUpperCase();
    if (methodUpper !== "CHECK") continue;
    const day = Math.floor(Date.UTC(e.date.getUTCFullYear(), e.date.getUTCMonth(), e.date.getUTCDate()) / 86400000);
    if (!Number.isFinite(todayDay) || !Number.isFinite(day)) continue;
    const age = todayDay - day;
    if (age > 45) {
      detected.push({
        entry_id: e.id,
        issue_type: "STALE_CHECK",
        severity: "WARNING",
        status: "OPEN",
        group_key: null,
        details: `Stale check — ${age} days old`,
      });
    }
  }

  // Duplicate groups: CHECK window 30d, non-check window 7d
  const groups = new Map<string, Array<{ id: string; day: number; ymd: string; isCheck: boolean }>>();

  for (const e of entries) {
    const payeeKey = (e.payee || "").trim().toLowerCase();
    const methodUpper = (e.method || "").toString().toUpperCase();
    const isCheck = methodUpper === "CHECK";

    const ymd = e.date.toISOString().slice(0, 10);
    const day = ymdToDay(ymd);
    if (!Number.isFinite(day)) continue;

    // Signed amount cents included; prevents INCOME/EXPENSE cross-match by sign
    const amt = e.amount_cents.toString();
    const bucket = isCheck ? "CHECK" : "NONCHECK";
    const key = `${bucket}|${amt}|${payeeKey}`;

    const arr = groups.get(key);
    if (arr) arr.push({ id: e.id, day, ymd, isCheck });
    else groups.set(key, [{ id: e.id, day, ymd, isCheck }]);
  }

    for (const [key, items] of groups.entries()) {
    if (items.length <= 1) continue;

    const isCheckGroup = key.startsWith("CHECK|");
    const windowDays = isCheckGroup ? 30 : 7;

    // Deterministic ordering (day asc, then id asc) to ensure stable grouping.
    items.sort((a, b) => (a.day !== b.day ? a.day - b.day : a.id.localeCompare(b.id)));

    // Build deterministic connected components where entries are connected if within windowDays.
    // This avoids overlapping clusters and ensures each entry lands in exactly one stable group_key.
    const n = items.length;
    const parent = new Array<number>(n);
    for (let i = 0; i < n; i++) parent[i] = i;

    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };

    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (items[j].day - items[i].day > windowDays) break;
        union(i, j);
      }
    }

    const comps = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      const arr = comps.get(r);
      if (arr) arr.push(i);
      else comps.set(r, [i]);
    }

    for (const idxs of comps.values()) {
      if (idxs.length < 2) continue;

      let minDay = Number.POSITIVE_INFINITY;
      for (const ix of idxs) {
        if (items[ix].day < minDay) minDay = items[ix].day;
      }

      const groupKey = `${key}|${minDay}`;
      const details = isCheckGroup
        ? "Potential duplicate (CHECK within 30 days)"
        : "Potential duplicate (within 7 days)";

      for (const ix of idxs) {
        detected.push({
          entry_id: items[ix].id,
          issue_type: "DUPLICATE",
          severity: "WARNING",
          status: "OPEN",
          group_key: groupKey,
          details,
        });
      }
    }
  }

  // De-dupe detected by (entry_id, issue_type) — keep latest group_key/details
  const dedup = new Map<string, Detected>();
  for (const d of detected) {
    dedup.set(`${d.entry_id}|${d.issue_type}`, d);
  }
  const finalDetected = Array.from(dedup.values());

  if (dryRun) {
    return json(200, {
      ok: true,
      dryRun: true,
      detected: finalDetected.length,
      detectedByType: finalDetected.reduce((acc: any, x) => {
        acc[x.issue_type] = (acc[x.issue_type] || 0) + 1;
        return acc;
      }, {}),
    });
  }

  const now = new Date();

  // Load existing OPEN issues for this scope and these types
  const types = includeMissingCategory
    ? ["DUPLICATE", "STALE_CHECK", "MISSING_CATEGORY"]
    : ["DUPLICATE", "STALE_CHECK"];

  const existing = await prisma.entryIssue.findMany({
    where: {
      business_id: biz,
      account_id: acct,
      status: "OPEN",
      issue_type: { in: types },
    },
    select: { id: true, entry_id: true, issue_type: true },
  });

  const detectedKeys = new Set(finalDetected.map((d) => `${d.entry_id}|${d.issue_type}`));

  // Resolve issues no longer detected
  const toResolveIds = existing
    .filter((e: any) => !detectedKeys.has(`${e.entry_id}|${e.issue_type}`))
    .map((e: any) => e.id);

  // Upsert detected issues
  let upserted = 0;
  for (const d of finalDetected) {
    // Manual upsert (avoid Prisma unique-selector name mismatch):
// 1) find existing OPEN/RESOLVED row for this scope+entry+type
// 2) update if found, otherwise create
const existingIssue = await prisma.entryIssue.findFirst({
  where: {
    business_id: biz,
    account_id: acct,
    entry_id: d.entry_id,
    issue_type: d.issue_type,
  },
  select: { id: true },
});

if (existingIssue?.id) {
  await prisma.entryIssue.update({
    where: { id: existingIssue.id },
    data: {
      status: "OPEN",
      severity: "WARNING",
      group_key: d.group_key,
      details: d.details,
      detected_at: now,
      resolved_at: null,
      updated_at: now,
    },
  });
} else {
  await prisma.entryIssue.create({
    data: {
      id: randomUUID(),
      business_id: biz,
      account_id: acct,
      entry_id: d.entry_id,
      issue_type: d.issue_type,
      status: "OPEN",
      severity: "WARNING",
      group_key: d.group_key,
      details: d.details,
      detected_at: now,
      resolved_at: null,
      created_at: now,
      updated_at: now,
    },
  });
}

    upserted++;
  }

  if (toResolveIds.length > 0) {
    await prisma.entryIssue.updateMany({
      where: { id: { in: toResolveIds } },
      data: { status: "RESOLVED", resolved_at: now, updated_at: now },
    });
  }

  return json(200, {
    ok: true,
    businessId: biz,
    accountId: acct,
    detected: finalDetected.length,
    upserted,
    resolved: toResolveIds.length,
  });
}
