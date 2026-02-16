import { randomUUID } from "node:crypto";
import { getPrisma } from "./lib/db";
import { assertNotClosedPeriod } from "./lib/closedPeriods";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { TextractClient, AnalyzeExpenseCommand } from "@aws-sdk/client-textract";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { streamToString } from "./lib/csv/streamToString";
import { parseBankStatementCsv } from "./lib/csv/parseBankStatementCsv";
import { computeImportHash } from "./lib/csv/importHash";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function pp(event: any) {
  return event?.pathParameters ?? {};
}

function normalizePath(p: string) {
  if (!p) return p;
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
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

function sanitizeFilename(name: string) {
  const base = name.split("/").pop()?.split("\\").pop() ?? "file";
  return base.replace(/[^\w.\-]+/g, "_").slice(0, 180);
}

function filenameStem(name: string) {
  const base = (name || "").split("/").pop()?.split("\\").pop() ?? "";
  const noExt = base.replace(/\.[^/.\\]+$/, "");
  return noExt.replace(/\s+/g, " ").trim();
}

function normalizeVendorName(name: string) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim();
}

function todayParts() {
  const d = new Date();
  const yyyy = d.getUTCFullYear().toString();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return { yyyy, mm, dd };
}

function parseTypeFilter(raw: string | undefined) {
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts;
}

