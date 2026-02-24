import { getPrisma } from "./lib/db";

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

function parseMoneyCents(s: string): number | null {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const m = t.match(/(\d+(\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0 Sun
  const diff = (day + 6) % 7; // Monday start
  x.setUTCDate(x.getUTCDate() - diff);
  return x;
}

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addDays(d: Date, n: number) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function parseTimeRange(q: string): { from: Date; to: Date } {
  const now = new Date();
  const lower = q.toLowerCase();

  // Defaults: last 90 days
  let to = now;
  let from = addDays(now, -90);

  if (lower.includes("this week")) {
    from = startOfWeek(now);
    to = now;
  } else if (lower.includes("last week")) {
    const thisW = startOfWeek(now);
    to = addDays(thisW, -1);
    from = addDays(thisW, -7);
  } else if (lower.includes("this month")) {
    from = startOfMonth(now);
    to = now;
  } else if (lower.includes("last month")) {
    const thisM = startOfMonth(now);
    to = addDays(thisM, -1);
    from = startOfMonth(to);
  }

  return { from, to };
}

function extractAmountFilter(q: string): { op: "GT" | "LT"; cents: number } | null {
  const lower = q.toLowerCase();
  if (lower.includes("over $") || lower.includes("above $") || lower.match(/>\s*\$/)) {
    const cents = parseMoneyCents(lower);
    if (cents !== null) return { op: "GT", cents };
  }
  if (lower.includes("under $") || lower.includes("below $") || lower.match(/<\s*\$/)) {
    const cents = parseMoneyCents(lower);
    if (cents !== null) return { op: "LT", cents };
  }
  return null;
}

function cleanQueryText(q: string): string {
  return q
    .toLowerCase()
    .replace(/this week|last week|this month|last month/g, " ")
    .replace(/over\s*\$[0-9.]+|under\s*\$[0-9.]+|above\s*\$[0-9.]+|below\s*\$[0-9.]+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * POST /v1/businesses/{businessId}/search/query
 * Body:
 * { q: string, accountId?: string, limit?: number }
 *
 * Heuristic parse only; no embeddings yet; bounded, scoped queries only.
 */
export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = (event?.pathParameters?.businessId ?? "").toString().trim();
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });

  let body: any = {};
  try {
    body = event?.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const qRaw = String(body?.q ?? "").trim();
  const accountId = body?.accountId ? String(body.accountId).trim() : "";
  const limit = Math.max(5, Math.min(25, Number(body?.limit ?? 25) || 25));

  if (!qRaw) return json(200, { ok: true, parsed: {}, results: { entries: [], bankTxns: [], issues: [] } });

  const prisma = await getPrisma();

  const role = await requireMembership(prisma, businessId, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const range = parseTimeRange(qRaw);
  const amt = extractAmountFilter(qRaw);
  const text = cleanQueryText(qRaw);

  const parsed = {
    range: { from: ymd(range.from), to: ymd(range.to) },
    amount: amt ? { op: amt.op, cents: amt.cents } : null,
    text,
    accountId: accountId || null,
  };

  const entryWhere: any = {
    business_id: businessId,
    deleted_at: null,
    type: { in: ["INCOME", "EXPENSE"] },
    date: {
      gte: new Date(`${parsed.range.from}T00:00:00Z`),
      lte: new Date(`${parsed.range.to}T00:00:00Z`),
    },
    ...(accountId ? { account_id: accountId } : {}),
  };

  if (amt) {
    // INCOME positive, EXPENSE negative — for "over $X" we interpret absolute value threshold.
    // Apply by comparing ABS(amount_cents) via two-sided filter (cheap approximation).
    // NOTE: Prisma doesn't do ABS easily; we bound by both directions.
    if (amt.op === "GT") {
      entryWhere.OR = [
        { amount_cents: { gte: BigInt(amt.cents) } },
        { amount_cents: { lte: BigInt(-amt.cents) } },
      ];
    } else {
      entryWhere.AND = [
        {
          OR: [
            { amount_cents: { lte: BigInt(amt.cents) } },
            { amount_cents: { gte: BigInt(-amt.cents) } },
          ],
        },
      ];
    }
  }

  if (text) {
    entryWhere.AND = [
      ...(Array.isArray(entryWhere.AND) ? entryWhere.AND : []),
      {
        OR: [
          { payee: { contains: text, mode: "insensitive" } },
          { memo: { contains: text, mode: "insensitive" } },
        ],
      },
    ];
  }

  const entries = await prisma.entry.findMany({
    where: entryWhere,
    select: { id: true, account_id: true, date: true, payee: true, memo: true, amount_cents: true, category_id: true },
    orderBy: [{ date: "desc" }, { created_at: "desc" }],
    take: limit,
  });

  const bankWhere: any = {
    business_id: businessId,
    is_removed: false,
    posted_date: {
      gte: new Date(`${parsed.range.from}T00:00:00Z`),
      lte: new Date(`${parsed.range.to}T23:59:59Z`),
    },
    ...(accountId ? { account_id: accountId } : {}),
  };

  if (amt) {
    if (amt.op === "GT") {
      bankWhere.OR = [
        { amount_cents: { gte: BigInt(amt.cents) } },
        { amount_cents: { lte: BigInt(-amt.cents) } },
      ];
    } else {
      bankWhere.AND = [
        {
          OR: [
            { amount_cents: { lte: BigInt(amt.cents) } },
            { amount_cents: { gte: BigInt(-amt.cents) } },
          ],
        },
      ];
    }
  }

  if (text) {
    bankWhere.name = { contains: text, mode: "insensitive" };
  }

  const bankTxns = await prisma.bankTransaction.findMany({
    where: bankWhere,
    select: { id: true, account_id: true, posted_date: true, name: true, amount_cents: true },
    orderBy: [{ posted_date: "desc" }, { created_at: "desc" }],
    take: limit,
  });

  return json(200, {
    ok: true,
    parsed,
    results: {
      entries: entries.map((e: any) => ({
        id: e.id,
        account_id: e.account_id,
        date: ymd(new Date(e.date)),
        payee: e.payee ?? "",
        memo: e.memo ?? "",
        amount_cents: e.amount_cents,
        link: `/ledger?focusEntryId=${encodeURIComponent(String(e.id))}`,
      })),
      bankTxns: bankTxns.map((t: any) => ({
        id: t.id,
        account_id: t.account_id,
        posted_date: new Date(t.posted_date).toISOString(),
        name: t.name ?? "",
        amount_cents: t.amount_cents,
        link: `/reconcile?focusBankTxnId=${encodeURIComponent(String(t.id))}`,
      })),
      issues: [],
    },
    meta: { version: "search_v1", mode: "STRUCTURED_HEURISTIC_PARSE" },
  });
}