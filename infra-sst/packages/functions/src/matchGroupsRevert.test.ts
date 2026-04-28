import { afterEach, describe, expect, test, vi } from "vitest";

function getPreviewEvent(queryStringParameters: Record<string, string>, businessId = "biz-1", accountId = "acct-1") {
  return {
    pathParameters: { businessId, accountId },
    queryStringParameters,
    requestContext: {
      authorizer: { jwt: { claims: { sub: "actor" } } },
      http: {
        method: "GET",
        path: `/v1/businesses/${businessId}/accounts/${accountId}/match-groups/revert-preview`,
      },
    },
  };
}

function postRevertEvent(body: Record<string, any>, businessId = "biz-1", accountId = "acct-1") {
  return {
    pathParameters: { businessId, accountId },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: "actor" } } },
      http: {
        method: "POST",
        path: `/v1/businesses/${businessId}/accounts/${accountId}/match-groups/revert`,
      },
    },
  };
}

function group(overrides: Record<string, any> = {}) {
  return {
    id: "mg-1",
    business_id: "biz-1",
    account_id: "acct-1",
    direction: "OUTFLOW",
    status: "ACTIVE",
    created_at: new Date("2026-04-20T12:00:00.000Z"),
    created_by_user_id: "actor",
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    ...overrides,
  };
}

function bank(overrides: Record<string, any> = {}) {
  return {
    id: "bank-1",
    business_id: "biz-1",
    account_id: "acct-1",
    posted_date: new Date("2026-04-20T00:00:00.000Z"),
    name: "Coffee",
    amount_cents: -1200n,
    is_removed: false,
    source: "PLAID",
    ...overrides,
  };
}

function entry(overrides: Record<string, any> = {}) {
  return {
    id: "entry-1",
    business_id: "biz-1",
    account_id: "acct-1",
    date: new Date("2026-04-20T00:00:00.000Z"),
    payee: "Coffee",
    memo: "Bank txn: Coffee • bank-1",
    amount_cents: -1200n,
    type: "EXPENSE",
    status: "EXPECTED",
    entry_kind: "GENERAL",
    deleted_at: null,
    is_adjustment: false,
    transfer_id: null,
    sourceUploadId: null,
    sourceBankTransactionId: "bank-1",
    ...overrides,
  };
}

function project(row: any, select: any) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

function scalarMatches(value: any, expected: any) {
  if (expected instanceof Date && value instanceof Date) return value.getTime() === expected.getTime();
  return value === expected;
}

function objectMatches(value: any, expected: any) {
  if (expected?.in && !expected.in.some((v: any) => scalarMatches(value, v))) return false;
  if ("not" in expected && scalarMatches(value, expected.not)) return false;
  return true;
}

function rowMatchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if (!objectMatches(row[key], expected)) return false;
      continue;
    }
    if (!scalarMatches(row[key], expected)) return false;
  }
  return true;
}