function contentDisposition(filename: string) {
  const safe = sanitizeFilename(filename || "file");
  const encoded = encodeURIComponent(filename || safe).replace(/['()]/g, escape).replace(/\*/g, "%2A");
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

const ALLOWED_TYPES = new Set(["RECEIPT", "INVOICE", "BANK_STATEMENT", "BUSINESS_LOGO"]);

function validateContentType(uploadType: string, contentType: string) {
  const ct = (contentType || "").toLowerCase();

  if (uploadType === "BUSINESS_LOGO") {
    // Logo: image only (no PDF)
    return ct.startsWith("image/");
  }

  if (uploadType === "BANK_STATEMENT") {
    // CSV preferred; PDF allowed (parsing later)
    return ct.includes("csv") || ct === "application/pdf" || ct.startsWith("text/");
  }

  // Receipt/Invoice: image/* or PDF
  return ct.startsWith("image/") || ct === "application/pdf";
}

function getParsedMeta(meta: any) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const parsed = (meta as any).parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, any>;
}

// Normalize date strings to YYYY-MM-DD for entry.date
function toIsoDateStr(v: string) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d1 = new Date(s);
  if (!isNaN(d1.getTime())) return d1.toISOString().slice(0, 10);

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return "";
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const rawPath = event?.requestContext?.http?.path;
  const path = rawPath ? normalizePath(rawPath) : rawPath;

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "", uploadId = "" } = pp(event);
  const biz = businessId.toString().trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  const bucket = process.env.UPLOADS_BUCKET_NAME?.trim();
  if (!bucket) return json(500, { ok: false, error: "Missing env UPLOADS_BUCKET_NAME" });

  const prisma = await getPrisma();

  const role = await requireMembership(prisma, biz, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  const region = process.env.AWS_REGION || "us-east-1";
  const s3 = new S3Client({ region });
  const textract = new TextractClient({ region });

  const uploadsBasePath = `/v1/businesses/${biz}/uploads`;

  // -------------------------
  // LIST is handled below in the existing GET /uploads block (single source of truth).

  // -------------------------
  // INIT (presign PUT)
  // -------------------------
  if (method === "POST" && path === `${uploadsBasePath}/init`) {
    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const uploadType = (body?.type ?? "").toString().trim().toUpperCase();
    const accountId = body?.accountId ? body.accountId.toString().trim() : null;
    const filename = (body?.filename ?? "").toString().trim();
    const contentType = (body?.contentType ?? "").toString().trim();
    const sizeBytes = Number(body?.sizeBytes ?? 0);

    if (!ALLOWED_TYPES.has(uploadType)) return json(400, { ok: false, error: "Invalid type" });
    if (!filename) return json(400, { ok: false, error: "filename is required" });
    if (!contentType) return json(400, { ok: false, error: "contentType is required" });
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return json(400, { ok: false, error: "sizeBytes is required" });

    // Bank statement requires accountId
    if (uploadType === "BANK_STATEMENT" && !accountId) {
      return json(400, { ok: false, error: "accountId is required for BANK_STATEMENT" });
    }

    // Validate account scope if present
    if (accountId) {
      const ok = await requireAccountInBusiness(prisma, biz, accountId);
      if (!ok) return json(404, { ok: false, error: "Account not found in this business" });
    }

    // Validate content type
    if (!validateContentType(uploadType, contentType)) {
      return json(400, { ok: false, error: "Unsupported contentType for this upload type" });
    }

    // Size caps
    const maxBytes =
      uploadType === "BUSINESS_LOGO"
        ? 5 * 1024 * 1024
        : uploadType === "BANK_STATEMENT"
          ? 50 * 1024 * 1024
          : 25 * 1024 * 1024;
    if (sizeBytes > maxBytes) return json(400, { ok: false, error: `File too large (max ${maxBytes} bytes)` });

    // Duplicate upload guard (best-effort): if a recent COMPLETED upload matches filename+size+type+account+upload_type, block
    const recentWindowMs = 7 * 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - recentWindowMs);
    const existingDup = await prisma.upload.findFirst({
      where: {
        business_id: biz,
        upload_type: uploadType,
        status: "COMPLETED",
        content_type: contentType,
        size_bytes: BigInt(sizeBytes),
        ...(accountId ? { account_id: accountId } : {}),
        original_filename: { equals: filename, mode: "insensitive" },
        completed_at: { gte: since },
      },
      select: { id: true },
    });

    if (existingDup) {
      return json(409, {
        ok: false,
        code: "DUPLICATE_UPLOAD",
        upload_id: existingDup.id,
        error: "A matching upload already exists.",
      });
    }

    const newUploadId = randomUUID();
    const safeName = sanitizeFilename(filename);
    const { yyyy, mm, dd } = todayParts();

    const acctSegment = accountId ? accountId : "na";
    const key = `private/biz/${biz}/acct/${acctSegment}/${uploadType}/${yyyy}/${mm}/${dd}/${newUploadId}/${safeName}`;

    const meta = body?.meta ?? null;

    await prisma.upload.create({
      data: {
        id: newUploadId,
        business_id: biz,
        account_id: accountId,
        upload_type: uploadType,
        s3_bucket: bucket,
        s3_key: key,
        original_filename: filename,
        content_type: contentType,
        size_bytes: BigInt(sizeBytes),
        status: "INITIATED",
        created_by_user_id: sub,
        meta,
      },
    });

    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: 600 });

    return json(200, {
      ok: true,
      upload: {
        id: newUploadId,
        bucket,
        key,
        method: "PUT",
        url,
        headers: { "Content-Type": contentType },
        expiresInSeconds: 600,
      },
    });
  }

  // -------------------------
  // MARK UPLOADED (client confirms PUT succeeded)
  // -------------------------
  if (method === "POST" && path === `${uploadsBasePath}/mark-uploaded`) {
    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const markId = (body?.uploadId ?? "").toString().trim();
    const etag = body?.etag ? body.etag.toString().trim() : null;

    if (!markId) return json(400, { ok: false, error: "uploadId is required" });

    const row = await prisma.upload.findFirst({
      where: { id: markId, business_id: biz, created_by_user_id: sub },
    });
    if (!row) return json(404, { ok: false, error: "Upload not found" });

    // allow marking only if still pending
    if (row.status !== "INITIATED" && row.status !== "FAILED") {
      return json(400, { ok: false, error: "Upload not markable" });
    }

    const baseMeta =
  row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? (row.meta as Record<string, any>) : {};

const mergedMeta = etag ? { ...baseMeta, etag } : baseMeta;

    console.log("mark-uploaded", { uploadId: row.id, hasMeta: !!row.meta, etag });
    const updated = await prisma.upload.update({
      where: { id: row.id },
      data: {
        status: "UPLOADED",
        meta: mergedMeta,
      },
    });

    return json(200, {
      ok: true,
      upload: {
        id: updated.id,
        status: updated.status,
      },
    });
  }

  // -------------------------
  // COMPLETE (verify object exists)
  // -------------------------
  if (method === "POST" && path === `${uploadsBasePath}/complete`) {
    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const completeUploadId = (body?.uploadId ?? "").toString().trim();
    if (!completeUploadId) return json(400, { ok: false, error: "uploadId is required" });

    const row = await prisma.upload.findFirst({
      where: { id: completeUploadId, business_id: biz, created_by_user_id: sub },
    });
    if (!row) return json(404, { ok: false, error: "Upload not found" });

    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: row.s3_bucket, Key: row.s3_key }));
      const etag = (head.ETag ?? null) as string | null;
      const contentLength = head.ContentLength ?? Number(row.size_bytes);

      // Merge meta safely
      const baseMeta =
        row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? (row.meta as Record<string, any>) : {};

      let parsed: any = null;
      let parseStatus: "SKIPPED" | "PARSED" | "NEEDS_REVIEW" | "FAILED" = "SKIPPED";

      // Parse invoice/receipt via Textract AnalyzeExpense (deterministic, no AI)
      if (row.upload_type === "INVOICE" || row.upload_type === "RECEIPT") {
        try {
          const resp = await textract.send(
            new AnalyzeExpenseCommand({
              Document: { S3Object: { Bucket: row.s3_bucket, Name: row.s3_key } },
            })
          );

          // Extract best-effort summary fields
          const docs = resp.ExpenseDocuments ?? [];
          const doc = docs[0];
          const fields = doc?.SummaryFields ?? [];

          function pickField(type: string) {
            const hit = fields.find((f: any) => String(f?.Type?.Text ?? "").toUpperCase() === type);
            const val = hit?.ValueDetection?.Text ?? null;
            const conf = hit?.ValueDetection?.Confidence ?? null;
            return { val, conf };
          }

          const vendor = pickField("VENDOR_NAME");
          const docId = pickField("INVOICE_RECEIPT_ID");
          const docDate = pickField("INVOICE_RECEIPT_DATE");
          const total = pickField("TOTAL");
          const amountDue = pickField("AMOUNT_DUE");
          const dueDate = pickField("DUE_DATE");

          // Choose total: prefer AMOUNT_DUE if present, else TOTAL
          const amountText = (amountDue.val || total.val || "").toString().trim();

          // Parse money -> cents (simple, deterministic)
          function moneyToCents(s: string) {
            const cleaned = s.replace(/[^0-9.\-]/g, "");
            if (!cleaned) return null;
            const n = Number(cleaned);
            if (!Number.isFinite(n)) return null;
            return Math.round(n * 100);
          }

          const amountCents = moneyToCents(amountText);

          parsed = {
            vendor_name: vendor.val,
            vendor_conf: vendor.conf,
            doc_number: docId.val,
            doc_number_conf: docId.conf,
            doc_date: docDate.val,
            doc_date_conf: docDate.conf,
            due_date: dueDate.val,
            due_date_conf: dueDate.conf,
            amount_text: amountText || null,
            amount_cents: amountCents,
            amount_conf: amountDue.conf ?? total.conf ?? null,
          };

          // Confidence gating (deterministic)
          const hasVendor = !!parsed.vendor_name && (parsed.vendor_conf ?? 0) >= 50;
          const hasAmount = parsed.amount_cents !== null && (parsed.amount_conf ?? 0) >= 70;
          const hasDate = !!parsed.doc_date && (parsed.doc_date_conf ?? 0) >= 50;

          parseStatus = hasVendor && hasAmount && hasDate ? "PARSED" : "NEEDS_REVIEW";
        } catch (e: any) {
          console.error("textract.analyzeExpense failed", { uploadId: row.id, err: e?.message });
          parseStatus = "FAILED";
          parsed = { error: e?.message || "Parse failed" };
        }
      }

      // If INVOICE: derive/link vendor deterministically (no user pick required)
      let vendorLinked: any = null;
      if (row.upload_type === "INVOICE") {
        // Prefer explicit vendor_id passed by the client (vendor detail upload),
        // else fall back to parsed vendor_name/filename stem.
        const explicitVendorId =
          baseMeta && typeof baseMeta === "object" && !Array.isArray(baseMeta) ? (baseMeta as any).vendor_id : null;

        if (explicitVendorId) {
          const v = await prisma.vendor.findFirst({
            where: { id: String(explicitVendorId), business_id: biz },
            select: { id: true, name: true },
          });
          if (v) vendorLinked = v;
        }

        if (!vendorLinked) {
          const parsedName = parsed?.vendor_name ? String(parsed.vendor_name).trim() : "";
          const fallbackName = filenameStem(row.original_filename);
          const vnRaw = parsedName || fallbackName;
          const vn = normalizeVendorName(vnRaw);

          if (vn) {
            const existing = await prisma.vendor.findFirst({
              where: { business_id: biz, name: { equals: vn, mode: "insensitive" } },
              select: { id: true, name: true },
            });

            if (existing) {
              vendorLinked = existing;
            } else {
              // Create vendor (safe, deterministic)
              const created = await prisma.vendor.create({
                data: { business_id: biz, name: vn, notes: null },
                select: { id: true, name: true },
              });
              vendorLinked = created;
            }
          }
        }
      }

      // If INVOICE: create Bill (AP) and link Bill.upload_id = Upload.id (idempotent, no duplicates)
      let billLinked: any = null;
      if (row.upload_type === "INVOICE" && vendorLinked) {
        const existingBillId =
          baseMeta && typeof baseMeta === "object" && !Array.isArray(baseMeta) ? (baseMeta as any).bill_id : null;

        if (existingBillId) {
          const b = await prisma.bill.findFirst({
            where: { id: String(existingBillId), business_id: biz, vendor_id: vendorLinked.id, upload_id: row.id },
            select: { id: true },
          });
          if (b) billLinked = b;
        }

        if (!billLinked) {
          // durable idempotency guard: Bill with upload_id already exists
          const existingByUpload = await prisma.bill.findFirst({
            where: { business_id: biz, upload_id: row.id },
            select: { id: true },
          });
          if (existingByUpload) {
            billLinked = existingByUpload;
          } else {
            const cents = parsed?.amount_cents ?? null;

            // Only create a Bill when we have a deterministic positive amount.
            // If parsing failed (no amount), user can still create a Bill manually via New Bill.
            if (typeof cents === "number" && Number.isFinite(cents) && cents !== 0) {
              const amountCents = Math.abs(Math.round(cents));
              const invoiceIso = toIsoDateStr(String(parsed?.doc_date || "").trim()) || new Date().toISOString().slice(0, 10);
              const dueIso = toIsoDateStr(String(parsed?.due_date || "").trim()) || invoiceIso;

              const docNo = String(parsed?.doc_number || "").trim();
              const memo = docNo ? `Invoice ${docNo}` : "Invoice";

              const createdBill = await prisma.bill.create({
                data: {
                  business_id: biz,
                  vendor_id: vendorLinked.id,
                  invoice_date: new Date(invoiceIso + "T00:00:00Z"),
                  due_date: new Date(dueIso + "T00:00:00Z"),
                  amount_cents: BigInt(amountCents), // positive
                  status: "OPEN",
                  memo,
                  terms: null,
                  upload_id: row.id,
                  created_by_user_id: sub,
                  created_at: new Date(),
                  updated_at: new Date(),
                },
                select: { id: true },
              });

              billLinked = createdBill;
            }
          }
        }
      }

      const mergedMeta = {
        ...baseMeta,
        etag: etag ?? baseMeta.etag,
        parsed_status: parseStatus,
        parsed,
        ...(vendorLinked ? { vendor_id: vendorLinked.id, vendor_name: vendorLinked.name } : {}),
        ...(billLinked ? { bill_id: billLinked.id, bill_created_at: new Date().toISOString() } : {}),
      };

      const updated = await prisma.upload.update({
        where: { id: row.id },
        data: {
          status: "COMPLETED",
          completed_at: new Date(),
          size_bytes: BigInt(contentLength),
          meta: mergedMeta,
        },
      });

      return json(200, {
        ok: true,
        upload: {
          id: updated.id,
          business_id: updated.business_id,
          account_id: updated.account_id,
          upload_type: updated.upload_type,
          s3_bucket: updated.s3_bucket,
          s3_key: updated.s3_key,
          original_filename: updated.original_filename,
          content_type: updated.content_type,
          size_bytes: updated.size_bytes.toString(),
          status: updated.status,
          etag,
          created_at: updated.created_at.toISOString(),
          completed_at: updated.completed_at?.toISOString() ?? null,
          meta: mergedMeta,
        },
      });
    } catch (e: any) {
      console.error("uploads.complete failed", { uploadId: row.id, err: e?.message });
      return json(500, { ok: false, error: "Complete failed" });
    }
  }

    // -------------------------
  // CREATE ENTRY FROM UPLOAD (POST /uploads/{uploadId}/create-entry)
  // -------------------------
  if (method === "POST" && path === `${uploadsBasePath}/${uploadId}/create-entry`) {
    const requestedUploadId = uploadId?.toString?.().trim();
    if (!requestedUploadId) return json(400, { ok: false, error: "Missing uploadId" });

    const row = await prisma.upload.findFirst({
      where: { id: requestedUploadId, business_id: biz },
      select: { id: true, account_id: true, upload_type: true, original_filename: true, status: true, meta: true },
    });
    if (!row) return json(404, { ok: false, error: "Upload not found" });

    // Must be account-scoped for ledger entries
    if (!row.account_id) return json(400, { ok: false, error: "Upload missing account_id" });

    // Receipt/Invoice create-entry is only valid after COMPLETE finishes extraction
    if (row.status !== "COMPLETED") {
      return json(409, { ok: false, code: "RETRIEVING", error: "Still retrieving…" });
    }

    const okAcct = await requireAccountInBusiness(prisma, biz, row.account_id);
    if (!okAcct) return json(404, { ok: false, error: "Account not found in this business" });

    const metaObj = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? (row.meta as any) : {};
    if (metaObj.entry_id) {
      return json(200, { ok: true, entry_id: metaObj.entry_id, already: true });
    }

    // Durable guard: if an entry already exists for this upload, return it (DB-backed)
    const existingBySource = await prisma.entry.findFirst({
      where: { business_id: biz, sourceUploadId: row.id },
      select: { id: true },
    });
    if (existingBySource) {
      return json(200, { ok: true, entry_id: existingBySource.id, already: true });
    }

    const parsed = getParsedMeta(metaObj);
    if (!parsed) return json(400, { ok: false, error: "No parsed data available" });

    const amountCents = parsed.amount_cents;
    if (typeof amountCents !== "number" || !Number.isFinite(amountCents) || amountCents === 0) {
      return json(400, { ok: false, error: "Parsed amount missing" });
    }

    const docDate = toIsoDateStr(String(parsed.doc_date || "").trim());
    const date = docDate || new Date().toISOString().slice(0, 10);

    // Stage 2A: closed period enforcement (409 CLOSED_PERIOD)
    const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: date });
    if (!cp.ok) return cp.response;

    const vendorName = String(parsed.vendor_name || metaObj.vendor_name || "").trim();
    const docNo = String(parsed.doc_number || "").trim();

    const fallbackPayee = filenameStem(row.original_filename) || "Vendor";
    const storeName = vendorName || fallbackPayee;

    // Receipt requirements:
    // payee = store/merchant (fallback filename stem)
    // memo = "Receipt <receiptNo>" optional
    const payee = storeName;
    const memo = row.upload_type === "RECEIPT" ? (docNo ? `Receipt ${docNo}` : "Receipt") : docNo ? `Invoice ${docNo}` : "Invoice";
