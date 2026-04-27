import { afterEach, describe, expect, test, vi } from "vitest";

function event(method: string, path: string, businessId: string, body?: any, sub = "actor") {
  return {
    body: body === undefined ? undefined : JSON.stringify(body),
    pathParameters: { businessId },
    requestContext: {
      authorizer: { jwt: { claims: { sub, email: `${sub}@example.com` } } },
      http: { method, path },
    },
  };
}

async function loadHandler(role = "OWNER", ownerUserId = "actor") {
  vi.resetModules();

  const logActivity = vi.fn(async () => undefined);
  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role })),
    },
    business: {
      findUnique: vi.fn(async () => ({
        id: "biz-1",
        owner_user_id: ownerUserId,
        name: "Acme Books",
      })),
      delete: vi.fn(async () => ({ id: "biz-1" })),
    },
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));
  vi.doMock("./lib/activityLog", () => ({
    logActivity,
  }));

  const mod = await import("./businesses");
  return { handler: mod.handler, prisma, logActivity };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("business hard delete confirmation", () => {
  test("rejects missing confirmation", async () => {
    const { handler, prisma, logActivity } = await loadHandler("OWNER");

    const res = await handler(event("DELETE", "/v1/businesses/biz-1", "biz-1"));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Confirmation text must be "DELETE"');
    expect(logActivity).not.toHaveBeenCalled();
    expect(prisma.business.delete).not.toHaveBeenCalled();
  });

  test("rejects wrong confirmation", async () => {
    const { handler, prisma, logActivity } = await loadHandler("OWNER");

    const res = await handler(event("DELETE", "/v1/businesses/biz-1", "biz-1", { confirm: "RESET" }));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Confirmation text must be "DELETE"');
    expect(logActivity).not.toHaveBeenCalled();
    expect(prisma.business.delete).not.toHaveBeenCalled();
  });

  test("allows OWNER delete with correct confirmation", async () => {
    const { handler, prisma, logActivity } = await loadHandler("OWNER");

    const res = await handler(event("DELETE", "/v1/businesses/biz-1", "biz-1", { confirm: "DELETE" }));

    expect(res.statusCode).toBe(200);
    expect(logActivity).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        businessId: "biz-1",
        actorUserId: "actor",
        eventType: "BUSINESS_DELETE",
        payloadJson: { business_name: "Acme Books" },
      }),
    );
    expect(prisma.business.delete).toHaveBeenCalledWith({ where: { id: "biz-1" } });
  });

  test("rejects non-owner even with correct confirmation", async () => {
    const { handler, prisma, logActivity } = await loadHandler("ADMIN");

    const res = await handler(event("DELETE", "/v1/businesses/biz-1", "biz-1", { confirm: "DELETE" }));

    expect(res.statusCode).toBe(403);
    expect(logActivity).not.toHaveBeenCalled();
    expect(prisma.business.delete).not.toHaveBeenCalled();
  });
});
