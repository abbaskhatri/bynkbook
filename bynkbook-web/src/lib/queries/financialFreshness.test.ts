import { describe, expect, test, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { FINANCIAL_STALE_TIME, financialWriteScope, invalidateFinancialReads, notifyFinancialWrite, subscribeFinancialWrites } from "./financialFreshness";

describe("financial navigation freshness", () => {
  test("reuses fresh reads, then fetches after a write without a background request", async () => {
    const client = new QueryClient();
    const queryFn = vi.fn().mockResolvedValue([{ id: "first" }]);
    const options = { queryKey: ["entries", "biz-a", "acct-a"], queryFn, staleTime: FINANCIAL_STALE_TIME };
    await client.fetchQuery(options);
    client.setQueryData(options.queryKey, [{ id: "first" }], { updatedAt: Date.now() - 31_000 });
    await client.fetchQuery(options);
    expect(queryFn).toHaveBeenCalledTimes(1);
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => {});
    await invalidateFinancialReads(client, { businessId: "biz-a", accountId: "acct-a" });
    expect(queryFn).toHaveBeenCalledTimes(1);
    queryFn.mockResolvedValue([{ id: "updated" }]);
    expect(await client.fetchQuery(options)).toEqual([{ id: "updated" }]);
    expect(queryFn).toHaveBeenCalledTimes(2);
    client.setQueryData(options.queryKey, [{ id: "updated" }], { updatedAt: Date.now() - FINANCIAL_STALE_TIME - 1 });
    await client.fetchQuery(options);
    expect(queryFn).toHaveBeenCalledTimes(3);
    unsubscribe();
    client.clear();
  });

  test("invalidates account reads and business totals without crossing businesses or Plaid caches", async () => {
    const client = new QueryClient();
    const keys = [
      ["entries", "biz-a", "acct-a"], ["entries", "biz-a", "acct-b"],
      ["ledgerSummary", "biz-a", "acct-a"], ["entries", "biz-b", "acct-a"],
      ["dashboardExec", "pnlSummary", "biz-a", "all"],
      ["dashboardExec", "pnlSummary", "biz-b", "all"], ["plaidStatus", "biz-a", "acct-a"],
    ];
    keys.forEach(key => client.setQueryData(key, []));
    await invalidateFinancialReads(client, { businessId: "biz-a", accountId: "acct-a" });
    expect(keys.map(key => client.getQueryState(key)?.isInvalidated)).toEqual([true, false, true, false, true, false, false]);
    client.clear();
  });

  test.each([
    ["/v1/businesses/b/accounts/a/entries/e", "PATCH", { businessId: "b", accountId: "a" }],
    ["/v1/businesses/b/accounts/a/transfers", "POST", { businessId: "b" }],
    ["/v1/businesses/b/checks/c/void", "POST", { businessId: "b" }],
    ["/v1/businesses/b/uploads/u/import", "POST", { businessId: "b" }],
    ["/v1/businesses/b/accounts/a/plaid/sync", "POST", { businessId: "b" }],
    ["/v1/businesses/b/accounts/a/plaid/link-token", "POST", null],
    ["/v1/businesses/b/accounts/a/plaid/preview-opening", "POST", null],
    ["/v1/businesses/b/accounts/a/entries", "GET", null],
    ["/v1/businesses/b/accounts/a/match-groups/placement-summary", "POST", null],
    ["/v1/ai/suggest-reconcile", "POST", null],
  ])("classifies %s %s", (path, method, expected) => {
    expect(financialWriteScope(path, method)).toEqual(expected);
  });

  test("cache listener failures cannot turn a successful save into an error", () => {
    const stop = subscribeFinancialWrites(() => { throw new Error("cache failure"); });
    expect(() => notifyFinancialWrite("/v1/businesses/b/accounts/a/entries", "POST")).not.toThrow();
    stop();
  });
});
