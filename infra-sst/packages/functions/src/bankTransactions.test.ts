import { afterEach, describe, expect, test, vi } from "vitest";

function event(queryStringParameters: Record<string, string>, businessId = "biz-1", accountId = "acct-1") {
  return {
    pathParameters: { businessId, accountId },
    queryStringParameters,
    requestContext: {
      authorizer: { jwt: { claims: { sub: "actor" } } },
      http: {
        method: "GET",
        path: `/v1/businesses/${businessId}/accounts/${accountId}/bank-transactions`,
      },
    },
  };
}

function postCreateEntryEvent(bankTransactionId: string, body: Record<string, any> = {}, businessId = "biz-1", accountId = "acct-1") {
  return {
    pathParameters: { businessId, accountId, bankTransactionId },
    queryStringParameters: {},
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: "actor" } } },
      http: {
        method: "POST",
        path: `/v1/businesses/${businessId}/accounts/${accountId}/bank-transactions/${bankTransactionId}/create-entry`,
      },
    },
  };
}

function postCreateEntriesBatchEvent(body: Record<string, any> = {}, businessId = "biz-1", accountId = "acct-1") {
  return {
    pathParameters: { businessId, accountId },
    queryStringParameters: {},
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: "actor" } } },
      http: {
        method: "POST",
        path: `/v1/businesses/${businessId}/accounts/${accountId}/bank-transactions/create-entries-batch`,
      },
    },
  };
}

function project(row: any, select: any) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

function tx(id: string, posted: string, created: string, overrides: Record<string, any> = {}) {
  return {
    id,
    business_id: "biz-1",
    account_id: "acct-1",
    posted_date: new Date(`${posted}T00:00:00.000Z`),
    created_at: new Date(created),
    name: id,
    amount_cents: -100n,
    is_pending: false,
    iso_currency_code: "USD",
    source: "PLAID",
    source_parser: null,
    source_upload_id: null,
    import_hash: null,
    is_removed: false,
    ...overrides,
  };
}

function entry(id: string, date: string, amountCents: bigint, overrides: Record<string, any> = {}) {
  return {
    id,
    business_id: "biz-1",
    account_id: "acct-1",
    date: new Date(`${date}T00:00:00.000Z`),
    payee: id,
    memo: "",
    amount_cents: amountCents,
    type: amountCents >= 0n ? "INCOME" : "EXPENSE",
    method: "OTHER",
    status: "EXPECTED",
    entry_kind: "GENERAL",
    deleted_at: null,
    is_adjustment: false,
    transfer_id: null,
    sourceBankTransactionId: null,
    created_at: new Date(`${date}T12:00:00.000Z`),
    updated_at: new Date(`${date}T12:00:00.000Z`),
    ...overrides,
  };
}

function matchesScalar(value: any, expected: any) {
  if (expected instanceof Date && value instanceof Date) return value.getTime() === expected.getTime();
  return value === expected;
}

function matchesObjectFilter(value: any, expected: any): boolean {
  if (expected?.in && !expected.in.some((v: any) => matchesScalar(value, v))) return false;
  if (expected?.notIn && expected.notIn.some((v: any) => matchesScalar(value, v))) return false;
  if ("not" in expected && matchesScalar(value, expected.not)) return false;

  if (value instanceof Date) {
    if (expected.gte && value.getTime() < expected.gte.getTime()) return false;
    if (expected.lte && value.getTime() > expected.lte.getTime()) return false;
    if (expected.lt && value.getTime() >= expected.lt.getTime()) return false;
  } else {
    if (expected.gte != null && !(value >= expected.gte)) return false;
    if (expected.lte != null && !(value <= expected.lte)) return false;
    if (expected.lt != null && !(value < expected.lt)) return false;
  }

  return true;
}

function rowMatchesWhere(row: any, where: any): boolean {
  if (!where) return true;

  for (const [key, expected] of Object.entries(where)) {
    if (key === "AND") {
      if (!(expected as any[]).every((clause) => rowMatchesWhere(row, clause))) return false;
      continue;
    }

    if (key === "OR") {
      if (!(expected as any[]).some((clause) => rowMatchesWhere(row, clause))) return false;
      continue;
    }

    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if (!matchesObjectFilter(row[key], expected)) return false;
      continue;
    }

    if (!matchesScalar(row[key], expected)) return false;
  }

  return true;
}

