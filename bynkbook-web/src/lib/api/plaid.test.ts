import { beforeEach, describe, expect, test, vi } from "vitest";
import { apiFetch } from "./client";
import { plaidSync, plaidExchange, plaidRepairAccount, plaidApplyOpening, plaidDisconnect } from "./plaid";
vi.mock("./client", () => ({ apiFetch: vi.fn() }));
beforeEach(() => vi.mocked(apiFetch).mockReset());
describe("Plaid API contracts", () => {
  test("drains cursor continuations without repeating paid/provider refresh requests", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, hasMore: true, newCount: 2, pages: 1 }).mockResolvedValueOnce({ ok: true, hasMore: false, newCount: 3, pages: 1 });
    const signal = new AbortController().signal;
    const result = await plaidSync("business", "account", { afterReconnect: true, refreshBalance: true, refreshTransactions: true, signal });
    expect(result.newCount).toBe(5);
    expect(result.pages).toBe(2);
    expect(result.drainIncomplete).toBe(false);
    const calls = vi.mocked(apiFetch).mock.calls;
    expect(calls.every(([path, options]) => path === "/v1/businesses/business/accounts/account/plaid/sync" && options?.signal === signal)).toBe(true);
    expect(JSON.parse(calls[0][1]!.body as string)).toEqual({ afterReconnect: true, forceBalanceRefresh: true, forceRefresh: true });
    expect(JSON.parse(calls[1][1]!.body as string)).toEqual({ afterReconnect: false, forceBalanceRefresh: false, forceRefresh: false });
  });
  test("returns an active lease without launching overlapping sync continuations", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, syncInProgress: true, hasMore: true });
    expect((await plaidSync("business", "account")).syncInProgress).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
  test("bounded continuation remains visibly incomplete", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, hasMore: true });
    expect((await plaidSync("business", "account")).drainIncomplete).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(10);
  });
  test("does not treat failed payloads as successful imports", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, error: "Reconnect required" });
    await expect(plaidSync("business", "account")).rejects.toThrow("Reconnect required");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
  test("preserves explicit account mappings and opening choices", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true });
    const mapping = { public_token: "synthetic-token", plaidAccountId: "plaid-a", additionalAccounts: [{ plaidAccountId: "plaid-b", name: "Savings" }] };
    await plaidExchange("business", "account", mapping);
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls[0][1]!.body as string)).toEqual(mapping);
    await plaidRepairAccount("business", "account", { plaidAccountId: "plaid-a", sourceAccountId: "source" });
    expect(vi.mocked(apiFetch).mock.calls[1][0]).toContain("/account/plaid/repair-account");
    await plaidApplyOpening("business", "account", { choice: "KEEP_MANUAL", effectiveStartDate: "2026-01-01" });
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls[2][1]!.body as string).choice).toBe("KEEP_MANUAL");
    await plaidDisconnect("business", "account");
    expect(vi.mocked(apiFetch).mock.calls[3][1]?.method).toBe("DELETE");
  });
});
