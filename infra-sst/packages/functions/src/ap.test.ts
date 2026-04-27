import { afterEach, describe, expect, test, vi } from "vitest";
import { deriveBillStatus } from "./ap";

const businessId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const entryId = "33333333-3333-4333-8333-333333333333";
const vendorId = "44444444-4444-4444-8444-444444444444";
const billId = "55555555-5555-4555-8555-555555555555";
const appId = "66666666-6666-4666-8666-666666666666";

describe("AP deriveBillStatus", () => {
  test("void overrides", () => {
    expect(deriveBillStatus({ isVoid: true, amount: 100n, applied: 0n })).toBe("VOID");
    expect(deriveBillStatus({ isVoid: true, amount: 100n, applied: 100n })).toBe("VOID");
  });

  test("open/partial/paid", () => {
    expect(deriveBillStatus({ isVoid: false, amount: 100n, applied: 0n })).toBe("OPEN");
    expect(deriveBillStatus({ isVoid: false, amount: 100n, applied: 1n })).toBe("PARTIAL");
    expect(deriveBillStatus({ isVoid: false, amount: 100n, applied: 99n })).toBe("PARTIAL");
    expect(deriveBillStatus({ isVoid: false, amount: 100n, applied: 100n })).toBe("PAID");
  });
});

function vendorsSummaryEvent(vendorIds: string[]) {
  return {
    queryStringParameters: {
      asOf: "2026-04-27",
      limit: "500",
      vendor_ids: vendorIds.join(","),
    },
    pathParameters: { businessId: "11111111-1111-4111-8111-111111111111" },
    requestContext: {
      authorizer: { jwt: { claims: { sub: "user-1" } } },
      http: {
        method: "GET",
        path: "/v1/businesses/11111111-1111-4111-8111-111111111111/ap/vendors-summary",
      },
    },
  };
}

async function loadHandler() {
  vi.resetModules();

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role: "OWNER" })),
    },
    $queryRaw: vi.fn(async () => []),
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  const mod = await import("./ap");
  return { handler: mod.handler, prisma };
}

function unapplyAndDeleteEvent(body: any = {}) {
  return {
    body: JSON.stringify(body),
    pathParameters: { businessId, accountId, entryId },
    requestContext: {
      authorizer: { jwt: { claims: { sub: "user-1" } } },
      http: {
        method: "POST",
        path: `/v1/businesses/${businessId}/accounts/${accountId}/entries/${entryId}/ap/unapply-and-delete`,
      },
    },
  };
}

function jsonBody(res: any) {
  return JSON.parse(res.body);
}

function createApMutationPrisma(args: {
  role?: string;
  entryDate?: Date;
  closedPeriod?: any;
  apps?: any[];
} = {}) {
  const prisma: any = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role: args.role ?? "OWNER" })),
    },
    closedPeriod: {
      findFirst: vi.fn(async () => args.closedPeriod ?? null),
    },
    entry: {
      findFirst: vi.fn(async () => ({
        id: entryId,
        vendor_id: vendorId,
        date: args.entryDate ?? new Date("2026-04-15T00:00:00.000Z"),
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    billPaymentApplication: {
      findMany: vi.fn(async () => args.apps ?? [{ id: appId, bill_id: billId }]),
      updateMany: vi.fn(async () => ({ count: (args.apps ?? [{ id: appId }]).length })),
      groupBy: vi.fn(async () => []),
    },
    bill: {
      findMany: vi.fn(async () => [{ id: billId, amount_cents: 1000n, voided_at: null }]),
      update: vi.fn(async () => ({})),
    },
    activityLog: {
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  };
  return prisma;
}

async function loadApHandlerWithPrisma(prisma: any) {
  vi.resetModules();

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  const mod = await import("./ap");
  return mod.handler;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("AP vendors summary", () => {
  test("supports the vendors page rendered range of up to 500 vendor ids", async () => {
    const vendorIds = Array.from({ length: 250 }, (_, i) => {
      const suffix = String(i + 1).padStart(12, "0");
      return `22222222-2222-4222-8222-${suffix}`;
    });
    const { handler, prisma } = await loadHandler();

    const res = await handler(vendorsSummaryEvent(vendorIds));

    expect(res.statusCode).toBe(200);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const values = prisma.$queryRaw.mock.calls[0].slice(1);
    expect(values).toContain(500);
    expect(values).toContainEqual(vendorIds);
  });
});

describe("AP unapply-and-delete closed period safety", () => {
  test("blocks before voiding applications or soft-deleting the payment entry when the payment date is closed", async () => {
    const prisma = createApMutationPrisma({
      entryDate: new Date("2026-04-15T00:00:00.000Z"),
      closedPeriod: { id: "closed-1" },
    });
    const handler = await loadApHandlerWithPrisma(prisma);

    const res = await handler(unapplyAndDeleteEvent({ reason: "cleanup" }));

    expect(res.statusCode).toBe(409);
    expect(jsonBody(res)).toMatchObject({
      ok: false,
      code: "CLOSED_PERIOD",
      error: "This period is closed. Reopen period to modify.",
    });
    expect(prisma.entry.findFirst).toHaveBeenCalledWith({
      where: { id: entryId, business_id: businessId, account_id: accountId, deleted_at: null },
      select: { id: true, vendor_id: true, date: true },
    });
    expect(prisma.closedPeriod.findFirst).toHaveBeenCalledWith({
      where: { business_id: businessId, month: "2026-04" },
      select: { id: true },
    });
    expect(prisma.billPaymentApplication.findMany).not.toHaveBeenCalled();
    expect(prisma.billPaymentApplication.updateMany).not.toHaveBeenCalled();
    expect(prisma.entry.updateMany).not.toHaveBeenCalled();
  });

  test("still voids applications and soft-deletes the payment entry when the payment date is open", async () => {
    const prisma = createApMutationPrisma({
      entryDate: new Date("2026-05-03T00:00:00.000Z"),
    });
    const handler = await loadApHandlerWithPrisma(prisma);

    const res = await handler(unapplyAndDeleteEvent({ reason: "cleanup" }));

    expect(res.statusCode).toBe(200);
    expect(jsonBody(res)).toEqual({ ok: true });
    expect(prisma.billPaymentApplication.findMany).toHaveBeenCalledWith({
      where: { business_id: businessId, account_id: accountId, entry_id: entryId, is_active: true },
      select: { id: true, bill_id: true },
    });
    expect(prisma.billPaymentApplication.updateMany).toHaveBeenCalledWith({
      where: { business_id: businessId, account_id: accountId, entry_id: entryId, is_active: true, id: { in: [appId] } },
      data: expect.objectContaining({
        is_active: false,
        voided_by_user_id: "user-1",
        void_reason: "cleanup",
      }),
    });
    expect(prisma.entry.updateMany).toHaveBeenCalledWith({
      where: { id: entryId, business_id: businessId, account_id: accountId, deleted_at: null },
      data: expect.objectContaining({
        vendor_id: null,
        entry_kind: "GENERAL",
      }),
    });
  });

  test("keeps write authorization gate ahead of closed-period checks", async () => {
    const prisma = createApMutationPrisma({ role: "VIEWER" });
    const handler = await loadApHandlerWithPrisma(prisma);

    const res = await handler(unapplyAndDeleteEvent({ reason: "cleanup" }));

    expect(res.statusCode).toBe(403);
    expect(jsonBody(res)).toEqual({ ok: false, error: "Insufficient permissions" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.closedPeriod.findFirst).not.toHaveBeenCalled();
  });
});
