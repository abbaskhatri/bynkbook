import { afterEach, describe, expect, test, vi } from "vitest";

function scanEvent(body: any = {}) {
  return {
    body: JSON.stringify(body),
    pathParameters: { businessId: "biz-1", accountId: "acct-1" },
    requestContext: {
      authorizer: { jwt: { claims: { sub: "user-1" } } },
      http: {
        method: "POST",
        path: "/v1/businesses/biz-1/accounts/acct-1/issues/scan",
      },
    },
  };
}

function entry(id: string, date: string, amount: bigint, overrides: Record<string, any> = {}) {
  return {
    id,
    business_id: "biz-1",
    account_id: "acct-1",
    date: new Date(`${date}T00:00:00.000Z`),
    payee: "Coffee House",
    memo: null,
    amount_cents: amount,
    method: "CARD",
    type: "EXPENSE",
    status: "EXPECTED",
    entry_kind: "GENERAL",
    transfer_id: null,
    is_adjustment: false,
    deleted_at: null,
    category_id: "cat-1",
    account: { type: "CHECKING" },
    sourceBankTransactionId: null,
    ...overrides,
  };
}

async function loadHandler(options: {
  entries: any[];
  matchedEntryIds?: string[];
  sourceBankRows?: any[];
  suppressedDuplicateGroupKeys?: string[];
} = { entries: [] }) {
  vi.resetModules();

  const matchedEntryIds = new Set(options.matchedEntryIds ?? []);
  const sourceBankRows = options.sourceBankRows ?? [];
  const suppressedDuplicateGroupKeys = options.suppressedDuplicateGroupKeys ?? [];

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role: "OWNER" })),
    },
    account: {
      findFirst: vi.fn(async () => ({ id: "acct-1" })),
    },
    entry: {
      findMany: vi.fn(async () => options.entries),
    },
    matchGroupEntry: {
      findMany: vi.fn(async () =>
        options.entries
          .filter((row) => matchedEntryIds.has(String(row.id)))
          .map((row) => ({
            entry_id: row.id,
            match_group_id: `mg-${row.id}`,
          }))
      ),
    },
    matchGroupBank: {
      findMany: vi.fn(async () =>
        options.entries
          .filter((row) => matchedEntryIds.has(String(row.id)))
          .map((row) => ({
            match_group_id: `mg-${row.id}`,
            bank_transaction_id: row.sourceBankTransactionId ?? `bank-${row.id}`,
          }))
      ),
    },
    bankTransaction: {
      findMany: vi.fn(async () => sourceBankRows),
    },
    entryIssue: {
      findMany: vi.fn(async (args: any = {}) => {
        if (args?.where?.group_key?.startsWith === "LEGIT_DUP:") {
          return suppressedDuplicateGroupKeys.map((key) => ({ group_key: `LEGIT_DUP:${key}` }));
        }

        return [];
      }),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: any) => args.data),
      update: vi.fn(async (args: any) => args.data),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  const mod = await import("./issuesScan");
  return { handler: mod.handler, prisma };
}

function createdIssues(prisma: any) {
  return prisma.entryIssue.create.mock.calls.map((call: any[]) => call[0].data);
}

const NEAR_DUPLICATE_COPY = "Potential duplicate: similar payee, same amount, close date. Review before merging or cleanup.";
const BANK_MANUAL_DUPLICATE_COPY =
  "Potential duplicate: bank-imported transaction and manual entry share the same amount and close dates. Review before merging or cleanup.";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("issues scan category requirements", () => {
  test("requires categories for cash book income and expenses", async () => {
    const cashExpense = entry("cash-expense", "2026-07-13", -2500n, {
      category_id: null,
      method: "CASH",
      account: { type: "CASH" },
    });

    const { handler, prisma } = await loadHandler({ entries: [cashExpense] });
    const res = await handler(scanEvent({ includeMissingCategory: true }));

    expect(res.statusCode).toBe(200);
    expect(createdIssues(prisma)).toEqual(expect.arrayContaining([
      expect.objectContaining({ entry_id: "cash-expense", issue_type: "MISSING_CATEGORY" }),
    ]));
  });
});