const entry = await prisma.entry.create({
      data: {
        id: randomUUID(),
        business_id: biz,
        account_id: row.account_id,
        date: new Date(date + "T00:00:00Z"),
        payee,
        memo,
        amount_cents: BigInt(-Math.abs(amountCents)),
        type: "EXPENSE",
        method: "OTHER",
        status: "EXPECTED",
        category_id: null,
        vendor_id: row.upload_type === "INVOICE" ? (metaObj.vendor_id ?? null) : null,
        sourceUploadId: row.id,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      select: { id: true },
    });

    const nextMeta = { ...metaObj, entry_id: entry.id, entry_created_at: new Date().toISOString() };

    await prisma.upload.update({
      where: { id: row.id },
      data: { meta: nextMeta },
    });

    return json(200, { ok: true, entry_id: entry.id, already: false });
  }

  // -------------------------
  // BULK CREATE ENTRIES (POST /uploads/create-entries)
  // body: { upload_ids: string[] }
  // -------------------------
  if (method === "POST" && path === `${uploadsBasePath}/create-entries`) {
    try {
      let body: any = {};
      try {
        body = event?.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }

    const ids = Array.isArray(body?.upload_ids) ? body.upload_ids.map((x: any) => String(x)) : [];
    const entryDates = body?.entry_dates && typeof body.entry_dates === "object" ? body.entry_dates : {};
    if (ids.length === 0) return json(400, { ok: false, error: "upload_ids required" });

    const rows = await prisma.upload.findMany({
      where: { business_id: biz, id: { in: ids } },
      select: { id: true, account_id: true, upload_type: true, original_filename: true, status: true, meta: true },
    });

    const out: any[] = [];

    for (const r of rows) {
      if (!r.account_id) {
        out.push({ upload_id: r.id, error: "Upload missing account_id" });
        continue;
      }

      const okAcct = await requireAccountInBusiness(prisma, biz, r.account_id);
      if (!okAcct) {
        out.push({ upload_id: r.id, error: "Account not found" });
        continue;
      }

      const metaObj = r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? (r.meta as any) : {};
      if (metaObj.entry_id) {
        out.push({ upload_id: r.id, entry_id: metaObj.entry_id, already: true });
        continue;
      }

      if (r.status !== "COMPLETED") {
        out.push({ upload_id: r.id, error: "Still retrieving…", code: "RETRIEVING" });
        continue;
      }

      const existingBySource = await prisma.entry.findFirst({
        where: { business_id: biz, sourceUploadId: r.id },
        select: { id: true },
      });
      if (existingBySource) {
        out.push({ upload_id: r.id, entry_id: existingBySource.id, already: true });
        continue;
      }

      const parsed = getParsedMeta(metaObj);
      if (!parsed) {
        out.push({ upload_id: r.id, error: "No parsed data" });
        continue;
      }

      const amountCents = parsed.amount_cents;
      if (typeof amountCents !== "number" || !Number.isFinite(amountCents) || amountCents === 0) {
        out.push({ upload_id: r.id, error: "Parsed amount missing" });
        continue;
      }

      const override = toIsoDateStr(entryDates?.[r.id] ? String(entryDates[r.id]).trim() : "");
      const docDate = toIsoDateStr(String(parsed.doc_date || "").trim());
      const date = override || docDate || new Date().toISOString().slice(0, 10);

      // Stage 2A: closed period enforcement (409 CLOSED_PERIOD)
      const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: date });
      if (!cp.ok) {
        out.push({ upload_id: r.id, error: "This period is closed.", code: "CLOSED_PERIOD" });
        continue;
      }

      const vendorName = String(parsed.vendor_name || metaObj.vendor_name || "").trim();
      const docNo = String(parsed.doc_number || "").trim();

      const fallbackPayee = filenameStem(r.original_filename) || "Vendor";
      const storeName = vendorName || fallbackPayee;

      const payee = storeName;
      const memo = r.upload_type === "RECEIPT" ? (docNo ? `Receipt ${docNo}` : "Receipt") : docNo ? `Invoice ${docNo}` : "Invoice";
      const entry = await prisma.entry.create({
        data: {
          id: randomUUID(),
          business_id: biz,
          account_id: r.account_id,
          date: new Date(date + "T00:00:00Z"),
          payee,
          memo,
          amount_cents: BigInt(-Math.abs(amountCents)),
          type: "EXPENSE",
          method: "OTHER",
          status: "EXPECTED",
          category_id: null,
          vendor_id: r.upload_type === "INVOICE" ? (metaObj.vendor_id ?? null) : null,
          sourceUploadId: r.id,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        select: { id: true },
      });

      const nextMeta = { ...metaObj, entry_id: entry.id, entry_created_at: new Date().toISOString() };
      await prisma.upload.update({ where: { id: r.id }, data: { meta: nextMeta } });

      out.push({ upload_id: r.id, entry_id: entry.id, already: false });
    }

      return json(200, { ok: true, results: out });
    } catch (e: any) {
      console.error("uploads.create-entries failed", { err: e?.message, stack: e?.stack });
      return json(500, { ok: false, error: `Create entries failed: ${e?.message || "unknown"}` });
    }
  }

  // -------------------------
  // BACKFILL BILLS (POST /uploads/backfill-bills)  [Accounts Payable]
  // body: { vendor_id?: string, limit?: number, cursor?: { created_at: string, id: string } }
  // Safe for scale: paging via created_at/id cursor. Idempotent: never double-creates bills.
  // -------------------------
  if (method === "POST" && path === `${uploadsBasePath}/backfill-bills`) {
    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const vendorFilter = body?.vendor_id ? String(body.vendor_id).trim() : "";
    const limitRaw = Number(body?.limit ?? 100);
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 100));

    const cursorCreatedAt = body?.cursor?.created_at ? String(body.cursor.created_at).trim() : "";
    const cursorId = body?.cursor?.id ? String(body.cursor.id).trim() : "";

    const where: any = {
      business_id: biz,
      upload_type: "INVOICE",
      status: "COMPLETED",
      deleted_at: null,
    };

    // Only uploads tagged to a vendor
    where.meta = { path: ["vendor_id"], not: null };
    if (vendorFilter) where.meta = { path: ["vendor_id"], equals: vendorFilter };

    // Pagination cursor
    if (cursorCreatedAt && cursorId) {
      const dt = new Date(cursorCreatedAt);
      if (!isNaN(dt.getTime())) {
        where.OR = [
          { created_at: { lt: dt } },
          { created_at: dt, id: { lt: cursorId } },
        ];
      }
    }

    const rows = await prisma.upload.findMany({
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true, created_at: true, original_filename: true, meta: true },
    });

    let created = 0;
    let skipped = 0;
    const results: any[] = [];

    for (const r of rows) {
      const metaObj = r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? (r.meta as any) : {};
      const vendorId = metaObj.vendor_id ? String(metaObj.vendor_id).trim() : "";
      if (!vendorId) {
        skipped += 1;
        results.push({ upload_id: r.id, status: "SKIPPED", reason: "MISSING_VENDOR_ID" });
        continue;
      }

      // idempotent: if bill already exists for upload, skip
      const exists = await prisma.bill.findFirst({
        where: { business_id: biz, upload_id: r.id },
        select: { id: true },
      });
      if (exists) {
        skipped += 1;
        results.push({ upload_id: r.id, status: "SKIPPED", reason: "ALREADY_HAS_BILL", bill_id: exists.id });
        continue;
      }

      const parsed = getParsedMeta(metaObj);
      const cents = parsed?.amount_cents ?? null;
      if (typeof cents !== "number" || !Number.isFinite(cents) || cents === 0) {
        skipped += 1;
        results.push({ upload_id: r.id, status: "SKIPPED", reason: "MISSING_AMOUNT", code: "NEEDS_REVIEW" });
        continue;
      }

      const amountCents = Math.abs(Math.round(cents));
      const invoiceIso = toIsoDateStr(String(parsed?.doc_date || "").trim()) || new Date().toISOString().slice(0, 10);
      const dueIso = toIsoDateStr(String(parsed?.due_date || "").trim()) || invoiceIso;
      const docNo = String(parsed?.doc_number || "").trim();
      const memo = docNo ? `Invoice ${docNo}` : filenameStem(r.original_filename) ? `Invoice ${filenameStem(r.original_filename)}` : "Invoice";

      try {
        const bill = await prisma.bill.create({
          data: {
            business_id: biz,
            vendor_id: vendorId,
            invoice_date: new Date(invoiceIso + "T00:00:00Z"),
            due_date: new Date(dueIso + "T00:00:00Z"),
            amount_cents: BigInt(amountCents),
            status: "OPEN",
            memo,
            terms: null,
            upload_id: r.id,
            created_by_user_id: sub,
            created_at: new Date(),
            updated_at: new Date(),
          },
          select: { id: true },
        });

        // store bill_id back onto upload meta for traceability
        const nextMeta = { ...metaObj, bill_id: bill.id, bill_created_at: new Date().toISOString() };
        await prisma.upload.update({ where: { id: r.id }, data: { meta: nextMeta } });

        created += 1;
        results.push({ upload_id: r.id, status: "CREATED", bill_id: bill.id });
      } catch (e: any) {
        // uniqueness by upload_id (if added) will also make this safe
        skipped += 1;
        results.push({ upload_id: r.id, status: "SKIPPED", reason: "CREATE_FAILED", error: e?.message || "Failed" });
      }
    }

    const next_cursor =
      rows.length === limit
        ? { created_at: rows[rows.length - 1].created_at.toISOString(), id: rows[rows.length - 1].id }
        : null;

    return json(200, { ok: true, created, skipped, next_cursor, results });
  }

  // -------------------------
  // SOFT DELETE UPLOAD (POST /uploads/{uploadId}/delete)
  // Strict checks: 409 if referenced by Bill.upload_id or Entry.sourceUploadId
  // -------------------------
  if (method === "POST" && path === `${uploadsBasePath}/${uploadId}/delete`) {
    const requestedUploadId = uploadId?.toString?.().trim();
    if (!requestedUploadId) return json(400, { ok: false, error: "Missing uploadId" });

    const row = await prisma.upload.findFirst({
      where: { id: requestedUploadId, business_id: biz },
      select: { id: true, deleted_at: true },
    });
    if (!row) return json(404, { ok: false, error: "Upload not found" });
    if (row.deleted_at) return json(200, { ok: true, deleted: true, already: true });

    const billRef = await prisma.bill.findFirst({
      where: { business_id: biz, upload_id: requestedUploadId },
      select: { id: true },
    });
    if (billRef) return json(409, { ok: false, error: "UPLOAD_REFERENCED_BY_BILL" });

    const entryRef = await prisma.entry.findFirst({
      where: { business_id: biz, sourceUploadId: requestedUploadId },
      select: { id: true },
    });
    if (entryRef) return json(409, { ok: false, error: "UPLOAD_REFERENCED_BY_ENTRY" });

    await prisma.upload.update({
      where: { id: requestedUploadId },
      data: { deleted_at: new Date(), deleted_by_user_id: sub },
    });

    return json(200, { ok: true, deleted: true });
  }

  // -------------------------
  // IMPORT (POST /uploads/{uploadId}/import)  [Phase 4C]
  // Manual CSV import -> BankTransaction rows ONLY (no ledger mutations)
  // -------------------------
  if (method === "POST" && path === `${uploadsBasePath}/${uploadId}/import`) {
    const requestedUploadId = uploadId?.toString?.().trim();
    if (!requestedUploadId) return json(400, { ok: false, error: "Missing uploadId" });

    const row = await prisma.upload.findFirst({
      where: { id: requestedUploadId, business_id: biz },
      select: {
        id: true,
        business_id: true,
        account_id: true,
        upload_type: true,
        s3_bucket: true,
        s3_key: true,
        content_type: true,
        status: true,
        meta: true,
      },
    });

    if (!row) return json(404, { ok: false, error: "Upload not found" });
    if (row.upload_type !== "BANK_STATEMENT") return json(400, { ok: false, error: "Not a bank statement upload" });
    if (!row.account_id) return json(400, { ok: false, error: "BANK_STATEMENT upload missing account_id" });
    if (row.status !== "COMPLETED") return json(400, { ok: false, error: "Upload must be COMPLETED before import" });

    // Safety: verify object exists and size is reasonable before downloading
    const head = await s3.send(new HeadObjectCommand({ Bucket: row.s3_bucket, Key: row.s3_key }));
    const size = head.ContentLength ?? 0;
    const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10MB safety guard
    if (size <= 0) return json(400, { ok: false, error: "Uploaded object has no size" });
    if (size > MAX_CSV_BYTES) return json(400, { ok: false, error: "CSV too large to import" });

    // Mark import lifecycle in meta (do not overload Upload.status)
    const baseMeta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? (row.meta as Record<string, any>) : {};
    await prisma.upload.update({
      where: { id: row.id },
      data: {
        meta: { ...baseMeta, importStatus: "IMPORTING", importStartedAt: new Date().toISOString() },
      },
    });

    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: row.s3_bucket, Key: row.s3_key }));
      const text = await streamToString(obj.Body);

      // Parse CSV using adapter registry (BoA first)
      const parsed = parseBankStatementCsv(text);
      const parser = parsed.parser;

      // Retention: if Plaid connection exists, enforce effective_start_date
      const conn = await prisma.bankConnection.findFirst({
        where: { business_id: biz, account_id: row.account_id },
        select: { effective_start_date: true },
      });
      const retentionStart = conn?.effective_start_date ? new Date(conn.effective_start_date) : null;

      let importedCount = 0;
      let duplicateCount = 0;
      let skippedByRetentionCount = 0;

      for (const r of parsed.rows) {
        if (!r.postedDate) continue;

        const postedDate = new Date(`${r.postedDate}T00:00:00Z`);
        if (retentionStart && postedDate < retentionStart) {
          skippedByRetentionCount += 1;
          continue;
        }

        const importHash = computeImportHash({
          businessId: biz,
          accountId: row.account_id,
          postedDate: r.postedDate,
          amountCents: r.amountCents.toString(),
          description: r.description,
          parser,
        });

        const raw = {
          ...(r.raw ?? {}),
          source_upload_id: row.id,
          source_parser: parser,
          source_row_index: r.sourceRowIndex,
        };

        try {
          await prisma.bankTransaction.create({
            data: {
              business_id: biz,
              account_id: row.account_id,
              // Plaid fields are null for CSV
              plaid_transaction_id: null,
              plaid_account_id: null,

              posted_date: postedDate,
              authorized_date: null,
              amount_cents: r.amountCents,
              name: r.description,
              is_pending: false,
              iso_currency_code: null,

              is_removed: false,
              removed_at: null,

              raw,

              // Phase 4C audit fields
              source: "CSV",
              source_upload_id: row.id,
              source_parser: parser,
              import_hash: importHash,
            },
          });
          importedCount += 1;
        } catch {
          duplicateCount += 1;
        }
      }

      const finishedMeta = {
        ...baseMeta,
        importStatus: "IMPORTED",
        importFinishedAt: new Date().toISOString(),
        importParser: parser,
        importImportedCount: importedCount,
        importDuplicateCount: duplicateCount,
        importSkippedByRetentionCount: skippedByRetentionCount,
      };

      await prisma.upload.update({
        where: { id: row.id },
        data: { meta: finishedMeta },
      });

      return json(200, {
        ok: true,
        parser,
        importedCount,
        duplicateCount,
        skippedByRetentionCount,
      });
    } catch (e: any) {
      const baseMeta2 =
        row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? (row.meta as Record<string, any>) : {};
      await prisma.upload.update({
        where: { id: row.id },
        data: {
          meta: {
            ...baseMeta2,
            importStatus: e?.message === "UNKNOWN_FORMAT" ? "NEEDS_REVIEW" : "FAILED",
            importFinishedAt: new Date().toISOString(),
            importError: e?.message ?? "Import failed",
          },
        },
      });

      const msg = e?.message === "UNKNOWN_FORMAT" ? "Unsupported CSV format" : "Import failed";
      return json(400, { ok: false, error: msg });
    }
  }

  // -------------------------
  // LIST (GET /uploads)
  // -------------------------
  if (method === "GET" && path === uploadsBasePath) {
    const qs = event?.queryStringParameters ?? {};
    const typesRaw = qs.type;
    const accountId = qs.accountId ? qs.accountId.toString().trim() : null;
    const vendorId = qs.vendorId ? qs.vendorId.toString().trim() : null;

    const types = parseTypeFilter(typesRaw);
    if (types) {
      for (const t of types) {
        if (!ALLOWED_TYPES.has(t)) return json(400, { ok: false, error: `Invalid type: ${t}` });
      }
    }

    const limitRaw = Number(qs.limit ?? 20);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 20));

    if (types?.includes("BANK_STATEMENT") && !accountId) {
      return json(400, { ok: false, error: "accountId is required for BANK_STATEMENT list" });
    }

    if (accountId) {
      const ok = await requireAccountInBusiness(prisma, biz, accountId);
      if (!ok) return json(404, { ok: false, error: "Account not found in this business" });
    }

    const includeDeleted = qs.include_deleted === "true";

    const where: any = { business_id: biz };
    if (!includeDeleted) where.deleted_at = null;
    if (accountId) where.account_id = accountId;

    // Filter invoice uploads by vendor tag stored in meta.vendor_id
    if (vendorId) {
      where.meta = { path: ["vendor_id"], equals: vendorId };
    }

    if (types && types.length === 1) where.upload_type = types[0];
    else if (types && types.length > 1) where.upload_type = { in: types };

    const rows = await prisma.upload.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
      select: {
        id: true,
        business_id: true,
        account_id: true,
        upload_type: true,
        original_filename: true,
        content_type: true,
        size_bytes: true,
        status: true,
        created_at: true,
        completed_at: true,
        meta: true,
      },
    });

    return json(200, {
      ok: true,
      items: rows.map((r: any) => ({
        id: r.id,
        business_id: r.business_id,
        account_id: r.account_id,
        upload_type: r.upload_type,
        original_filename: r.original_filename,
        content_type: r.content_type,
        size_bytes: r.size_bytes?.toString?.() ?? String(r.size_bytes),
        status: r.status,
        created_at: r.created_at?.toISOString?.() ?? r.created_at,
        completed_at: r.completed_at?.toISOString?.() ?? r.completed_at,
        meta: r.meta ?? null,
      })),
    });
  }

  // -------------------------
  // DOWNLOAD (GET /uploads/{uploadId}/download)
  // -------------------------
  if (method === "GET" && path?.startsWith(`${uploadsBasePath}/`) && path?.endsWith(`/download`)) {
    const requestedUploadId = uploadId?.toString?.().trim();
    if (!requestedUploadId) return json(400, { ok: false, error: "Missing uploadId" });

    const row = await prisma.upload.findFirst({
      where: { id: requestedUploadId, business_id: biz },
      select: {
        id: true,
        business_id: true,
        account_id: true,
        upload_type: true,
        s3_bucket: true,
        s3_key: true,
        original_filename: true,
        content_type: true,
        status: true,
      },
    });

    if (!row) return json(404, { ok: false, error: "Upload not found" });

    // allow COMPLETED or UPLOADED
    if (row.status !== "COMPLETED" && row.status !== "UPLOADED") {
      return json(400, { ok: false, error: "Upload not downloadable" });
    }

    if (row.account_id) {
      const ok = await requireAccountInBusiness(prisma, biz, row.account_id);
      if (!ok) return json(404, { ok: false, error: "Account not found in this business" });
    }

    const disposition = contentDisposition(row.original_filename);
    const responseContentType = row.content_type || "application/octet-stream";

    const cmd = new GetObjectCommand({
      Bucket: row.s3_bucket,
      Key: row.s3_key,
      ResponseContentDisposition: disposition,
      ResponseContentType: responseContentType,
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: 300 });

    return json(200, { ok: true, download: { url, expiresInSeconds: 300 } });
  }

  return json(404, { ok: false, error: "Not found" });
}
