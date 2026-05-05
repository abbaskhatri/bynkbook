import { afterEach, describe, expect, test, vi } from "vitest";

const businessId = "biz-1";
const accountId = "acct-1";
const entryId = "entry-1";

function deleteEvent(overrides: Record<string, any> = {}) {
  const biz = overrides.businessId ?? businessId;
  const acct = overrides.accountId ?? accountId;
  const ent = overrides.entryId ?? entryId;
  return {
    pathParameters: { businessId: biz, accountId: acct, entryId: ent },
    requestContext: {
      authorizer: { jwt: { claims: { sub: overrides.sub ?? "actor" } } },
      http: {
        method: "DELETE",
        path: `/v1/businesses/${biz}/accounts/${acct}/entries/${ent}`,
      },
    },
  };
}

function unmatchAndDeleteEvent(overrides: Record<string, any> = {}, body: Record<string, any> = {}) {
  const event = deleteEvent(overrides);
  const biz = overrides.businessId ?? businessId;
  const acct = overrides.accountId ?? accountId;
  const ent = overrides.entryId ?? entryId;
  event.requestContext.http.method = "POST";
  event.requestContext.http.path = `/v1/businesses/${biz}/accounts/${acct}/entries/${ent}/unmatch-and-delete`;
  return {
    ...event,
    body: JSON.stringify(body),
  };
}

function hardDeleteEvent(overrides: Record<string, any> = {}) {
  const event = deleteEvent(overrides);
  event.requestContext.http.path += "/hard";
  return event;
}

function entry(overrides: Record<string, any> = {}) {
  return {
    id: entryId,
    business_id: businessId,
    account_id: accountId,
    date: new Date("2026-04-20T00:00:00.000Z"),
    deleted_at: null,
    ...overrides,
  };
}

function group(overrides: Record<string, any> = {}) {
  return {
    id: "mg-1",
    business_id: businessId,
    account_id: accountId,
    status: "ACTIVE",
    voided_at: null,
    ...overrides,
  };
}

function groupEntry(overrides: Record<string, any> = {}) {
  return {
    match_group_id: "mg-1",
    business_id: businessId,
    account_id: accountId,
    entry_id: entryId,
    ...overrides,
  };
}

function groupBank(overrides: Record<string, any> = {}) {
  return {
    match_group_id: "mg-1",
    business_id: businessId,
    account_id: accountId,
    bank_transaction_id: "bank-1",
    ...overrides,
  };
}

function bank(overrides: Record<string, any> = {}) {
  return {
    id: "bank-1",
    business_id: businessId,
    account_id: accountId,
    posted_date: new Date("2026-04-20T00:00:00.000Z"),
    name: "Coffee Shop",
    amount_cents: -1200n,
    ...overrides,
  };
}