describe("issues scan duplicate detection", () => {
  test("flags generic imported deposit and manual customer entry with same amount near date", async () => {
    const manual = entry("manual-shop", "2026-05-12", 245900n, {
      payee: "SHOP N BAG",
      memo: "customer deposit",
      method: "CASH",
      type: "INCOME",
    });
    const importedDeposit = entry("bank-deposit", "2026-05-12", 245900n, {
      payee: "BKOFAMERICA MOBILE 05/12 DEPOSIT",
      memo: "Bank-created row",
      method: "OTHER",
      type: "INCOME",
      sourceBankTransactionId: "bank-dep-1",
    });

    const { handler, prisma } = await loadHandler({
      entries: [manual, importedDeposit],
      sourceBankRows: [
        {
          id: "bank-dep-1",
          posted_date: new Date("2026-05-12T00:00:00.000Z"),
          name: "BKOFAMERICA MOBILE 05/12 3837147080 DEPOSIT",
          amount_cents: 245900n,
          is_removed: false,
        },
      ],
    });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);

    const issues = createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE");
    expect(issues.map((row: any) => row.entry_id).sort()).toEqual(["bank-deposit", "manual-shop"]);
    expect(issues.every((row: any) => String(row.group_key).startsWith("BANK_MANUAL_DUP|"))).toBe(true);
    expect(issues.every((row: any) => row.details === BANK_MANUAL_DUPLICATE_COPY)).toBe(true);
  });

  test("does not flag manual customer entry against generic imported deposit with different amount", async () => {
    const manual = entry("manual-shop", "2026-05-12", 245900n, {
      payee: "SHOP N BAG",
      memo: "customer deposit",
      method: "CASH",
      type: "INCOME",
    });
    const importedDeposit = entry("bank-deposit", "2026-05-12", 246000n, {
      payee: "BKOFAMERICA MOBILE 05/12 DEPOSIT",
      memo: "Bank-created row",
      method: "OTHER",
      type: "INCOME",
      sourceBankTransactionId: "bank-dep-1",
    });

    const { handler, prisma } = await loadHandler({
      entries: [manual, importedDeposit],
      sourceBankRows: [
        {
          id: "bank-dep-1",
          posted_date: new Date("2026-05-12T00:00:00.000Z"),
          name: "BKOFAMERICA MOBILE 05/12 3837147080 DEPOSIT",
          amount_cents: 246000n,
          is_removed: false,
        },
      ],
    });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);
    expect(createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE")).toEqual([]);
  });

  test("flags manual and bank-generated matched entries with same amount near date and similar payee", async () => {
    const manual = entry("manual-1", "2026-04-26", -1250n, {
      payee: "Coffee House",
      memo: "Manual expected entry",
      method: "CARD",
    });
    const generated = entry("generated-1", "2026-04-27", -1250n, {
      payee: "SQ *COFFEE HOUSE 1234",
      memo: "Bank-created row",
      method: "OTHER",
      sourceBankTransactionId: "bank-1",
    });

    const { handler, prisma } = await loadHandler({
      entries: [manual, generated],
      matchedEntryIds: ["generated-1"],
      sourceBankRows: [
        {
          id: "bank-1",
          posted_date: new Date("2026-04-27T00:00:00.000Z"),
          name: "SQ COFFEE HOUSE",
          amount_cents: -1250n,
          is_removed: false,
        },
      ],
    });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);

    const issues = createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE");
    expect(issues.map((row: any) => row.entry_id).sort()).toEqual(["generated-1", "manual-1"]);
    expect(issues.every((row: any) => String(row.group_key).startsWith("NEAR_DUP|"))).toBe(true);
    expect(issues[0].details).toBe(NEAR_DUPLICATE_COPY);
    expect(issues[0].details.toLowerCase()).not.toContain("delete this");
  });

  test("does not exclude a matched entry when source bank id is only available through match group evidence", async () => {
    const manual = entry("manual-1", "2026-04-26", -3300n, {
      payee: "Acme Supplies",
      memo: "manual expected",
      method: "ACH",
    });
    const matched = entry("matched-1", "2026-04-28", -3300n, {
      payee: "ACME SUPPLIES",
      memo: "already matched",
      method: "OTHER",
    });

    const { handler, prisma } = await loadHandler({
      entries: [manual, matched],
      matchedEntryIds: ["matched-1"],
      sourceBankRows: [
        {
          id: "bank-matched-1",
          posted_date: new Date("2026-04-28T00:00:00.000Z"),
          name: "ACME SUPPLIES",
          amount_cents: -3300n,
          is_removed: false,
        },
      ],
    });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);

    const issues = createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE");
    expect(issues.map((row: any) => row.entry_id).sort()).toEqual(["manual-1", "matched-1"]);
  });

  test("flags exact matched bank replays even when the duplicate bank rows have different ids", async () => {
    const bankName = 'Zelle payment to Abigail Flo Emp for "Payroll"; Conf# cbhs5l8ja';
    const rows = [
      entry("replay-a", "2026-07-09", -57336n, {
        payee: bankName,
        memo: "Bank-created row",
        method: "ZELLE",
        sourceBankTransactionId: "bank-replay-a",
      }),
      entry("replay-b", "2026-07-09", -57336n, {
        payee: bankName,
        memo: "Bank-created row",
        method: "ZELLE",
        sourceBankTransactionId: "bank-replay-b",
      }),
    ];

    const { handler, prisma } = await loadHandler({
      entries: rows,
      matchedEntryIds: ["replay-a", "replay-b"],
      sourceBankRows: [
        { id: "bank-replay-a", posted_date: new Date("2026-07-09T00:00:00.000Z"), name: bankName, amount_cents: -57336n, is_removed: false },
        { id: "bank-replay-b", posted_date: new Date("2026-07-09T00:00:00.000Z"), name: bankName, amount_cents: -57336n, is_removed: false },
      ],
    });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);

    const issues = createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE");
    expect(issues.map((row: any) => row.entry_id).sort()).toEqual(["replay-a", "replay-b"]);
  });

  test("does not flag distinct matched bank events with different full descriptions", async () => {
    const rows = [
      entry("zelle-a", "2026-07-09", -57336n, {
        payee: "Zelle payment to Abigail Flo Emp; Conf# first123",
        method: "ZELLE",
        sourceBankTransactionId: "bank-zelle-a",
      }),
      entry("zelle-b", "2026-07-09", -57336n, {
        payee: "Zelle payment to Abigail Flo Emp; Conf# second456",
        method: "ZELLE",
        sourceBankTransactionId: "bank-zelle-b",
      }),
    ];

    const { handler, prisma } = await loadHandler({
      entries: rows,
      matchedEntryIds: ["zelle-a", "zelle-b"],
      sourceBankRows: [
        { id: "bank-zelle-a", posted_date: new Date("2026-07-09T00:00:00.000Z"), name: rows[0].payee, amount_cents: -57336n, is_removed: false },
        { id: "bank-zelle-b", posted_date: new Date("2026-07-09T00:00:00.000Z"), name: rows[1].payee, amount_cents: -57336n, is_removed: false },
      ],
    });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);
    expect(createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE")).toEqual([]);
  });

  test("flags ordinary near duplicate unity ez llc and unity rows", async () => {
    const rows = [
      entry("unity-ez", "2026-04-26", -48000n, { payee: "unity ez llc", method: "ACH" }),
      entry("unity", "2026-04-28", -48000n, { payee: "unity", method: "ACH" }),
    ];

    const { handler, prisma } = await loadHandler({ entries: rows });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);

    const issues = createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE");
    expect(issues.map((row: any) => row.entry_id).sort()).toEqual(["unity", "unity-ez"]);
    expect(issues.every((row: any) => String(row.group_key).startsWith("NEAR_DUP|"))).toBe(true);
    expect(issues.every((row: any) => row.details === NEAR_DUPLICATE_COPY)).toBe(true);
  });

  test("flags ordinary near duplicate business suffix rows", async () => {
    const rows = [
      entry("abc-llc", "2026-04-26", -9000n, { payee: "ABC LLC", method: "CARD" }),
      entry("abc", "2026-04-27", -9000n, { payee: "ABC", method: "CARD" }),
    ];

    const { handler, prisma } = await loadHandler({ entries: rows });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);

    const issues = createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE");
    expect(issues.map((row: any) => row.entry_id).sort()).toEqual(["abc", "abc-llc"]);
    expect(issues.every((row: any) => row.details === NEAR_DUPLICATE_COPY)).toBe(true);
  });

  test("excludes transfer adjustment opening and deleted rows from duplicate scan", async () => {
    const rows = [
      entry("transfer-1", "2026-04-26", -1200n, { payee: "Acme Supplies", type: "TRANSFER", transfer_id: "transfer-1" }),
      entry("transfer-2", "2026-04-26", -1200n, { payee: "Acme Supplies", type: "TRANSFER", transfer_id: "transfer-1" }),
      entry("adjustment-1", "2026-04-26", -1200n, { payee: "Acme Supplies", type: "ADJUSTMENT", is_adjustment: true }),
      entry("adjustment-2", "2026-04-26", -1200n, { payee: "Acme Supplies", type: "ADJUSTMENT", is_adjustment: true }),
      entry("opening-1", "2026-04-26", 1200n, { payee: "Opening Balance", type: "OPENING" }),
      entry("opening-2", "2026-04-26", 1200n, { payee: "Opening Balance (estimated)", type: "OPENING" }),
      entry("deleted-1", "2026-04-26", -1200n, { payee: "Acme Supplies", deleted_at: new Date("2026-04-27T00:00:00.000Z") }),
      entry("deleted-2", "2026-04-26", -1200n, { payee: "Acme Supplies", deleted_at: new Date("2026-04-27T00:00:00.000Z") }),
    ];

    const { handler, prisma } = await loadHandler({ entries: rows });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);
    expect(createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE")).toEqual([]);
  });

  test("excludes deleted and voided rows from near duplicate scan", async () => {
    const rows = [
      entry("deleted-unity-ez", "2026-04-26", -48000n, {
        payee: "Unity EZ LLC",
        deleted_at: new Date("2026-04-27T00:00:00.000Z"),
      }),
      entry("live-unity", "2026-04-27", -48000n, { payee: "Unity" }),
      entry("voided-abc-llc", "2026-04-26", -9000n, { payee: "ABC LLC", status: "VOIDED" }),
      entry("live-abc", "2026-04-27", -9000n, { payee: "ABC" }),
    ];

    const { handler, prisma } = await loadHandler({ entries: rows });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);
    expect(createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE")).toEqual([]);
  });

  test("does not flag recurring same-vendor payments across distant dates", async () => {
    const rows = [
      entry("rent-april", "2026-04-01", -250000n, { payee: "Office Rent", method: "ACH" }),
      entry("rent-may", "2026-05-01", -250000n, { payee: "Office Rent", method: "ACH" }),
    ];

    const { handler, prisma } = await loadHandler({ entries: rows });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);
    expect(createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE")).toEqual([]);
  });

  test("does not flag same near payee with different amount", async () => {
    const rows = [
      entry("unity-ez", "2026-04-26", -48000n, { payee: "Unity EZ LLC", method: "ACH" }),
      entry("unity", "2026-04-27", -49000n, { payee: "Unity", method: "ACH" }),
    ];

    const { handler, prisma } = await loadHandler({ entries: rows });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);
    expect(createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE")).toEqual([]);
  });

  test("does not flag generic deposit rows with same amount and date", async () => {
    const rows = [
      entry("deposit-a", "2026-04-26", 120000n, { payee: "Deposit", memo: "deposit", method: "ACH", type: "INCOME" }),
      entry("deposit-b", "2026-04-26", 120000n, { payee: "Deposit", memo: "deposit", method: "ACH", type: "INCOME" }),
    ];

    const { handler, prisma } = await loadHandler({ entries: rows });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);
    expect(createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE")).toEqual([]);
  });

  test("does not flag near payee rows with opposite direction", async () => {
    const rows = [
      entry("unity-expense", "2026-04-26", -48000n, { payee: "Unity EZ LLC", method: "ACH", type: "EXPENSE" }),
      entry("unity-income", "2026-04-27", 48000n, { payee: "Unity", method: "ACH", type: "INCOME" }),
    ];

    const { handler, prisma } = await loadHandler({ entries: rows });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);
    expect(createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE")).toEqual([]);
  });

  test("does not flag unrelated payees with same amount and date", async () => {
    const rows = [
      entry("unity", "2026-04-26", -48000n, { payee: "Unity", method: "ACH" }),
      entry("acme", "2026-04-26", -48000n, { payee: "Acme Supplies", method: "ACH" }),
    ];

    const { handler, prisma } = await loadHandler({ entries: rows });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);
    expect(createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE")).toEqual([]);
  });

  test("LEGIT_DUP suppression prevents re-surfacing the same near duplicate group", async () => {
    const rows = [
      entry("unity-ez", "2026-04-26", -48000n, { payee: "unity ez llc", method: "ACH" }),
      entry("unity", "2026-04-28", -48000n, { payee: "unity", method: "ACH" }),
    ];

    const first = await loadHandler({ entries: rows });
    const firstRes = await first.handler(scanEvent({ includeMissingCategory: false }));
    expect(firstRes.statusCode).toBe(200);

    const groupKey = createdIssues(first.prisma).find((row: any) => row.issue_type === "DUPLICATE")?.group_key;
    expect(String(groupKey)).toMatch(/^NEAR_DUP\|/);

    const second = await loadHandler({
      entries: rows,
      suppressedDuplicateGroupKeys: [String(groupKey)],
    });

    const secondRes = await second.handler(scanEvent({ includeMissingCategory: false }));
    expect(secondRes.statusCode).toBe(200);
    expect(createdIssues(second.prisma).filter((row: any) => row.issue_type === "DUPLICATE")).toEqual([]);
  });

  test("preserves ordinary unmatched duplicate behavior", async () => {
    const rows = [
      entry("manual-a", "2026-04-26", -4500n, { payee: "Hardware Store", method: "CARD" }),
      entry("manual-b", "2026-04-28", -4500n, { payee: "Hardware Store", method: "CARD" }),
    ];

    const { handler, prisma } = await loadHandler({ entries: rows });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);

    const issues = createdIssues(prisma).filter((row: any) => row.issue_type === "DUPLICATE");
    expect(issues.map((row: any) => row.entry_id).sort()).toEqual(["manual-a", "manual-b"]);
    expect(issues[0].details).toBe("Potential duplicate (within 7 days)");
  });
});

