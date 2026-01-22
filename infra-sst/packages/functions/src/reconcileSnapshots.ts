import { getPrisma } from "./lib/db";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import { logActivity } from "./lib/activityLog";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function pp(event: any) {
  return event?.pathParameters ?? {};
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
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

const WRITE_ROLES = new Set(["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"]);
function canWrite(role: string | null | undefined) {
  return !!role && WRITE_ROLES.has(role.toUpperCase());
}

function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

function isValidMonth(month: string) {
  return /^\d{4}-\d{2}$/.test(month);
}

function monthBoundsChicagoAsDateStrings(month: string) {
  // DB columns are @db.Date, so we use calendar dates with an exclusive end.
  // Requirement: month boundaries defined in America/Chicago.
  const [yyyyStr, mmStr] = month.split("-");
  const yyyy = Number(yyyyStr);
  const mm = Number(mmStr);
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || mm < 1 || mm > 12) return null;

  const start = `${yyyyStr}-${mmStr}-01`; // YYYY-MM-01
  const nextMonth = mm === 12 ? 1 : mm + 1;
  const nextYear = mm === 12 ? yyyy + 1 : yyyy;
  const end = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;

  return { start, end };
}

function csvEscape(value: any) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: any[][]) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) lines.push(r.map(csvEscape).join(","));
  return lines.join("\n") + "\n";
}