async function loadHandler(options: {
  rows: any[];
  entries?: any[];
  matchGroupBankIds?: string[];
  bankMatchIds?: string[];
  activeGroupIds?: string[];
  bankTransactionsInActiveGroups?: string[];
}) {
  vi.resetModules();

  const entries = [...(options.entries ?? [])];
  const matchGroups: any[] = (options.activeGroupIds ?? []).map((id) => ({
    id,
    business_id: "biz-1",
    account_id: "acct-1",
    status: "ACTIVE",
  }));
  const bankTransactionsInActiveGroups = new Set(options.bankTransactionsInActiveGroups ?? []);

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async (args: any) =>
        args?.where?.business_id === "biz-1" && args?.where?.user_id === "actor" ? { role: "OWNER" } : null
      ),
    },
    account: {
      findFirst: vi.fn(async (args: any) =>
        args?.where?.business_id === "biz-1" && args?.where?.id === "acct-1" ? { id: "acct-1" } : null
      ),
    },
    matchGroupBank: {
      findMany: vi.fn(async (args: any) =>
        (options.matchGroupBankIds ?? []).map((id) => project({ bank_transaction_id: id }, args?.select))
      ),
      findFirst: vi.fn(async (args: any) => {
        const bankId = String(args?.where?.bank_transaction_id ?? "");
        return bankTransactionsInActiveGroups.has(bankId) ? project({ match_group_id: "group-active" }, args?.select) : null;
      }),
      create: vi.fn(async (args: any) => project(args?.data ?? {}, args?.select)),
    },
    bankMatch: {
      findMany: vi.fn(async (args: any) =>
        (options.bankMatchIds ?? []).map((id) => project({ bank_transaction_id: id }, args?.select))
      ),
    },
    matchGroup: {
      findMany: vi.fn(async (args: any) =>
        matchGroups
          .filter((row) => rowMatchesWhere(row, args?.where))
          .map((row) => project(row, args?.select))
      ),
      create: vi.fn(async (args: any) => {
        matchGroups.push(args?.data);
        return project(args?.data ?? {}, args?.select);
      }),
    },
    matchGroupEntry: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: any) => project(args?.data ?? {}, args?.select)),
    },
    entry: {
      findFirst: vi.fn(async (args: any) => {
        const found = entries.find((row) => rowMatchesWhere(row, args?.where));
        return found ? project(found, args?.select) : null;
      }),
      findMany: vi.fn(async (args: any) => {
        const filtered = entries.filter((row) => rowMatchesWhere(row, args?.where));
        return filtered.map((row) => project(row, args?.select));
      }),
      create: vi.fn(async (args: any) => {
        const row = { ...(args?.data ?? {}) };
        entries.push(row);
        return project(row, args?.select);
      }),
    },
    bankTransaction: {
      findFirst: vi.fn(async (args: any) => {
        const found = options.rows.find((row) => rowMatchesWhere(row, args?.where));
        return found ? project(found, args?.select) : null;
      }),
      findMany: vi.fn(async (args: any) => {
        const filtered = options.rows
          .filter((row) => rowMatchesWhere(row, args?.where))
          .sort((a, b) => {
            const postedDiff = b.posted_date.getTime() - a.posted_date.getTime();
            if (postedDiff !== 0) return postedDiff;
            const createdDiff = b.created_at.getTime() - a.created_at.getTime();
            if (createdDiff !== 0) return createdDiff;
            return String(b.id).localeCompare(String(a.id));
          })
          .slice(0, args?.take ?? undefined);

        return filtered.map((row) => project(row, args?.select));
      }),
    },
    $transaction: vi.fn(async (arg: any) => {
      if (typeof arg === "function") return arg(prisma);
      return Promise.all(arg);
    }),
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));
  vi.doMock("./lib/authz", () => ({
    authorizeWrite: vi.fn(async () => ({ allowed: true })),
  }));
  vi.doMock("./lib/closedPeriods", () => ({
    assertNotClosedPeriod: vi.fn(async () => ({ ok: true })),
  }));
  vi.doMock("./lib/activityLog", () => ({
    logActivity: vi.fn(async () => undefined),
  }));
  vi.doMock("./lib/categoryMemoryWriteback", () => ({
    writeCategoryMemoryFeedback: vi.fn(async () => undefined),
  }));

  const mod = await import("./bankTransactions");
  return { handler: mod.handler, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("bank transactions list status and pagination", () => {
  test("status=unmatched returns unmatched rows even when many newer matched rows exist", async () => {
    const matched = Array.from({ length: 501 }, (_x, i) =>
      tx(`m-${String(i).padStart(3, "0")}`, "2026-04-30", `2026-04-30T12:${String(i % 60).padStart(2, "0")}:00.000Z`)
    );
    const unmatched = [
      tx("u-002", "2026-04-26", "2026-04-26T12:00:00.000Z"),
      tx("u-001", "2026-04-25", "2026-04-25T12:00:00.000Z"),
    ];
    const { handler } = await loadHandler({ rows: [...matched, ...unmatched], matchGroupBankIds: matched.map((row) => row.id) });

    const res = await handler(event({ status: "unmatched", limit: "2" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.items.map((row: any) => row.id)).toEqual(["u-002", "u-001"]);
  });

  test("status=matched returns active MatchGroup and legacy BankMatch rows", async () => {
    const rows = [
      tx("matched-group", "2026-04-28", "2026-04-28T12:00:00.000Z"),
      tx("matched-legacy", "2026-04-27", "2026-04-27T12:00:00.000Z"),
      tx("unmatched", "2026-04-29", "2026-04-29T12:00:00.000Z"),
    ];
    const { handler } = await loadHandler({
      rows,
      matchGroupBankIds: ["matched-group"],
      bankMatchIds: ["matched-legacy"],
    });

    const res = await handler(event({ status: "matched", limit: "10" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.items.map((row: any) => row.id)).toEqual(["matched-group", "matched-legacy"]);
  });

  test("status filter is applied before limit", async () => {
    const rows = [
      tx("matched-newest", "2026-04-30", "2026-04-30T12:00:00.000Z"),
      tx("unmatched-older", "2026-04-20", "2026-04-20T12:00:00.000Z"),
    ];
    const { handler } = await loadHandler({ rows, matchGroupBankIds: ["matched-newest"] });

    const res = await handler(event({ status: "unmatched", limit: "1" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.items.map((row: any) => row.id)).toEqual(["unmatched-older"]);
  });

  test("returns nextCursor when more rows exist", async () => {
    const rows = [
      tx("u-003", "2026-04-28", "2026-04-28T12:00:00.000Z"),
      tx("u-002", "2026-04-27", "2026-04-27T12:00:00.000Z"),
      tx("u-001", "2026-04-26", "2026-04-26T12:00:00.000Z"),
    ];
    const { handler } = await loadHandler({ rows });

    const res = await handler(event({ status: "unmatched", limit: "2" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.items.map((row: any) => row.id)).toEqual(["u-003", "u-002"]);
    expect(typeof body.nextCursor).toBe("string");
  });

  test("cursor fetch returns the next page", async () => {
    const rows = [
      tx("u-003", "2026-04-28", "2026-04-28T12:00:00.000Z"),
      tx("u-002", "2026-04-27", "2026-04-27T12:00:00.000Z"),
      tx("u-001", "2026-04-26", "2026-04-26T12:00:00.000Z"),
    ];
    const { handler } = await loadHandler({ rows });

    const first = await handler(event({ status: "unmatched", limit: "2" }));
    const firstBody = JSON.parse(first.body);
    const second = await handler(event({ status: "unmatched", limit: "2", cursor: firstBody.nextCursor }));
    const secondBody = JSON.parse(second.body);

    expect(second.statusCode).toBe(200);
    expect(secondBody.items.map((row: any) => row.id)).toEqual(["u-001"]);
    expect(secondBody.nextCursor).toBeNull();
  });

  test("preserves business and account scoping", async () => {
    const rows = [
      tx("scoped", "2026-04-28", "2026-04-28T12:00:00.000Z"),
      tx("other-account", "2026-04-29", "2026-04-29T12:00:00.000Z", { account_id: "acct-2" }),
      tx("other-business", "2026-04-30", "2026-04-30T12:00:00.000Z", { business_id: "biz-2" }),
    ];
    const { handler, prisma } = await loadHandler({ rows });

    const res = await handler(event({ status: "all", limit: "10" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.items.map((row: any) => row.id)).toEqual(["scoped"]);
    expect(prisma.bankTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          business_id: "biz-1",
          account_id: "acct-1",
          is_removed: false,
        }),
      })
    );
  });
});

describe("bank transaction create-entry duplicate preflight", () => {
  test("blocks when same account/date/amount/similar payee manual entry exists", async () => {
    const rows = [tx("bank-dup", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "SQ COFFEE HOUSE", amount_cents: -1250n })];
    const manual = entry("entry-dup", "2026-04-26", -1250n, { payee: "Coffee House", memo: "Manual expected entry" });
    const { handler, prisma } = await loadHandler({ rows, entries: [manual] });

    const res = await handler(postCreateEntryEvent("bank-dup", { autoMatch: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("POSSIBLE_DUPLICATE_ENTRY");
    expect(body.possible_duplicate_candidates).toEqual([
      expect.objectContaining({ entry_id: "entry-dup", payee: "Coffee House" }),
    ]);
    expect(prisma.entry.create).not.toHaveBeenCalled();
    expect(prisma.matchGroup.create).not.toHaveBeenCalled();
  });

  test("allows create-entry-and-match when no similar entry exists", async () => {
    const rows = [tx("bank-safe", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "SQ COFFEE HOUSE", amount_cents: -1250n })];
    const unrelated = entry("entry-rent", "2026-04-26", -1250n, { payee: "Office rent", memo: "April rent" });
    const { handler, prisma } = await loadHandler({ rows, entries: [unrelated], activeGroupIds: ["group-active"] });

    const res = await handler(postCreateEntryEvent("bank-safe", { autoMatch: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.auto_matched).toBe(true);
    expect(prisma.entry.create).toHaveBeenCalledTimes(1);
    expect(prisma.matchGroup.create).toHaveBeenCalledTimes(1);
  });

  test("bulk create skips duplicate candidates and reports them", async () => {
    const rows = [
      tx("bank-dup", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "SQ COFFEE HOUSE", amount_cents: -1250n }),
      tx("bank-safe", "2026-04-27", "2026-04-27T12:00:00.000Z", { name: "Hardware Store", amount_cents: -4500n }),
    ];
    const manual = entry("entry-dup", "2026-04-25", -1250n, { payee: "Coffee House", memo: "Expected coffee" });
    const { handler, prisma } = await loadHandler({ rows, entries: [manual] });

    const res = await handler(
      postCreateEntriesBatchEvent({
        items: [
          { bank_transaction_id: "bank-dup", autoMatch: true },
          { bank_transaction_id: "bank-safe", autoMatch: true },
        ],
      })
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.results).toEqual([
      expect.objectContaining({
        bank_transaction_id: "bank-dup",
        status: "SKIPPED",
        code: "POSSIBLE_DUPLICATE_ENTRY",
      }),
      expect.objectContaining({
        bank_transaction_id: "bank-safe",
        status: "CREATED",
      }),
    ]);
    expect(prisma.entry.create).toHaveBeenCalledTimes(1);
  });

  test("matched/manual candidate can still block duplicate creation", async () => {
    const rows = [tx("bank-matched-manual", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "ACME SUPPLIES", amount_cents: -3300n })];
    const matchedManual = entry("entry-matched-manual", "2026-04-28", -3300n, {
      payee: "Acme Supplies",
      memo: "Already matched manually",
    });
    const { handler, prisma } = await loadHandler({ rows, entries: [matchedManual], activeGroupIds: ["group-active"] });

    const res = await handler(postCreateEntryEvent("bank-matched-manual", { autoMatch: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("POSSIBLE_DUPLICATE_ENTRY");
    expect(body.possible_duplicate_candidates[0]).toEqual(expect.objectContaining({ entry_id: "entry-matched-manual" }));
    expect(prisma.entry.create).not.toHaveBeenCalled();
  });

  test("deleted and voided entries do not block duplicate creation", async () => {
    const rows = [tx("bank-deleted-safe", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "ACME SUPPLIES", amount_cents: -3300n })];
    const deleted = entry("entry-deleted", "2026-04-26", -3300n, {
      payee: "Acme Supplies",
      deleted_at: new Date("2026-04-27T00:00:00.000Z"),
    });
    const voided = entry("entry-voided", "2026-04-26", -3300n, {
      payee: "Acme Supplies",
      status: "VOIDED",
    });
    const { handler, prisma } = await loadHandler({ rows, entries: [deleted, voided] });

    const res = await handler(postCreateEntryEvent("bank-deleted-safe", { autoMatch: false }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.auto_matched).toBe(false);
    expect(prisma.entry.create).toHaveBeenCalledTimes(1);
  });

  test("business/account scoping is preserved for duplicate candidates", async () => {
    const rows = [tx("bank-scoped-safe", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "ACME SUPPLIES", amount_cents: -3300n })];
    const otherBusiness = entry("entry-other-business", "2026-04-26", -3300n, {
      business_id: "biz-2",
      payee: "Acme Supplies",
    });
    const otherAccount = entry("entry-other-account", "2026-04-26", -3300n, {
      account_id: "acct-2",
      payee: "Acme Supplies",
    });
    const { handler, prisma } = await loadHandler({ rows, entries: [otherBusiness, otherAccount] });

    const res = await handler(postCreateEntryEvent("bank-scoped-safe", { autoMatch: false }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(prisma.entry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          business_id: "biz-1",
          account_id: "acct-1",
        }),
      })
    );
    expect(prisma.entry.create).toHaveBeenCalledTimes(1);
  });
});