describe("issues scan stale-check detection", () => {
  // A very old check date so the >45-day stale window always trips regardless
  // of when the test runs (todayYmd uses the real clock).
  const OLD_CHECK_DATE = "2020-01-01";

  test("flags an old, unreconciled check as stale", async () => {
    const check = entry("check-1", OLD_CHECK_DATE, -10000n, {
      payee: "Plumber LLC",
      method: "CHECK",
    });

    const { handler, prisma } = await loadHandler({ entries: [check] });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);

    const stale = createdIssues(prisma).filter((row: any) => row.issue_type === "STALE_CHECK");
    expect(stale.map((row: any) => row.entry_id)).toEqual(["check-1"]);
  });

  test("does NOT flag an old check that is matched to a bank transaction", async () => {
    const check = entry("check-matched", OLD_CHECK_DATE, -10000n, {
      payee: "Plumber LLC",
      method: "CHECK",
    });

    const { handler, prisma } = await loadHandler({
      entries: [check],
      matchedEntryIds: ["check-matched"],
    });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);

    const stale = createdIssues(prisma).filter((row: any) => row.issue_type === "STALE_CHECK");
    expect(stale).toEqual([]);
  });

  test("does NOT flag an old check created from a bank transaction (sourceBankTransactionId)", async () => {
    const check = entry("check-bank-sourced", OLD_CHECK_DATE, -10000n, {
      payee: "Plumber LLC",
      method: "CHECK",
      sourceBankTransactionId: "bank-99",
    });

    const { handler, prisma } = await loadHandler({
      entries: [check],
      sourceBankRows: [
        {
          id: "bank-99",
          posted_date: new Date(`${OLD_CHECK_DATE}T00:00:00.000Z`),
          name: "CHECK 1234",
          amount_cents: -10000n,
          is_removed: false,
        },
      ],
    });

    const res = await handler(scanEvent({ includeMissingCategory: false }));
    expect(res.statusCode).toBe(200);

    const stale = createdIssues(prisma).filter((row: any) => row.issue_type === "STALE_CHECK");
    expect(stale).toEqual([]);
  });
});