function sha256Hex(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function contentDisposition(filename: string) {
  const safe =
    (filename || "file")
      .split("/")
      .pop()
      ?.split("\\")
      .pop()
      ?.replace(/[^\w.\-]+/g, "_")
      .slice(0, 180) ?? "file";

  const encoded = encodeURIComponent(filename || safe).replace(/['()]/g, escape).replace(/\*/g, "%2A");
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

type SnapshotComputed = {
  counts: {
    bank_unmatched_count: number;
    bank_partial_count: number;
    bank_matched_count: number;
    entries_expected_count: number;
    entries_matched_count: number;
    revert_count: number;
  };
  remaining_abs_cents: bigint;
  csv: {
    bankCsv: string;
    matchesCsv: string;
    auditCsv: string;
    bankSha256: string;
    matchesSha256: string;
    auditSha256: string;
  };
};

async function computeSnapshot(prisma: any, businessId: string, accountId: string, month: string): Promise<SnapshotComputed> {
  const bounds = monthBoundsChicagoAsDateStrings(month);
  if (!bounds) throw new Error("Invalid month");

  const startDate = new Date(`${bounds.start}T00:00:00Z`);
  const endDate = new Date(`${bounds.end}T00:00:00Z`);

  // Bank txns anchored by posted_date within month
  const bankTxns = await prisma.bankTransaction.findMany({
    where: {
      business_id: businessId,
      account_id: accountId,
      is_removed: false,
      posted_date: { gte: startDate, lt: endDate },
    },
    orderBy: [{ posted_date: "asc" }, { created_at: "asc" }],
    select: {
      id: true,
      posted_date: true,
      name: true,
      amount_cents: true,
      is_pending: true,
      iso_currency_code: true,
    },
  });

  const bankIds = bankTxns.map((b: any) => b.id);

  // Matches in scope (for those bank txns). Snapshot reflects current state as-of creation time.
  const matchRows = bankIds.length
    ? await prisma.bankMatch.findMany({
        where: {
          business_id: businessId,
          account_id: accountId,
          bank_transaction_id: { in: bankIds },
        },
        orderBy: [{ created_at: "asc" }],
        select: {
          id: true,
          bank_transaction_id: true,
          entry_id: true,
          match_type: true,
          matched_amount_cents: true,
          created_at: true,
          created_by_user_id: true,
          voided_at: true,
          voided_by_user_id: true,
        },
      })
    : [];

  const activeMatches = matchRows.filter((m: any) => !m.voided_at);
  const voidedMatches = matchRows.filter((m: any) => !!m.voided_at);

  // Bank status + remaining
  const matchedAbsByBankId = new Map<string, bigint>();
  for (const m of activeMatches) {
    const bid = m.bank_transaction_id;
    const amt = BigInt(m.matched_amount_cents);
    matchedAbsByBankId.set(bid, (matchedAbsByBankId.get(bid) ?? 0n) + absBig(amt));
  }

  let bankUnmatched = 0;
  let bankPartial = 0;
  let bankMatched = 0;
  let remainingAbsTotal = 0n;

  const bankRowsForCsv: any[][] = [];
  for (const b of bankTxns) {
    const bankAbs = absBig(BigInt(b.amount_cents));
    const matchedAbs = matchedAbsByBankId.get(b.id) ?? 0n;
    const remainingAbs = bankAbs - matchedAbs;

    let status: "UNMATCHED" | "PARTIAL" | "MATCHED" = "UNMATCHED";
    if (matchedAbs === 0n) {
      status = "UNMATCHED";
      bankUnmatched++;
      remainingAbsTotal += bankAbs;
    } else if (remainingAbs === 0n && bankAbs > 0n) {
      status = "MATCHED";
      bankMatched++;
    } else {
      status = "PARTIAL";
      bankPartial++;
      remainingAbsTotal += remainingAbs > 0n ? remainingAbs : 0n;
    }

    const postedYmd = b.posted_date instanceof Date ? b.posted_date.toISOString().slice(0, 10) : "";
    bankRowsForCsv.push([
      b.id,
      postedYmd,
      b.name,
      String(b.amount_cents),
      status,
      String(matchedAbs),
      String(remainingAbs > 0n ? remainingAbs : 0n),
      b.is_pending ? "true" : "false",
      b.iso_currency_code ?? "",
    ]);
  }

  // Entries matched / expected (Option A)
  const matchedEntryIds = new Set<string>(activeMatches.map((m: any) => m.entry_id));

  const entriesInMonth = await prisma.entry.findMany({
    where: {
      business_id: businessId,
      account_id: accountId,
      deleted_at: null,
      is_adjustment: false,
      date: { gte: startDate, lt: endDate },
    },
    select: { id: true },
  });

  let entriesExpected = 0;
  for (const e of entriesInMonth) {
    if (!matchedEntryIds.has(e.id)) entriesExpected++;
  }
  const entriesMatched = matchedEntryIds.size;

  // CSVs
  const bankCsv = toCsv(
    ["bank_transaction_id","posted_date","name","amount_cents","status","matched_abs_cents","remaining_abs_cents","is_pending","iso_currency_code"],
    bankRowsForCsv
  );

  const matchesCsv = toCsv(
    ["match_id","bank_transaction_id","entry_id","match_type","matched_amount_cents","created_at","created_by_user_id"],
    activeMatches.map((m: any) => [
      m.id,
      m.bank_transaction_id,
      m.entry_id,
      m.match_type,
      String(m.matched_amount_cents),
      m.created_at instanceof Date ? m.created_at.toISOString() : String(m.created_at),
      m.created_by_user_id,
    ])
  );

  // Audit events: MATCH (created) + REVERT (voided). Cap newest 500.
  const auditEvents: { at: Date; row: any[] }[] = [];
  for (const m of matchRows) {
    if (m.created_at) {
      const at = m.created_at instanceof Date ? m.created_at : new Date(m.created_at);
      auditEvents.push({
        at,
        row: ["MATCH", m.id, m.bank_transaction_id, m.entry_id, m.match_type, String(m.matched_amount_cents), at.toISOString(), m.created_by_user_id],
      });
    }
    if (m.voided_at) {
      const at = m.voided_at instanceof Date ? m.voided_at : new Date(m.voided_at);
      auditEvents.push({
        at,
        row: ["REVERT", m.id, m.bank_transaction_id, m.entry_id, m.match_type, String(m.matched_amount_cents), at.toISOString(), m.voided_by_user_id ?? ""],
      });
    }
  }
  auditEvents.sort((a, b) => b.at.getTime() - a.at.getTime());
  const auditSlice = auditEvents.slice(0, 500).map((e) => e.row);

  const auditCsv = toCsv(
    ["event_type","match_id","bank_transaction_id","entry_id","match_type","matched_amount_cents","event_at","actor_user_id"],
    auditSlice
  );

  return {
    counts: {
      bank_unmatched_count: bankUnmatched,
      bank_partial_count: bankPartial,
      bank_matched_count: bankMatched,
      entries_expected_count: entriesExpected,
      entries_matched_count: entriesMatched,
      revert_count: voidedMatches.length,
    },
    remaining_abs_cents: remainingAbsTotal,
    csv: {
      bankCsv,
      matchesCsv,
      auditCsv,
      bankSha256: sha256Hex(bankCsv),
      matchesSha256: sha256Hex(matchesCsv),
      auditSha256: sha256Hex(auditCsv),
    },
  };
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method ?? "GET";
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "", accountId = "", snapshotId = "" } = pp(event);
  const biz = businessId.toString().trim();
  const acct = accountId.toString().trim();
  const snapId = snapshotId.toString().trim();

  if (!biz) return json(400, { ok: false, error: "Missing businessId" });
  if (!acct) return json(400, { ok: false, error: "Missing accountId" });

  const bucket = process.env.UPLOADS_BUCKET_NAME?.trim();
  if (!bucket) return json(500, { ok: false, error: "Missing env UPLOADS_BUCKET_NAME" });

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, biz, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  const acctOk = await requireAccountInBusiness(prisma, biz, acct);
  if (!acctOk) return json(404, { ok: false, error: "Account not found in this business" });

  const region = process.env.AWS_REGION || "us-east-1";
  const s3 = new S3Client({ region });

  // GET list snapshots (member-readable)
  if (method === "GET" && !snapId && !(event?.requestContext?.http?.path ?? "").includes("/exports/")) {
    const items = await prisma.reconcileSnapshot.findMany({
      where: { business_id: biz, account_id: acct },
      orderBy: [{ created_at: "desc" }],
      select: {
        id: true,
        month: true,
        bank_unmatched_count: true,
        bank_partial_count: true,
        bank_matched_count: true,
        entries_expected_count: true,
        entries_matched_count: true,
        revert_count: true,
        remaining_abs_cents: true,
        created_at: true,
        created_by_user_id: true,
      },
    });
    return json(200, { ok: true, items });
  }

  // POST create snapshot (write-protected)
  if (method === "POST" && !snapId) {
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const month = (body?.month ?? "").toString().trim();
    if (!month || !isValidMonth(month)) return json(400, { ok: false, error: "month is required (YYYY-MM)" });

    const existing = await prisma.reconcileSnapshot.findFirst({
      where: { business_id: biz, account_id: acct, month },
      select: { id: true, created_at: true },
    });

    if (existing) {
      return json(409, {
        ok: false,
        error: "Snapshot already exists",
        snapshot: { id: existing.id, created_at: existing.created_at },
      });
    }

    let computed: SnapshotComputed;
    try {
      computed = await computeSnapshot(prisma, biz, acct, month);
    } catch (e: any) {
      return json(400, { ok: false, error: e?.message || "Failed to compute snapshot" });
    }

    // Create snapshot row first to get ID for the S3 key prefix
    const created = await prisma.reconcileSnapshot.create({
      data: {
        business_id: biz,
        account_id: acct,
        month,
        created_by_user_id: sub,
        bank_unmatched_count: computed.counts.bank_unmatched_count,
        bank_partial_count: computed.counts.bank_partial_count,
        bank_matched_count: computed.counts.bank_matched_count,
        entries_expected_count: computed.counts.entries_expected_count,
        entries_matched_count: computed.counts.entries_matched_count,
        revert_count: computed.counts.revert_count,
        remaining_abs_cents: computed.remaining_abs_cents,
        bank_csv_s3_key: "",
        matches_csv_s3_key: "",
        audit_csv_s3_key: "",
        bank_csv_sha256: computed.csv.bankSha256,
        matches_csv_sha256: computed.csv.matchesSha256,
        audit_csv_sha256: computed.csv.auditSha256,
      },
      select: { id: true, created_at: true },
    });

    const basePrefix = `private/biz/${biz}/reconcile-snapshots/${acct}/${month}/${created.id}`;
    const bankKey = `${basePrefix}/bank.csv`;
    const matchesKey = `${basePrefix}/matches.csv`;
    const auditKey = `${basePrefix}/audit.csv`;

    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: bankKey, Body: computed.csv.bankCsv, ContentType: "text/csv" }));
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: matchesKey, Body: computed.csv.matchesCsv, ContentType: "text/csv" }));
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: auditKey, Body: computed.csv.auditCsv, ContentType: "text/csv" }));

    await prisma.reconcileSnapshot.update({
      where: { id: created.id },
      data: { bank_csv_s3_key: bankKey, matches_csv_s3_key: matchesKey, audit_csv_s3_key: auditKey },
    });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      scopeAccountId: acct,
      eventType: "RECONCILE_SNAPSHOT_CREATED",
      payloadJson: { account_id: acct, snapshot_id: created.id, month },
    });

    return json(201, {
      ok: true,
      snapshot: {
        id: created.id,
        month,
        ...computed.counts,
        remaining_abs_cents: computed.remaining_abs_cents,
        created_at: created.created_at,
        created_by_user_id: sub,
        bank_csv_s3_key: bankKey,
        matches_csv_s3_key: matchesKey,
        audit_csv_s3_key: auditKey,
        bank_csv_sha256: computed.csv.bankSha256,
        matches_csv_sha256: computed.csv.matchesSha256,
        audit_csv_sha256: computed.csv.auditSha256,
      },
    });
  }

  // GET one snapshot (member-readable; presigned URLs only for write allowlist)
  if (method === "GET" && snapId && !(event?.requestContext?.http?.path ?? "").includes("/exports/")) {
    const row = await prisma.reconcileSnapshot.findFirst({
      where: { id: snapId, business_id: biz, account_id: acct },
    });
    if (!row) return json(404, { ok: false, error: "Snapshot not found" });

    const includeUrls = canWrite(role);
    let urls: any = null;

    if (includeUrls) {
      const bankUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: row.bank_csv_s3_key,
          ResponseContentDisposition: contentDisposition(`reconcile-${row.month}-bank.csv`),
        }),
        { expiresIn: 600 }
      );
      const matchesUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: row.matches_csv_s3_key,
          ResponseContentDisposition: contentDisposition(`reconcile-${row.month}-matches.csv`),
        }),
        { expiresIn: 600 }
      );
      const auditUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: row.audit_csv_s3_key,
          ResponseContentDisposition: contentDisposition(`reconcile-${row.month}-audit.csv`),
        }),
        { expiresIn: 600 }
      );
      urls = { bank: bankUrl, matches: matchesUrl, audit: auditUrl, expiresInSeconds: 600 };
    }

    return json(200, {
      ok: true,
      snapshot: {
        id: row.id,
        business_id: row.business_id,
        account_id: row.account_id,
        month: row.month,
        bank_unmatched_count: row.bank_unmatched_count,
        bank_partial_count: row.bank_partial_count,
        bank_matched_count: row.bank_matched_count,
        entries_expected_count: row.entries_expected_count,
        entries_matched_count: row.entries_matched_count,
        revert_count: row.revert_count,
        remaining_abs_cents: row.remaining_abs_cents,
        created_at: row.created_at,
        created_by_user_id: row.created_by_user_id,
        bank_csv_s3_key: row.bank_csv_s3_key,
        matches_csv_s3_key: row.matches_csv_s3_key,
        audit_csv_s3_key: row.audit_csv_s3_key,
        bank_csv_sha256: row.bank_csv_sha256,
        matches_csv_sha256: row.matches_csv_sha256,
        audit_csv_sha256: row.audit_csv_sha256,
        urls,
      },
    });
  }

  // GET export presigned URL (write-protected)
  if (method === "GET" && snapId && (event?.requestContext?.http?.path ?? "").includes("/exports/")) {
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const kind = (pp(event)?.kind ?? "").toString().trim().toLowerCase();
    if (kind !== "bank" && kind !== "matches" && kind !== "audit") return json(400, { ok: false, error: "Invalid kind" });

    const row = await prisma.reconcileSnapshot.findFirst({
      where: { id: snapId, business_id: biz, account_id: acct },
      select: { id: true, month: true, bank_csv_s3_key: true, matches_csv_s3_key: true, audit_csv_s3_key: true },
    });
    if (!row) return json(404, { ok: false, error: "Snapshot not found" });

    const key = kind === "bank" ? row.bank_csv_s3_key : kind === "matches" ? row.matches_csv_s3_key : row.audit_csv_s3_key;
    const filename = kind === "bank" ? `reconcile-${row.month}-bank.csv` : kind === "matches" ? `reconcile-${row.month}-matches.csv` : `reconcile-${row.month}-audit.csv`;

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: contentDisposition(filename) }),
      { expiresIn: 600 }
    );

    return json(200, { ok: true, url, expiresInSeconds: 600 });
  }

  return json(405, { ok: false, error: "Method not allowed" });
}
