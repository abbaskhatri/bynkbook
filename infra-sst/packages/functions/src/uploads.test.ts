import { afterEach, describe, expect, test, vi } from "vitest";

const businessId = "11111111-1111-4111-8111-111111111111";
const uploadId = "22222222-2222-4222-8222-222222222222";
const userId = "user-1";

function completeEvent(body: any) {
  return {
    body: JSON.stringify(body),
    pathParameters: { businessId },
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId } } },
      http: {
        method: "POST",
        path: `/v1/businesses/${businessId}/uploads/complete`,
      },
    },
  };
}

function field(type: string, text: string, confidence = 99) {
  return {
    Type: { Text: type },
    ValueDetection: { Text: text, Confidence: confidence },
  };
}

function textractInvoiceResponse() {
  return {
    ExpenseDocuments: [
      {
        SummaryFields: [
          field("VENDOR_NAME", "Acme Supplies"),
          field("INVOICE_RECEIPT_ID", "INV-100"),
          field("INVOICE_RECEIPT_DATE", "2026-04-15"),
          field("DUE_DATE", "2026-05-15"),
          field("AMOUNT_DUE", "$123.45"),
        ],
      },
    ],
  };
}

function makeUploadRow(overrides: Record<string, any> = {}) {
  return {
    id: uploadId,
    business_id: businessId,
    account_id: "33333333-3333-4333-8333-333333333333",
    upload_type: "INVOICE",
    s3_bucket: "uploads-test",
    s3_key: "private/biz/invoice.pdf",
    original_filename: "invoice.pdf",
    content_type: "application/pdf",
    size_bytes: 1000n,
    status: "UPLOADED",
    created_by_user_id: userId,
    created_at: new Date("2026-04-15T12:00:00.000Z"),
    completed_at: null,
    meta: null,
    ...overrides,
  };
}

function makePrisma(row = makeUploadRow()) {
  const prisma: any = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role: "OWNER" })),
    },
    upload: {
      findFirst: vi.fn(async () => row),
      update: vi.fn(async (args: any) => ({
        ...row,
        ...args.data,
        created_at: row.created_at,
      })),
    },
    vendor: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "vendor-created", name: "Acme Supplies" })),
    },
    bill: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "bill-created" })),
    },
  };
  return prisma;
}

async function loadUploadsHandler(prisma: any, textractResponse = textractInvoiceResponse()) {
  vi.resetModules();
  process.env.UPLOADS_BUCKET_NAME = "uploads-test";
  process.env.AWS_REGION = "us-east-1";

  const s3Send = vi.fn(async () => ({ ETag: '"etag-test"', ContentLength: 4321 }));
  const textractSend = vi.fn(async () => textractResponse);

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  vi.doMock("@aws-sdk/client-s3", () => ({
    S3Client: vi.fn(function () {
      return { send: s3Send };
    }),
    PutObjectCommand: class {
      input: any;
      constructor(input: any) {
        this.input = input;
      }
    },
    HeadObjectCommand: class {
      input: any;
      constructor(input: any) {
        this.input = input;
      }
    },
    GetObjectCommand: class {
      input: any;
      constructor(input: any) {
        this.input = input;
      }
    },
  }));

  vi.doMock("@aws-sdk/client-textract", () => ({
    TextractClient: vi.fn(function () {
      return { send: textractSend };
    }),
    AnalyzeExpenseCommand: class {
      input: any;
      constructor(input: any) {
        this.input = input;
      }
    },
  }));

  vi.doMock("@aws-sdk/s3-request-presigner", () => ({
    getSignedUrl: vi.fn(async () => "https://uploads.example.test/signed"),
  }));

  const mod = await import("./uploads");
  return { handler: mod.handler, s3Send, textractSend };
}

function bodyOf(res: any) {
  return JSON.parse(res.body);
}

