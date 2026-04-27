import { afterEach, describe, expect, test, vi } from "vitest";
import { deriveBillStatus } from "./ap";

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
