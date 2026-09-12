import { beforeEach, describe, expect, test, vi } from "vitest";
import { apiFetch } from "./client";
import { loadEntriesForQuery, type EntryList } from "./entries";
vi.mock("./client", () => ({ apiFetch: vi.fn() }));
const request = { businessId: "business-a", accountId: "account-a", limit: 1 };
const cached = Object.assign([{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }], { meta: { limit: 1, hasMore: true, nextCursor: "cursor-four", loadedPages: 4 } }) as EntryList;
beforeEach(() => vi.mocked(apiFetch).mockReset());
describe("incremental entry reads", () => {
  test("page five requests only the next cursor and preserves previous rows", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [{ id: "five" }], hasMore: true, nextCursor: "cursor-five" });
    const result = await loadEntriesForQuery({ ...request, pageCount: 5 }, cached);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toContain("cursor=cursor-four");
    expect(result.map((row) => row.id)).toEqual(["one", "two", "three", "four", "five"]);
    expect(result.meta?.loadedPages).toBe(5);
    expect(cached).toHaveLength(4);
  });
  test("invalidation restarts from the first page, preserving fresh accounting values", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [{ id: "changed" }], hasMore: false });
    const result = await loadEntriesForQuery({ ...request, pageCount: 5 }, cached, true);
    expect(vi.mocked(apiFetch).mock.calls[0][0]).not.toContain("cursor=");
    expect(result.map((row) => row.id)).toEqual(["changed"]);
  });
  test("new scopes start with one page and forward cancellation", async () => {
    const signal = new AbortController().signal;
    vi.mocked(apiFetch).mockResolvedValue({ items: [{ id: "new" }], hasMore: true, nextCursor: "next" });
    await loadEntriesForQuery({ ...request, accountId: "account-b", pageCount: 12, signal });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toContain("/accounts/account-b/");
    expect(vi.mocked(apiFetch).mock.calls[0][1]?.signal).toBe(signal);
  });
  test("overlapping server pages do not duplicate entries", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [{ id: "four" }, { id: "five" }], hasMore: false });
    const result = await loadEntriesForQuery({ ...request, pageCount: 5 }, cached);
    expect(result.map((row) => row.id)).toEqual(["one", "two", "three", "four", "five"]);
  });
});
