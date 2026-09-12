import { afterEach, describe, expect, test, vi } from "vitest";

// Evaluate the numeric and logical subset of Prisma filters against real amounts.
function matches(where: any, cents: bigint): boolean {
  if (where.AND && !where.AND.every((child: any) => matches(child, cents))) return false;
  if (where.OR && !where.OR.some((child: any) => matches(child, cents))) return false;
  const amount = where.amount_cents;
  return !amount || ((amount.gt === undefined || cents > amount.gt) && (amount.lt === undefined || cents < amount.lt));
}

async function load(role: string | null = "OWNER") {
  vi.resetModules();
  const amounts = [-80000n, -50000n, -25000n, 0n, 25000n, 50000n, 80000n];
  const rows = amounts.map((amount_cents, i) => ({ id: `row-${i}`, account_id: "account-a", date: new Date(), posted_date: new Date(), payee: "Coffee", name: "Coffee", amount_cents }));
  const findMany = () => vi.fn(async ({ where }: any) => rows.filter(row => matches(where, row.amount_cents)));
  const prisma = { userBusinessRole: { findFirst: vi.fn().mockResolvedValue(role ? { role } : null) }, entry: { findMany: findMany() }, bankTransaction: { findMany: findMany() } };
  vi.doMock("./lib/db", () => ({ getPrisma: async () => prisma }));
  return { handler: (await import("./searchQuery")).handler, prisma };
}

function event(q: string, sub = "actor") {
  return { pathParameters: { businessId: "business-a" }, requestContext: { authorizer: { jwt: { claims: { sub } } } }, body: JSON.stringify({ q, accountId: "account-a" }) };
}
afterEach(() => { vi.doUnmock("./lib/db"); vi.resetModules(); });

describe("global search", () => {
  test.each([
    ["under $500", ["-25000", "0", "25000"]],
    ["over $500", ["-80000", "80000"]],
  ])("%s respects absolute amounts for both financial sources", async (query, expected) => {
    const { handler } = await load();
    const result = JSON.parse((await handler(event(query as string))).body);
    expect(result.results.entries.map((row: any) => row.amount_cents)).toEqual(expected);
    expect(result.results.bankTxns.map((row: any) => row.amount_cents)).toEqual(expected);
  });

  test("links preserve business and the result's own account", async () => {
    const { handler } = await load();
    const result = JSON.parse((await handler(event("over $500"))).body);
    for (const row of [...result.results.entries, ...result.results.bankTxns]) {
      const url = new URL(row.link, "https://app.example.test");
      expect(url.searchParams.get("businessId")).toBe("business-a");
      expect(url.searchParams.get("accountId")).toBe(row.account_id);
    }
  });

  test("does not query financial data for nonmembers", async () => {
    const { handler, prisma } = await load(null);
    expect((await handler(event("over $500"))).statusCode).toBe(403);
    expect(prisma.entry.findMany).not.toHaveBeenCalled();
    expect(prisma.bankTransaction.findMany).not.toHaveBeenCalled();
  });
});

test("custom ledger NONE omits entries without hiding separately permitted bank results", async () => {
  const { handler, prisma } = await load();
  (prisma as any).businessRolePolicy = { findFirst: vi.fn(async () => ({ policy_json: { ledger: "NONE", reconcile: "VIEW" } })) };
  const result = JSON.parse((await handler(event("over $500"))).body);
  expect(result.results.entries).toEqual([]);
  expect(result.results.bankTxns).toHaveLength(2);
  expect(prisma.entry.findMany).not.toHaveBeenCalled();
});

test.each([["under $1,000.50", 100050, "LT"], ["> $500", 50000, "GT"], ["above 500", 50000, "GT"]])("parses supported amount notation: %s", async (query, cents, op) => {
  const { handler } = await load();
  const result = JSON.parse((await handler(event(query as string))).body);
  expect(result.parsed.amount).toEqual({ cents, op });
  expect(result.parsed.text).toBe("");
});