function project(row: any, select: any) {
  if (!row || !select) return row ? { ...row } : row;
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

function valueMatches(value: any, expected: any): boolean {
  if (expected instanceof Date && value instanceof Date) return expected.getTime() === value.getTime();
  if (expected && typeof expected === "object" && !(expected instanceof Date)) {
    if ("not" in expected) return value !== expected.not;
    if (Array.isArray(expected.in)) return expected.in.includes(value);
  }
  return value === expected;
}

function rowMatchesWhere(row: any, where: any, groups: any[] = []): boolean {
  for (const [key, expected] of Object.entries(where ?? {})) {
    if (key === "matchGroup") {
      const groupRow = groups.find((g) => g.id === row.match_group_id);
      if (!groupRow || !rowMatchesWhere(groupRow, expected, groups)) return false;
      continue;
    }
    if (!valueMatches(row[key], expected)) return false;
  }
  return true;
}

async function loadHandlers(options: {
  entries?: any[];
  groups?: any[];
  groupEntries?: any[];
  groupBanks?: any[];
  banks?: any[];
  closedMonths?: string[];
  role?: string | null;
  accountOk?: boolean;
} = {}) {
  vi.resetModules();

  const entries = [...(options.entries ?? [entry()])];
  const groups = [...(options.groups ?? [])];
  const groupEntries = [...(options.groupEntries ?? [])];
  const groupBanks = [...(options.groupBanks ?? [])];
  const banks = [...(options.banks ?? [])];
  const bankMatchUpdates: any[] = [];

  const prisma: any = {
    userBusinessRole: {
      findFirst: vi.fn(async (args: any) =>
        args?.where?.business_id === businessId && args?.where?.user_id === "actor"
          ? options.role === undefined ? { role: "OWNER" } : options.role ? { role: options.role } : null
          : null
      ),
    },
    account: {
      findFirst: vi.fn(async (args: any) =>
        options.accountOk === false
          ? null
          : args?.where?.business_id === businessId && args?.where?.id === accountId
            ? { id: accountId }
            : null
      ),
    },
    billPaymentApplication: {
      count: vi.fn(async () => 0),
    },
    entry: {
      findFirst: vi.fn(async (args: any) => {
        const found = entries.find((row) => rowMatchesWhere(row, args?.where));
        return project(found, args?.select);
      }),
      updateMany: vi.fn(async (args: any) => {
        let count = 0;
        for (const row of entries) {
          if (!rowMatchesWhere(row, args?.where)) continue;
          Object.assign(row, args?.data ?? {});
          count++;
        }
        return { count };
      }),
      deleteMany: vi.fn(async (args: any) => {
        const before = entries.length;
        for (let i = entries.length - 1; i >= 0; i--) {
          if (rowMatchesWhere(entries[i], args?.where)) entries.splice(i, 1);
        }
        return { count: before - entries.length };
      }),
    },
    matchGroup: {
      findFirst: vi.fn(async (args: any) => {
        const found = groups.find((row) => rowMatchesWhere(row, args?.where));
        return project(found, args?.select);
      }),
      updateMany: vi.fn(async (args: any) => {
        let count = 0;
        for (const row of groups) {
          if (!rowMatchesWhere(row, args?.where)) continue;
          Object.assign(row, args?.data ?? {});
          count++;
        }
        return { count };
      }),
      update: vi.fn(async (args: any) => {
        const found = groups.find((row) => row.id === args?.where?.id);
        if (!found) throw new Error("Match group not found");
        Object.assign(found, args?.data ?? {});
        return project(found, args?.select);
      }),
    },
    matchGroupEntry: {
      findFirst: vi.fn(async (args: any) => {
        const found = groupEntries.find((row) => rowMatchesWhere(row, args?.where, groups));
        return project(found, args?.select);
      }),
      findMany: vi.fn(async (args: any) =>
        groupEntries
          .filter((row) => rowMatchesWhere(row, args?.where, groups))
          .map((row) => project(row, args?.select))
      ),
      count: vi.fn(async (args: any) =>
        groupEntries.filter((row) => rowMatchesWhere(row, args?.where, groups)).length
      ),
    },
    matchGroupBank: {
      findFirst: vi.fn(async (args: any) => {
        const found = groupBanks.find((row) => rowMatchesWhere(row, args?.where, groups));
        return project(found, args?.select);
      }),
      findMany: vi.fn(async (args: any) =>
        groupBanks
          .filter((row) => rowMatchesWhere(row, args?.where, groups))
          .map((row) => project(row, args?.select))
      ),
    },
    bankTransaction: {
      findFirst: vi.fn(async (args: any) => {
        const found = banks.find((row) => rowMatchesWhere(row, args?.where));
        return project(found, args?.select);
      }),
    },
    bankMatch: {
      updateMany: vi.fn(async (args: any) => {
        bankMatchUpdates.push(args);
        return { count: 1 };
      }),
    },
    closedPeriod: {
      findFirst: vi.fn(async (args: any) => {
        const months = options.closedMonths ?? [];
        const month = String(args?.where?.month ?? "");
        return months.includes(month) ? { id: "closed-1", month } : null;
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };

  vi.doMock("./lib/db", () => ({ getPrisma: vi.fn(async () => prisma) }));
  vi.doMock("./lib/activityLog", () => ({ logActivity: vi.fn() }));
  vi.doMock("./lib/authz", () => ({ authorizeWrite: vi.fn(async () => ({ allowed: true })) }));
  vi.doMock("./lib/categoryMemoryWriteback", () => ({ writeCategoryMemoryFeedback: vi.fn() }));
  vi.doMock("./aiCategorySuggestions", () => ({ computeCategorySuggestionsForItems: vi.fn(async () => new Map()) }));
  vi.doMock("./lib/categorySuggestionScoring", () => ({ isBulkSafeCategorySuggestion: vi.fn(() => false) }));

  const entriesMod = await import("./entries");
  const hardDeleteMod = await import("./entryHardDelete");
  return { entriesHandler: entriesMod.handler, hardDeleteHandler: hardDeleteMod.handler, prisma, entries, groups, bankMatchUpdates };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("ledger entry delete match-group safety", () => {
  test("soft-delete active matched entry returns 409 with safe match details", async () => {
    const { entriesHandler, prisma } = await loadHandlers({
      groups: [group()],
      groupEntries: [groupEntry()],
      groupBanks: [groupBank()],
      banks: [bank()],
    });

    const res = await entriesHandler(deleteEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("ENTRY_MATCHED_REQUIRES_UNMATCH");
    expect(body.error).toBe("ENTRY_MATCHED_REQUIRES_UNMATCH");
    expect(body.matchGroupId).toBe("mg-1");
    expect(body.bankTransaction).toEqual({
      id: "bank-1",
      date: "2026-04-20",
      name: "Coffee Shop",
      amount_cents: "-1200",
    });
    expect(prisma.entry.updateMany).not.toHaveBeenCalled();
    expect(prisma.bankMatch.updateMany).not.toHaveBeenCalled();
  });

  test("hard-delete active matched entry returns 409 and does not delete", async () => {
    const { hardDeleteHandler, prisma } = await loadHandlers({
      entries: [entry({ deleted_at: new Date("2026-04-21T00:00:00.000Z") })],
      groups: [group()],
      groupEntries: [groupEntry()],
      groupBanks: [groupBank()],
      banks: [bank()],
    });

    const res = await hardDeleteHandler(hardDeleteEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("ENTRY_MATCHED_REQUIRES_UNMATCH");
    expect(prisma.entry.deleteMany).not.toHaveBeenCalled();
  });

  test("guided unmatch-and-delete soft-deletes entry and voids active group", async () => {
    const { entriesHandler, prisma, entries, groups } = await loadHandlers({
      groups: [group()],
      groupEntries: [groupEntry({ matched_amount_cents: 1200n })],
      groupBanks: [groupBank({ matched_amount_cents: 1200n })],
      banks: [bank()],
    });

    const res = await entriesHandler(
      unmatchAndDeleteEvent({}, { confirmUnmatchAndDelete: true, reason: "User confirmed matched delete" })
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.deleted).toBe(true);
    expect(body.entry_id).toBe(entryId);
    expect(body.match_group_id).toBe("mg-1");
    expect(body.voided_match_group_id).toBe("mg-1");
    expect(body.bank_transaction_unmatched).toBe(true);
    expect(body.bank_transaction).toEqual({
      id: "bank-1",
      date: "2026-04-20",
      name: "Coffee Shop",
      amount_cents: "-1200",
    });
    expect(groups[0].status).toBe("VOIDED");
    expect(groups[0].voided_by_user_id).toBe("actor");
    expect(entries[0].deleted_at).toBeInstanceOf(Date);
    expect(prisma.entry.deleteMany).not.toHaveBeenCalled();
    expect(prisma.bankMatch.updateMany).toHaveBeenCalled();
  });

  test("guided unmatch-and-delete requires explicit confirmation", async () => {
    const { entriesHandler, prisma, groups, entries } = await loadHandlers({
      groups: [group()],
      groupEntries: [groupEntry()],
      groupBanks: [groupBank()],
      banks: [bank()],
    });

    const res = await entriesHandler(unmatchAndDeleteEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body.code).toBe("CONFIRMATION_REQUIRED");
    expect(groups[0].status).toBe("ACTIVE");
    expect(entries[0].deleted_at).toBeNull();
    expect(prisma.matchGroup.updateMany).not.toHaveBeenCalled();
  });

  test("guided unmatch-and-delete rejects hard delete requests", async () => {
    const { entriesHandler, prisma, groups, entries } = await loadHandlers({
      groups: [group()],
      groupEntries: [groupEntry()],
      groupBanks: [groupBank()],
      banks: [bank()],
    });

    const res = await entriesHandler(unmatchAndDeleteEvent({}, { confirmUnmatchAndDelete: true, hardDelete: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body.code).toBe("HARD_DELETE_NOT_ALLOWED");
    expect(groups[0].status).toBe("ACTIVE");
    expect(entries[0].deleted_at).toBeNull();
    expect(prisma.entry.deleteMany).not.toHaveBeenCalled();
  });

  test("guided unmatch-and-delete returns bank transaction to unmatched by voiding the active group", async () => {
    const { entriesHandler, groups } = await loadHandlers({
      groups: [group()],
      groupEntries: [groupEntry()],
      groupBanks: [groupBank()],
      banks: [bank()],
    });

    const res = await entriesHandler(unmatchAndDeleteEvent({}, { confirmUnmatchAndDelete: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.bank_transaction_unmatched).toBe(true);
    expect(groups[0].status).toBe("VOIDED");
    expect(groups[0].voided_at).toBeInstanceOf(Date);
  });

  test("closed period blocks guided unmatch-and-delete before void or delete", async () => {
    const { entriesHandler, prisma, groups, entries } = await loadHandlers({
      closedMonths: ["2026-04"],
      groups: [group()],
      groupEntries: [groupEntry()],
      groupBanks: [groupBank()],
      banks: [bank()],
    });

    const res = await entriesHandler(unmatchAndDeleteEvent({}, { confirmUnmatchAndDelete: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("CLOSED_PERIOD");
    expect(groups[0].status).toBe("ACTIVE");
    expect(entries[0].deleted_at).toBeNull();
    expect(prisma.matchGroup.updateMany).not.toHaveBeenCalled();
    expect(prisma.entry.updateMany).not.toHaveBeenCalled();
  });

  test("wrong business/account cannot run guided unmatch-and-delete", async () => {
    const { entriesHandler, prisma } = await loadHandlers({
      groups: [group()],
      groupEntries: [groupEntry()],
      groupBanks: [groupBank()],
      banks: [bank()],
    });

    const res = await entriesHandler(
      unmatchAndDeleteEvent({ businessId: "biz-other" }, { confirmUnmatchAndDelete: true })
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(403);
    expect(body.code).not.toBe("ENTRY_MATCHED_REQUIRES_UNMATCH");
    expect(prisma.matchGroup.updateMany).not.toHaveBeenCalled();
  });

  test("guided unmatch-and-delete refuses multiple active groups as ambiguous", async () => {
    const { entriesHandler, prisma, entries, groups } = await loadHandlers({
      groups: [group({ id: "mg-1" }), group({ id: "mg-2" })],
      groupEntries: [groupEntry({ match_group_id: "mg-1" }), groupEntry({ match_group_id: "mg-2" })],
      groupBanks: [groupBank({ match_group_id: "mg-1" }), groupBank({ match_group_id: "mg-2" })],
      banks: [bank()],
    });

    const res = await entriesHandler(unmatchAndDeleteEvent({}, { confirmUnmatchAndDelete: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("MATCHED_DELETE_AMBIGUOUS");
    expect(groups.map((g) => g.status)).toEqual(["ACTIVE", "ACTIVE"]);
    expect(entries[0].deleted_at).toBeNull();
    expect(prisma.matchGroup.updateMany).not.toHaveBeenCalled();
  });

  test("guided unmatch-and-delete refuses multi-row match groups as ambiguous", async () => {
    const { entriesHandler, prisma, entries, groups } = await loadHandlers({
      entries: [entry(), entry({ id: "entry-2" })],
      groups: [group()],
      groupEntries: [groupEntry(), groupEntry({ entry_id: "entry-2" })],
      groupBanks: [groupBank()],
      banks: [bank()],
    });

    const res = await entriesHandler(unmatchAndDeleteEvent({}, { confirmUnmatchAndDelete: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("MATCHED_DELETE_AMBIGUOUS");
    expect(groups[0].status).toBe("ACTIVE");
    expect(entries[0].deleted_at).toBeNull();
    expect(prisma.matchGroup.updateMany).not.toHaveBeenCalled();
  });

  test("unmatched entry can still soft-delete and legacy BankMatch rows are voided", async () => {
    const { entriesHandler, prisma } = await loadHandlers();

    const res = await entriesHandler(deleteEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.deleted).toBe(true);
    expect(prisma.bankMatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ business_id: businessId, entry_id: entryId, voided_at: null }),
    }));
    expect(prisma.entry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: entryId, deleted_at: null }),
    }));
  });

  test("voided match group does not block soft delete", async () => {
    const { entriesHandler, prisma } = await loadHandlers({
      groups: [group({ status: "VOIDED", voided_at: new Date("2026-04-21T00:00:00.000Z") })],
      groupEntries: [groupEntry()],
      groupBanks: [groupBank()],
      banks: [bank()],
    });

    const res = await entriesHandler(deleteEvent());

    expect(res.statusCode).toBe(200);
    expect(prisma.entry.updateMany).toHaveBeenCalled();
  });

  test("closed-period protection wins before match safety checks", async () => {
    const { entriesHandler, prisma } = await loadHandlers({
      closedMonths: ["2026-04"],
      groups: [group()],
      groupEntries: [groupEntry()],
      groupBanks: [groupBank()],
      banks: [bank()],
    });

    const res = await entriesHandler(deleteEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("CLOSED_PERIOD");
    expect(prisma.matchGroupEntry.findFirst).not.toHaveBeenCalled();
    expect(prisma.entry.updateMany).not.toHaveBeenCalled();
  });

  test("wrong business/account cannot infer match info", async () => {
    const { entriesHandler, prisma } = await loadHandlers({
      groups: [group()],
      groupEntries: [groupEntry()],
      groupBanks: [groupBank()],
      banks: [bank()],
    });

    const res = await entriesHandler(deleteEvent({ businessId: "biz-other" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(403);
    expect(body.code).not.toBe("ENTRY_MATCHED_REQUIRES_UNMATCH");
    expect(prisma.matchGroupEntry.findFirst).not.toHaveBeenCalled();
  });

  test("unmatched soft-deleted entry can still hard-delete", async () => {
    const { hardDeleteHandler, prisma, entries } = await loadHandlers({
      entries: [entry({ deleted_at: new Date("2026-04-21T00:00:00.000Z") })],
    });

    const res = await hardDeleteHandler(hardDeleteEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.hard_deleted).toBe(true);
    expect(prisma.entry.deleteMany).toHaveBeenCalled();
    expect(entries).toHaveLength(0);
  });
});
