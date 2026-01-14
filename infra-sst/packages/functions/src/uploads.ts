import { randomUUID } from "node:crypto";
import { getPrisma } from "./lib/db";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
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

const ALLOWED_TYPES = new Set(["RECEIPT", "INVOICE", "BANK_STATEMENT"]);

function validateContentType(uploadType: string, contentType: string) {
  const ct = (contentType || "").toLowerCase();
  if (uploadType === "BANK_STATEMENT") {
    // CSV preferred; PDF allowed (parsing later)
    return ct.includes("csv") || ct === "application/pdf" || ct.startsWith("text/");
  }
  // Receipt/Invoice: image/* or PDF
  return ct.startsWith("image/") || ct === "application/pdf";
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

  const uploadsBasePath = `/v1/businesses/${biz}/uploads`;

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
    const maxBytes = uploadType === "BANK_STATEMENT" ? 50 * 1024 * 1024 : 25 * 1024 * 1024;
    if (sizeBytes > maxBytes) return json(400, { ok: false, error: `File too large (max ${maxBytes} bytes)` });

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

      const updated = await prisma.upload.update({
        where: { id: row.id },
        data: {
          status: "COMPLETED",
          completed_at: new Date(),
          size_bytes: BigInt(contentLength),
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
        },
      });
    } catch (e: any) {
      console.error("uploads.complete verify failed", {
        uploadId: row.id,
        bucket: row.s3_bucket,
        key: row.s3_key,
        errName: e?.name,
        errMessage: e?.message,
        errCode: e?.Code || e?.code,
        $metadata: e?.$metadata,
      });

      await prisma.upload.update({
        where: { id: row.id },
        data: { status: "FAILED" },
      });

      return json(500, { ok: false, error: "Failed to verify uploaded object" });
    }
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

    const where: any = { business_id: biz };
    if (accountId) where.account_id = accountId;

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
