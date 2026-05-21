import { afterEach, describe, expect, test, vi } from "vitest";

const entryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const safeCatId = "11111111-1111-4111-8111-111111111111";
const otherCatId = "22222222-2222-4222-8222-222222222222";

function event(body: any) {
  return {
    body: JSON.stringify(body),
    pathParameters: { businessId: "biz-1", accountId: "acct-1" },
    requestContext: {
      authorizer: { jwt: { claims: { sub: "user-1" } } },
      http: {
        method: "POST",
        path: "/v1/businesses/biz-1/accounts/acct-1/entries/apply-category-batch",
      },
    },
  };
}

async function loadHandler(args: {
  role?: string;
  suggestionsById?: Record<string, any[]>;
  body?: any;
  closedMonths?: string[];
}) {
  vi.resetModules();

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role: args.role ?? "OWNER" })),
    },
    account: {
      findFirst: vi.fn(async () => ({ id: "acct-1" })),
    },
    entry: {
      findMany: vi.fn(async () => [
        {
          id: entryId,
          date: new Date("2026-04-01T00:00:00.000Z"),
          payee: "Acme Supplies",
          memo: "Office",
          amount_cents: -1000n,
          type: "EXPENSE",
          category_id: null,
        },
      ]),
      update: vi.fn(async () => ({})),
    },
    closedPeriod: {
      findMany: vi.fn(async (query: any) => {
        const months = query?.where?.month?.in ?? [];
        return (args.closedMonths ?? [])
          .filter((month) => months.includes(month))
          .map((month) => ({ month }));
      }),
    },
    category: {
      findMany: vi.fn(async () => [
        { id: safeCatId, name: "Office Supplies" },
        { id: otherCatId, name: "Meals" },
      ]),
    },
  };

  const computeCategorySuggestionsForItems = vi.fn(async () => ({
    suggestionsById: args.suggestionsById ?? {},
    meta: { version: "catSug_v2" },
  }));

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));
  vi.doMock("./lib/authz", () => ({
    authorizeWrite: vi.fn(async () => ({ allowed: true })),
  }));
  vi.doMock("./lib/activityLog", () => ({
    logActivity: vi.fn(async () => undefined),
  }));
  vi.doMock("./lib/categoryMemoryWriteback", () => ({
    writeCategoryMemoryFeedback: vi.fn(async () => undefined),
  }));
  vi.doMock("./aiCategorySuggestions", () => ({
    computeCategorySuggestionsForItems,
  }));

  const mod = await import("./entries");
  return {
    handler: mod.handler,
    prisma,
    computeCategorySuggestionsForItems,
    request: event(args.body ?? {
      items: [{ entryId, category_id: safeCatId, suggested_category_id: safeCatId }],
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("apply-category-batch category safety", () => {
  test("applies SAFE_DETERMINISTIC top suggestion", async () => {
    const { handler, prisma, request } = await loadHandler({
      suggestionsById: {
        [entryId]: [{ category_id: safeCatId, confidence_tier: "SAFE_DETERMINISTIC", confidence: 95 }],
      },
    });

    const res = await handler(request);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.applied).toBe(1);
    expect(body.blocked).toBe(0);
    expect(prisma.entry.update).toHaveBeenCalledOnce();
  });

  test("applies STRONG_SUGGESTION 85 top suggestion", async () => {
    const { handler, prisma, request } = await loadHandler({
      suggestionsById: {
        [entryId]: [{ category_id: safeCatId, confidence_tier: "STRONG_SUGGESTION", confidence: 85 }],
      },
    });

    const res = await handler(request);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.applied).toBe(1);
    expect(body.blocked).toBe(0);
    expect(prisma.entry.update).toHaveBeenCalledOnce();
  });

  test("rejects ALTERNATE suggestions", async () => {
    const { handler, prisma, request } = await loadHandler({
      suggestionsById: {
        [entryId]: [{ category_id: safeCatId, confidence_tier: "ALTERNATE", confidence: 84 }],
      },
    });

    const res = await handler(request);
    const body = JSON.parse(res.body);

    expect(body.applied).toBe(0);
    expect(body.blocked).toBe(1);
    expect(body.results[0]).toMatchObject({ ok: false, code: "UNSAFE_SUGGESTION" });
    expect(prisma.entry.update).not.toHaveBeenCalled();
  });

  test("rejects confidence below 85", async () => {
    const { handler, prisma, request } = await loadHandler({
      suggestionsById: {
        [entryId]: [{ category_id: safeCatId, confidence_tier: "STRONG_SUGGESTION", confidence: 84 }],
      },
    });

    const res = await handler(request);
    const body = JSON.parse(res.body);

    expect(body.applied).toBe(0);
    expect(body.results[0]).toMatchObject({ ok: false, code: "UNSAFE_SUGGESTION" });
    expect(prisma.entry.update).not.toHaveBeenCalled();
  });

  test("rejects warning or review-required top suggestions", async () => {
    const { handler, prisma, request } = await loadHandler({
      suggestionsById: {
        [entryId]: [
          {
            category_id: safeCatId,
            confidence_tier: "SAFE_DETERMINISTIC",
            confidence: 95,
            requiresUserConfirmation: true,
            warning: "CPA review needed",
          },
        ],
      },
    });

    const res = await handler(request);
    const body = JSON.parse(res.body);

    expect(body.applied).toBe(0);
    expect(body.results[0]).toMatchObject({ ok: false, code: "UNSAFE_SUGGESTION" });
    expect(prisma.entry.update).not.toHaveBeenCalled();
  });

  test("rejects risky payment language even without explicit warning", async () => {
    const { handler, prisma, request } = await loadHandler({
      suggestionsById: {
        [entryId]: [
          {
            category_id: safeCatId,
            category_name: "Credit Card Payment",
            confidence_tier: "SAFE_DETERMINISTIC",
            confidence: 95,
          },
        ],
      },
    });

    const res = await handler(request);
    const body = JSON.parse(res.body);

    expect(body.applied).toBe(0);
    expect(body.results[0]).toMatchObject({ ok: false, code: "UNSAFE_SUGGESTION" });
    expect(prisma.entry.update).not.toHaveBeenCalled();
  });

  test("rejects requested category that does not match the current top suggestion", async () => {
    const { handler, prisma, request } = await loadHandler({
      body: { items: [{ entryId, category_id: otherCatId, suggested_category_id: otherCatId }] },
      suggestionsById: {
        [entryId]: [{ category_id: safeCatId, confidence_tier: "SAFE_DETERMINISTIC", confidence: 95 }],
      },
    });

    const res = await handler(request);
    const body = JSON.parse(res.body);

    expect(body.applied).toBe(0);
    expect(body.results[0]).toMatchObject({ ok: false, code: "SUGGESTION_MISMATCH" });
    expect(prisma.entry.update).not.toHaveBeenCalled();
  });

  test("rejects missing current suggestion", async () => {
    const { handler, prisma, request } = await loadHandler({
      suggestionsById: {},
    });

    const res = await handler(request);
    const body = JSON.parse(res.body);

    expect(body.applied).toBe(0);
    expect(body.results[0]).toMatchObject({ ok: false, code: "SUGGESTION_UNAVAILABLE" });
    expect(prisma.entry.update).not.toHaveBeenCalled();
  });

  test("applies explicit manual category selections without requiring a current suggestion", async () => {
    const { handler, prisma, computeCategorySuggestionsForItems, request } = await loadHandler({
      body: { items: [{ entryId, category_id: safeCatId }] },
      suggestionsById: {
        [entryId]: [{ category_id: safeCatId, confidence_tier: "SAFE_DETERMINISTIC", confidence: 95 }],
      },
    });

    const res = await handler(request);
    const body = JSON.parse(res.body);

    expect(body.applied).toBe(1);
    expect(body.blocked).toBe(0);
    expect(body.blockedByCode).toEqual({});
    expect(prisma.entry.update).toHaveBeenCalledOnce();
    expect(computeCategorySuggestionsForItems).not.toHaveBeenCalled();
  });

  test("reports closed-period blocks by code for affected rows", async () => {
    const { handler, prisma, request } = await loadHandler({
      body: { items: [{ entryId, category_id: safeCatId }] },
      closedMonths: ["2026-04"],
    });

    const res = await handler(request);
    const body = JSON.parse(res.body);

    expect(body.applied).toBe(0);
    expect(body.blocked).toBe(1);
    expect(body.blockedByCode).toEqual({ CLOSED_PERIOD: 1 });
    expect(body.results[0]).toMatchObject({ ok: false, code: "CLOSED_PERIOD", month: "2026-04" });
    expect(prisma.entry.update).not.toHaveBeenCalled();
  });

  test("permission behavior is unchanged", async () => {
    const { handler, prisma, computeCategorySuggestionsForItems, request } = await loadHandler({
      role: "MEMBER",
      suggestionsById: {
        [entryId]: [{ category_id: safeCatId, confidence_tier: "SAFE_DETERMINISTIC", confidence: 95 }],
      },
    });

    const res = await handler(request);

    expect(res.statusCode).toBe(403);
    expect(prisma.entry.update).not.toHaveBeenCalled();
    expect(computeCategorySuggestionsForItems).not.toHaveBeenCalled();
  });
});