async function loadHandler(options: {
  groups?: any[];
  banks?: any[];
  entries?: any[];
  groupBanks?: any[];
  groupEntries?: any[];
  closedMonths?: string[];
  accountOk?: boolean;
}) {
  vi.resetModules();

  const groups = [...(options.groups ?? [group()])];
  const banks = [...(options.banks ?? [bank()])];
  const entries = [...(options.entries ?? [entry()])];
  const groupBanks = [
    ...(options.groupBanks ?? [{
      match_group_id: "mg-1",
      business_id: "biz-1",
      account_id: "acct-1",
      bank_transaction_id: "bank-1",
      matched_amount_cents: 1200n,
    }]),
  ];
  const groupEntries = [
    ...(options.groupEntries ?? [{
      match_group_id: "mg-1",
      business_id: "biz-1",
      account_id: "acct-1",
      entry_id: "entry-1",
      matched_amount_cents: 1200n,
    }]),
  ];
  const activityRows: any[] = [];

  const prisma: any = {
    userBusinessRole: {
      findFirst: vi.fn(async (args: any) =>
        args?.where?.business_id === "biz-1" && args?.where?.user_id === "actor" ? { role: "OWNER" } : null
      ),
    },
    account: {
      findFirst: vi.fn(async (args: any) =>
        options.accountOk === false
          ? null
          : args?.where?.business_id === "biz-1" && args?.where?.id === "acct-1"
            ? { id: "acct-1" }
            : null
      ),
    },
    matchGroup: {
      findFirst: vi.fn(async (args: any) => {
        const found = groups
          .filter((row) => rowMatchesWhere(row, args?.where))
          .sort((a, b) => new Date(b.voided_at ?? b.created_at).getTime() - new Date(a.voided_at ?? a.created_at).getTime())[0];
        return found ? project(found, args?.select) : null;
      }),
      findMany: vi.fn(async (args: any) => groups.filter((row) => rowMatchesWhere(row, args?.where)).map((row) => project(row, args?.select))),
      updateMany: vi.fn(async (args: any) => {
        let count = 0;
        for (const row of groups) {
          if (!rowMatchesWhere(row, args?.where)) continue;
          Object.assign(row, args?.data ?? {});
          count++;
        }
        return { count };
      }),
    },
    matchGroupBank: {
      findMany: vi.fn(async (args: any) => groupBanks.filter((row) => rowMatchesWhere(row, args?.where)).map((row) => project(row, args?.select))),
      findFirst: vi.fn(async (args: any) => {
        const found = groupBanks.find((row) => rowMatchesWhere(row, args?.where));
        return found ? project(found, args?.select) : null;
      }),
    },
    matchGroupEntry: {
      findMany: vi.fn(async (args: any) => groupEntries.filter((row) => rowMatchesWhere(row, args?.where)).map((row) => project(row, args?.select))),
      findFirst: vi.fn(async (args: any) => {
        const found = groupEntries.find((row) => rowMatchesWhere(row, args?.where));
        return found ? project(found, args?.select) : null;
      }),
    },
    bankTransaction: {
      findMany: vi.fn(async (args: any) => banks.filter((row) => rowMatchesWhere(row, args?.where)).map((row) => project(row, args?.select))),
    },
    entry: {
      findMany: vi.fn(async (args: any) => entries.filter((row) => rowMatchesWhere(row, args?.where)).map((row) => project(row, args?.select))),
      updateMany: vi.fn(async (args: any) => {
        let count = 0;
        for (const row of entries) {
          if (!rowMatchesWhere(row, args?.where)) continue;
          Object.assign(row, args?.data ?? {});
          count++;
        }
        return { count };
      }),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    closedPeriod: {
      findMany: vi.fn(async (args: any) =>
        (options.closedMonths ?? [])
          .map((month) => ({ business_id: "biz-1", month }))
          .filter((row) => rowMatchesWhere(row, args?.where))
          .map((row) => project(row, args?.select))
      ),
    },
    activityLog: {
      create: vi.fn(async (args: any) => {
        activityRows.push(args?.data);
        return args?.data;
      }),
    },
    $transaction: vi.fn(async (arg: any) => {
      if (typeof arg === "function") return arg(prisma);
      return Promise.all(arg);
    }),
  };

  vi.doMock("./lib/db", () => ({ getPrisma: vi.fn(async () => prisma) }));
  vi.doMock("./lib/authz", () => ({ authorizeWrite: vi.fn(async () => ({ allowed: true })) }));

  const mod = await import("./matchGroups");
  return { handler: mod.handler, prisma, groups, entries, activityRows };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("match group generated-entry revert", () => {
  test("previews and reverts a generated create-entry-and-match with soft delete", async () => {
    const { handler, groups, entries, prisma, activityRows } = await loadHandler({});

    const previewRes = await handler(getPreviewEvent({ matchGroupId: "mg-1" }));
    const preview = JSON.parse(previewRes.body);

    expect(previewRes.statusCode).toBe(200);
    expect(preview.generated_entries_to_soft_delete.map((row: any) => row.id)).toEqual(["entry-1"]);
    expect(preview.actions.map((action: any) => action.type)).toContain("SOFT_DELETE_GENERATED_ENTRY");

    const res = await handler(postRevertEvent({ matchGroupId: "mg-1", confirmSoftDelete: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.soft_deleted_entry_ids).toEqual(["entry-1"]);
    expect(groups[0].status).toBe("VOIDED");
    expect(entries[0].deleted_at).toBeInstanceOf(Date);
    expect(prisma.entry.delete).not.toHaveBeenCalled();
    expect(prisma.entry.deleteMany).not.toHaveBeenCalled();
    expect(activityRows.at(-1)?.event_type).toBe("RECONCILE_GENERATED_ENTRY_REVERTED");
  });

  test("preserves manual matched entries while voiding the active group", async () => {
    const manual = entry({ id: "manual-1", sourceBankTransactionId: null, memo: "Manual expected entry" });
    const { handler, groups, entries } = await loadHandler({
      entries: [manual],
      groupEntries: [{ match_group_id: "mg-1", business_id: "biz-1", account_id: "acct-1", entry_id: "manual-1", matched_amount_cents: 1200n }],
    });

    const previewRes = await handler(getPreviewEvent({ matchGroupId: "mg-1" }));
    const preview = JSON.parse(previewRes.body);
    expect(preview.generated_entries_to_soft_delete).toEqual([]);
    expect(preview.manual_entries_preserved[0]).toEqual(expect.objectContaining({ id: "manual-1" }));

    const res = await handler(postRevertEvent({ matchGroupId: "mg-1" }));
    expect(res.statusCode).toBe(200);
    expect(groups[0].status).toBe("VOIDED");
    expect(entries[0].deleted_at).toBeNull();
  });

  test("blocks generated-entry soft delete when its period is closed", async () => {
    const { handler, entries } = await loadHandler({ closedMonths: ["2026-04"] });

    const res = await handler(postRevertEvent({ matchGroupId: "mg-1", confirmSoftDelete: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("CLOSED_PERIOD");
    expect(entries[0].deleted_at).toBeNull();
  });

  test("is idempotent when the group is already voided and generated entry already deleted", async () => {
    const { handler, prisma } = await loadHandler({
      groups: [group({ status: "VOIDED", voided_at: new Date("2026-04-21T00:00:00.000Z"), voided_by_user_id: "actor" })],
      entries: [entry({ deleted_at: new Date("2026-04-21T00:00:00.000Z") })],
    });

    const res = await handler(postRevertEvent({ matchGroupId: "mg-1", confirmSoftDelete: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.already_reverted).toBe(true);
    expect(body.soft_deleted_entry_ids).toEqual([]);
    expect(prisma.matchGroup.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "VOIDED" }),
    }));
  });

  test("rejects wrong business/account scope before reverting", async () => {
    const { handler, groups, entries } = await loadHandler({ accountOk: false });

    const res = await handler(postRevertEvent({ matchGroupId: "mg-1", confirmSoftDelete: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(404);
    expect(body.error).toBe("Account not found in business");
    expect(groups[0].status).toBe("ACTIVE");
    expect(entries[0].deleted_at).toBeNull();
  });

  test("requires explicit confirmation before generated entries are soft-deleted", async () => {
    const { handler, groups, entries } = await loadHandler({});

    const res = await handler(postRevertEvent({ matchGroupId: "mg-1" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body.code).toBe("CONFIRMATION_REQUIRED");
    expect(groups[0].status).toBe("ACTIVE");
    expect(entries[0].deleted_at).toBeNull();
  });

  test("voided group makes the bank transaction unmatched after revert", async () => {
    const { handler, groups } = await loadHandler({});

    await handler(postRevertEvent({ bankTransactionId: "bank-1", confirmSoftDelete: true }));

    const activeGroupsForBank = groups.filter((g) => g.status === "ACTIVE" && g.id === "mg-1");
    expect(activeGroupsForBank).toEqual([]);
  });

  test("duplicate generated entries are soft-deleted without hard delete", async () => {
    const generatedA = entry({ id: "generated-a" });
    const generatedB = entry({ id: "generated-b", memo: "Duplicate generated entry" });
    const { handler, prisma, entries } = await loadHandler({
      entries: [generatedA, generatedB],
      groupEntries: [
        { match_group_id: "mg-1", business_id: "biz-1", account_id: "acct-1", entry_id: "generated-a", matched_amount_cents: 600n },
        { match_group_id: "mg-1", business_id: "biz-1", account_id: "acct-1", entry_id: "generated-b", matched_amount_cents: 600n },
      ],
    });

    const res = await handler(postRevertEvent({ matchGroupId: "mg-1", confirmSoftDelete: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.soft_deleted_entry_ids.sort()).toEqual(["generated-a", "generated-b"]);
    expect(entries.every((row) => row.deleted_at instanceof Date)).toBe(true);
    expect(prisma.entry.delete).not.toHaveBeenCalled();
    expect(prisma.entry.deleteMany).not.toHaveBeenCalled();
  });
});