function expectScopedUploadLookup(prisma: any) {
  expect(prisma.upload.findFirst).toHaveBeenCalledWith({
    where: { id: uploadId, business_id: businessId, created_by_user_id: userId },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.UPLOADS_BUCKET_NAME;
  delete process.env.AWS_REGION;
});

describe("uploads.complete invoice review-only guard", () => {
  test("invoice reviewOnly true completes and stores parsed result without creating vendor or AP bill", async () => {
    const prisma = makePrisma(
      makeUploadRow({
        meta: {
          vendor_id: "vendor-from-init",
          vendor_name: "Init Vendor",
          bill_id: "bill-from-init",
          bill_created_at: "2026-04-15T12:00:00.000Z",
          source: "mobile-camera",
        },
      })
    );
    const { handler } = await loadUploadsHandler(prisma);

    const res = await handler(completeEvent({ uploadId, reviewOnly: true }));
    const payload = bodyOf(res);

    expect(res.statusCode).toBe(200);
    expect(payload.upload.status).toBe("COMPLETED");
    expect(payload.upload.meta).toMatchObject({
      parsed_status: "NEEDS_REVIEW",
      review_only: true,
      mode: "REVIEW_ONLY",
      needs_review: true,
      error_code: "NEEDS_REVIEW",
      source: "mobile-camera",
    });
    expect(payload.upload.meta.parsed).toMatchObject({
      vendor_name: "Acme Supplies",
      doc_number: "INV-100",
      amount_cents: 12345,
      review_message: "Invoice uploaded in review-only mode; vendor and bill creation skipped.",
    });
    expect(payload.upload.meta.parsed.review_reasons).toContain("review_only");
    expect(payload.upload.meta.vendor_id).toBeUndefined();
    expect(payload.upload.meta.vendor_name).toBeUndefined();
    expect(payload.upload.meta.bill_id).toBeUndefined();
    expect(payload.upload.meta.bill_created_at).toBeUndefined();
    expect(prisma.vendor.findFirst).not.toHaveBeenCalled();
    expect(prisma.vendor.create).not.toHaveBeenCalled();
    expect(prisma.bill.findFirst).not.toHaveBeenCalled();
    expect(prisma.bill.create).not.toHaveBeenCalled();
    expect(prisma.upload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: uploadId },
        data: expect.objectContaining({
          status: "COMPLETED",
          size_bytes: 4321n,
          meta: expect.objectContaining({
            parsed: expect.objectContaining({ amount_cents: 12345 }),
          }),
        }),
      })
    );
    expectScopedUploadLookup(prisma);
  });

  test("invoice mode REVIEW_ONLY also suppresses vendor and AP bill creation", async () => {
    const prisma = makePrisma();
    const { handler } = await loadUploadsHandler(prisma);

    const res = await handler(completeEvent({ uploadId, mode: "REVIEW_ONLY" }));
    const payload = bodyOf(res);

    expect(res.statusCode).toBe(200);
    expect(payload.upload.meta.mode).toBe("REVIEW_ONLY");
    expect(prisma.vendor.create).not.toHaveBeenCalled();
    expect(prisma.bill.create).not.toHaveBeenCalled();
    expectScopedUploadLookup(prisma);
  });

  test("invoice complete without reviewOnly preserves vendor and AP bill creation", async () => {
    const prisma = makePrisma();
    const { handler } = await loadUploadsHandler(prisma);

    const res = await handler(completeEvent({ uploadId }));
    const payload = bodyOf(res);

    expect(res.statusCode).toBe(200);
    expect(prisma.vendor.create).toHaveBeenCalledWith({
      data: { business_id: businessId, name: "Acme Supplies", notes: null },
      select: { id: true, name: true },
    });
    expect(prisma.bill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        business_id: businessId,
        vendor_id: "vendor-created",
        amount_cents: 12345n,
        status: "OPEN",
        memo: "Invoice INV-100",
        upload_id: uploadId,
        created_by_user_id: userId,
      }),
      select: { id: true },
    });
    expect(payload.upload.meta).toMatchObject({
      parsed_status: "PARSED",
      vendor_id: "vendor-created",
      vendor_name: "Acme Supplies",
      bill_id: "bill-created",
    });
    expect(payload.upload.meta.review_only).toBeUndefined();
    expectScopedUploadLookup(prisma);
  });

  test("receipt completion remains unchanged even if reviewOnly is present", async () => {
    const prisma = makePrisma(makeUploadRow({ upload_type: "RECEIPT" }));
    const { handler } = await loadUploadsHandler(prisma);

    const res = await handler(completeEvent({ uploadId, reviewOnly: true }));
    const payload = bodyOf(res);

    expect(res.statusCode).toBe(200);
    expect(payload.upload.meta.parsed_status).toBe("PARSED");
    expect(payload.upload.meta.review_only).toBeUndefined();
    expect(payload.upload.meta.mode).toBeUndefined();
    expect(prisma.vendor.create).not.toHaveBeenCalled();
    expect(prisma.bill.create).not.toHaveBeenCalled();
    expectScopedUploadLookup(prisma);
  });
});
