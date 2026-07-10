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

function postCleanupPlaidOverlapEvent(businessId = "biz-1", accountId = "acct-1") {
  return {
    pathParameters: { businessId, accountId },
    queryStringParameters: {},
    body: "{}",
    requestContext: {
      authorizer: { jwt: { claims: { sub: "actor" } } },
      http: {
        method: "POST",
        path: `/v1/businesses/${businessId}/accounts/${accountId}/bank-transactions/cleanup-plaid-overlap`,
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
  closedPeriodOk?: boolean;
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
      count: vi.fn(async (args: any) =>
        options.rows.filter((row) => rowMatchesWhere(row, args?.where)).length
      ),
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
      updateMany: vi.fn(async (args: any) => {
        let count = 0;
        for (const row of options.rows) {
          if (!rowMatchesWhere(row, args?.where)) continue;
          Object.assign(row, args?.data ?? {});
          count += 1;
        }
        return { count };
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
    assertNotClosedPeriod: vi.fn(async () =>
      options.closedPeriodOk === false
        ? {
            ok: false,
            response: {
              statusCode: 409,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ok: false, code: "CLOSED_PERIOD", error: "This period is closed. Reopen period to modify." }),
            },
          }
        : { ok: true }
    ),
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

  test("status=unmatched excludes zero-amount transactions (fee waivers) from list and count", async () => {
    const rows = [
      tx("real-1", "2026-05-10", "2026-05-10T12:00:00.000Z", { amount_cents: -2500n }),
      tx("zero-1", "2026-05-18", "2026-05-18T12:00:00.000Z", { amount_cents: 0n, name: "Fee Waiver" }),
      tx("zero-2", "2026-05-19", "2026-05-19T12:00:00.000Z", { amount_cents: 0n, name: "Fee Waiver" }),
    ];
    const { handler } = await loadHandler({ rows, matchGroupBankIds: [] });

    const unmatched = JSON.parse((await handler(event({ status: "unmatched", limit: "50" }))).body);
    expect(unmatched.items.map((row: any) => row.id)).toEqual(["real-1"]);
    expect(unmatched.totalCount).toBe(1);

    // Zero-amount rows are still visible under the "All" tab.
    const all = JSON.parse((await handler(event({ status: "all", limit: "50" }))).body);
    expect(all.items.map((row: any) => row.id).sort()).toEqual(["real-1", "zero-1", "zero-2"]);
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

  test("list exposes sanitized check_number without raw bank payload", async () => {
    const rows = [
      tx("check-row", "2026-04-28", "2026-04-28T12:00:00.000Z", {
        name: "CHECK PAID",
        raw: { check_number: "001234", original_description: "CHECK PAID TRACE 999999999" },
      }),
    ];
    const { handler } = await loadHandler({ rows });

    const res = await handler(event({ status: "all", limit: "10" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.items[0]).toEqual(
      expect.objectContaining({
        id: "check-row",
        check_number: "001234",
      })
    );
    expect(body.items[0].raw).toBeUndefined();
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

  test("cleanup-plaid-overlap soft-removes only unmatched Plaid rows through uploaded bank history", async () => {
    const rows = [
      tx("csv-latest", "2026-04-30", "2026-04-30T12:00:00.000Z", {
        source: "CSV",
        plaid_transaction_id: null,
      }),
      tx("plaid-old-unmatched", "2026-04-01", "2026-07-10T20:12:00.000Z", {
        source: "PLAID",
        plaid_transaction_id: "plaid-old-unmatched",
      }),
      tx("plaid-old-matched", "2026-04-02", "2026-07-10T20:12:01.000Z", {
        source: "PLAID",
        plaid_transaction_id: "plaid-old-matched",
      }),
      tx("plaid-new", "2026-05-01", "2026-07-10T20:12:02.000Z", {
        source: "PLAID",
        plaid_transaction_id: "plaid-new",
      }),
    ];
    const { handler, prisma } = await loadHandler({
      rows,
      matchGroupBankIds: ["plaid-old-matched"],
    });

    const res = await handler(postCleanupPlaidOverlapEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.removedCount).toBe(1);
    expect(body.throughDate).toBe("2026-04-30");
    expect(rows.find((row) => row.id === "plaid-old-unmatched")?.is_removed).toBe(true);
    expect(rows.find((row) => row.id === "plaid-old-matched")?.is_removed).toBe(false);
    expect(rows.find((row) => row.id === "plaid-new")?.is_removed).toBe(false);
    expect(prisma.bankTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          plaid_transaction_id: { not: null },
          posted_date: { lte: new Date("2026-04-30T00:00:00.000Z") },
          id: { notIn: ["plaid-old-matched"] },
        }),
      })
    );
  });
});

describe("bank transaction create-entry duplicate preflight", () => {
  test("blocks generic imported deposit when same amount manual customer entry exists nearby", async () => {
    const rows = [
      tx("bank-generic-deposit", "2026-05-12", "2026-05-12T12:00:00.000Z", {
        name: "BKOFAMERICA MOBILE 05/12 3837147080 DEPOSIT",
        amount_cents: 245900n,
      }),
    ];
    const manual = entry("entry-shop", "2026-05-10", 245900n, {
      payee: "SHOP N BAG",
      memo: "customer deposit",
      type: "INCOME",
    });
    const { handler, prisma } = await loadHandler({ rows, entries: [manual] });

    const res = await handler(postCreateEntryEvent("bank-generic-deposit", { autoMatch: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("POSSIBLE_DUPLICATE_ENTRY");
    expect(body.possible_duplicate_candidates).toEqual([
      expect.objectContaining({
        entry_id: "entry-shop",
        payee: "SHOP N BAG",
        duplicate_reason: "generic_bank_manual_same_amount",
        duplicate_confidence: "high",
        date_distance_days: 2,
      }),
    ]);
    expect(prisma.entry.create).not.toHaveBeenCalled();
    expect(prisma.matchGroup.create).not.toHaveBeenCalled();
  });

  test("does not block generic imported deposit when nearby manual entry has different amount", async () => {
    const rows = [
      tx("bank-generic-safe", "2026-05-12", "2026-05-12T12:00:00.000Z", {
        name: "BKOFAMERICA MOBILE 05/12 3837147080 DEPOSIT",
        amount_cents: 245900n,
      }),
    ];
    const manual = entry("entry-shop-different", "2026-05-10", 246000n, {
      payee: "SHOP N BAG",
      memo: "customer deposit",
      type: "INCOME",
    });
    const { handler, prisma } = await loadHandler({ rows, entries: [manual] });

    const res = await handler(postCreateEntryEvent("bank-generic-safe", { autoMatch: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(prisma.entry.create).toHaveBeenCalledTimes(1);
    expect(prisma.matchGroup.create).toHaveBeenCalledTimes(1);
  });

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

  test("blocks check-number duplicate even when bank description is generic", async () => {
    const rows = [
      tx("bank-check-dup", "2026-04-26", "2026-04-26T12:00:00.000Z", {
        name: "CHECK PAID",
        amount_cents: -5000n,
        raw: { check_number: "001234" },
      }),
    ];
    const manual = entry("entry-check-dup", "2026-04-25", -5000n, {
      payee: "Rent",
      memo: "Ref: 1234",
    });
    const { handler, prisma } = await loadHandler({ rows, entries: [manual] });

    const res = await handler(postCreateEntryEvent("bank-check-dup", { autoMatch: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("POSSIBLE_DUPLICATE_ENTRY");
    expect(body.possible_duplicate_candidates).toEqual([
      expect.objectContaining({
        entry_id: "entry-check-dup",
        duplicate_reason: "matching_check_number",
        duplicate_confidence: "high",
      }),
    ]);
    expect(prisma.entry.create).not.toHaveBeenCalled();
    expect(prisma.matchGroup.create).not.toHaveBeenCalled();
  });

  test("creates possible duplicate only with explicit single-row override", async () => {
    const rows = [tx("bank-dup-override", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "SQ COFFEE HOUSE", amount_cents: -1250n })];
    const manual = entry("entry-dup-override", "2026-04-26", -1250n, { payee: "Coffee House", memo: "Manual expected entry" });
    const { handler, prisma } = await loadHandler({ rows, entries: [manual] });

    const res = await handler(postCreateEntryEvent("bank-dup-override", { autoMatch: true, allowPossibleDuplicate: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.duplicate_warning_overridden).toBe(true);
    expect(prisma.entry.create).toHaveBeenCalledTimes(1);
    expect(prisma.matchGroup.create).toHaveBeenCalledTimes(1);
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

  test("create-entry-and-match rejects a bank transaction that becomes matched before transaction create", async () => {
    const rows = [tx("bank-stale-match", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "Hardware Store", amount_cents: -4500n })];
    const { handler, prisma } = await loadHandler({
      rows,
      activeGroupIds: ["group-active"],
      bankTransactionsInActiveGroups: ["bank-stale-match"],
    });
    prisma.matchGroup.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "group-active" }]);

    const res = await handler(postCreateEntryEvent("bank-stale-match", { autoMatch: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("ALREADY_IN_GROUP");
    expect(body.error).toBe("Bank transaction is already matched.");
    expect(prisma.entry.create).not.toHaveBeenCalled();
    expect(prisma.matchGroup.create).not.toHaveBeenCalled();
  });

  test("existing generated entry cannot be auto-matched when stale bank match state appears", async () => {
    const rows = [tx("bank-existing-stale", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "Hardware Store", amount_cents: -4500n })];
    const generated = entry("entry-existing-stale", "2026-04-26", -4500n, {
      payee: "Hardware Store",
      sourceBankTransactionId: "bank-existing-stale",
    });
    const { handler, prisma } = await loadHandler({
      rows,
      entries: [generated],
      activeGroupIds: ["group-active"],
      bankTransactionsInActiveGroups: ["bank-existing-stale"],
    });
    prisma.matchGroup.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "group-active" }]);

    const res = await handler(postCreateEntryEvent("bank-existing-stale", { autoMatch: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("ALREADY_IN_GROUP");
    expect(prisma.entry.create).not.toHaveBeenCalled();
    expect(prisma.matchGroup.create).not.toHaveBeenCalled();
  });

  test("create-entry reports an existing source-bank entry found during transaction without duplicating it", async () => {
    const rows = [tx("bank-concurrent-entry", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "Hardware Store", amount_cents: -4500n })];
    const { handler, prisma } = await loadHandler({ rows });
    prisma.entry.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "entry-concurrent" });

    const res = await handler(postCreateEntryEvent("bank-concurrent-entry", { autoMatch: false }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.entry_id).toBe("entry-concurrent");
    expect(body.auto_matched).toBe(false);
    expect(prisma.entry.create).not.toHaveBeenCalled();
    expect(prisma.matchGroup.create).not.toHaveBeenCalled();
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

  test("bulk create ignores possible duplicate override flags", async () => {
    const rows = [
      tx("bank-bulk-dup-override", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "SQ COFFEE HOUSE", amount_cents: -1250n }),
    ];
    const manual = entry("entry-bulk-dup-override", "2026-04-26", -1250n, { payee: "Coffee House", memo: "Expected coffee" });
    const { handler, prisma } = await loadHandler({ rows, entries: [manual] });

    const res = await handler(
      postCreateEntriesBatchEvent({
        items: [
          { bank_transaction_id: "bank-bulk-dup-override", autoMatch: true, allowPossibleDuplicate: true },
        ],
      })
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.results[0]).toEqual(
      expect.objectContaining({
        bank_transaction_id: "bank-bulk-dup-override",
        status: "SKIPPED",
        code: "POSSIBLE_DUPLICATE_ENTRY",
      })
    );
    expect(prisma.entry.create).not.toHaveBeenCalled();
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

  test("closed period still blocks duplicate override", async () => {
    const rows = [tx("bank-closed-override", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "SQ COFFEE HOUSE", amount_cents: -1250n })];
    const manual = entry("entry-closed-override", "2026-04-26", -1250n, { payee: "Coffee House" });
    const { handler, prisma } = await loadHandler({ rows, entries: [manual], closedPeriodOk: false });

    const res = await handler(postCreateEntryEvent("bank-closed-override", { autoMatch: true, allowPossibleDuplicate: true }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("CLOSED_PERIOD");
    expect(prisma.entry.create).not.toHaveBeenCalled();
  });
});

describe("bank transaction create-entry check reference extraction", () => {
  test("stores a conservative check number as Ref in memo when creating from bank transaction", async () => {
    const rows = [
      tx("bank-check-ref", "2026-04-26", "2026-04-26T12:00:00.000Z", {
        name: "CHECK #1234",
        amount_cents: -2500n,
      }),
    ];
    const { handler, prisma } = await loadHandler({ rows });

    const res = await handler(postCreateEntryEvent("bank-check-ref", { autoMatch: false }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(prisma.entry.create).toHaveBeenCalledTimes(1);
    expect(prisma.entry.create.mock.calls[0][0].data.memo).toContain("Ref: 1234");
  });

  test("prefers explicit Plaid raw check_number and avoids random long ids", async () => {
    const rows = [
      tx("bank-check-raw", "2026-04-26", "2026-04-26T12:00:00.000Z", {
        name: "ACH TRACE 123456789012345",
        amount_cents: -2500n,
        raw: { check_number: "4321", original_description: "ACH TRACE 123456789012345" },
      }),
      tx("bank-ach-long-id", "2026-04-27", "2026-04-27T12:00:00.000Z", {
        name: "ACH TRACE 123456789012345",
        amount_cents: -2600n,
        raw: { original_description: "ACH TRACE 123456789012345" },
      }),
    ];
    const { handler, prisma } = await loadHandler({ rows });

    const explicit = await handler(postCreateEntryEvent("bank-check-raw", { autoMatch: false }));
    const longId = await handler(postCreateEntryEvent("bank-ach-long-id", { autoMatch: false }));

    expect(explicit.statusCode).toBe(201);
    expect(longId.statusCode).toBe(201);
    expect(prisma.entry.create.mock.calls[0][0].data.memo).toContain("Ref: 4321");
    expect(prisma.entry.create.mock.calls[1][0].data.memo).not.toContain("Ref:");
  });
});

describe("bank transaction create-entry method inference", () => {
  test("infers Zelle, Wire, ACH, Check, and Transfer methods when no override is provided", async () => {
    const rows = [
      tx("bank-zelle", "2026-04-26", "2026-04-26T12:00:00.000Z", { name: "ZELLE PAYMENT FROM CUSTOMER" }),
      tx("bank-wire", "2026-04-27", "2026-04-27T12:00:00.000Z", { name: "WIRE TYPE CREDIT" }),
      tx("bank-ach", "2026-04-28", "2026-04-28T12:00:00.000Z", { name: "ACH DEBIT VENDOR" }),
      tx("bank-check", "2026-04-29", "2026-04-29T12:00:00.000Z", { name: "CHK 1042" }),
      tx("bank-transfer", "2026-04-30", "2026-04-30T12:00:00.000Z", { name: "Online Transfer" }),
      tx("bank-bankcard", "2026-05-01", "2026-05-01T12:00:00.000Z", { name: "BANKCARD DEPOSIT" }),
      tx("bank-mobile-deposit", "2026-05-02", "2026-05-02T12:00:00.000Z", { name: "BKOFAMERICA MOBILE 05/02 DEPOSIT" }),
      tx("bank-preencoded", "2026-05-03", "2026-05-03T12:00:00.000Z", { name: "Preencoded Deposit" }),
      tx("bank-direct-deposit", "2026-05-04", "2026-05-04T12:00:00.000Z", { name: "DIRECT DEPOSIT PAYROLL" }),
    ];
    const { handler, prisma } = await loadHandler({ rows });

    for (const row of rows) {
      const res = await handler(postCreateEntryEvent(row.id, { autoMatch: false }));
      expect(res.statusCode).toBe(201);
    }

    const methods = prisma.entry.create.mock.calls.map((call: any) => call[0].data.method);
    expect(methods).toEqual([
      "ZELLE",
      "WIRE",
      "ACH",
      "CHECK",
      "TRANSFER",
      "CARD",
      "CHECK",
      "CHECK",
      "DIRECT_DEPOSIT",
    ]);
  });

  test("uses inferred method when UI sends default OTHER", async () => {
    const rows = [
      tx("bank-default-other", "2026-04-26", "2026-04-26T12:00:00.000Z", {
        name: "BANKCARD DEPOSIT",
      }),
    ];
    const { handler, prisma } = await loadHandler({ rows });

    const res = await handler(postCreateEntryEvent("bank-default-other", { autoMatch: false, method: "OTHER" }));

    expect(res.statusCode).toBe(201);
    expect(prisma.entry.create.mock.calls[0][0].data.method).toBe("CARD");
  });

  test("preserves explicit method override over inferred bank text", async () => {
    const rows = [
      tx("bank-zelle-override", "2026-04-26", "2026-04-26T12:00:00.000Z", {
        name: "ZELLE PAYMENT FROM CUSTOMER",
      }),
    ];
    const { handler, prisma } = await loadHandler({ rows });

    const res = await handler(postCreateEntryEvent("bank-zelle-override", { autoMatch: false, method: "CARD" }));

    expect(res.statusCode).toBe(201);
    expect(prisma.entry.create.mock.calls[0][0].data.method).toBe("CARD");
  });
});
