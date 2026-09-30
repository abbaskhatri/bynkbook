import { describe, expect, test, vi } from "vitest";
import { createBankEntriesSequentially } from "./createBankEntriesSequentially";

describe("bulk bank entry creation", () => {
  test("processes a large selection serially with individual time budgets and progress", async () => {
    let active = 0;
    let maxActive = 0;
    const ids = Array.from({ length: 120 }, (_, i) => String(i));
    const progress = vi.fn();
    const create = vi.fn(async (id: string) => {
      maxActive = Math.max(maxActive, ++active);
      await Promise.resolve();
      active--;
      return { results: [{ bank_transaction_id: id, status: "CREATED" }] };
    });
    const results = await createBankEntriesSequentially([...ids, ids[0]], create, progress);
    expect(maxActive).toBe(1);
    expect(results).toHaveLength(120);
    expect(create).toHaveBeenCalledTimes(120);
    expect(progress).toHaveBeenLastCalledWith(results[119], 120);
  });

  test("preserves completed results and stops without retrying an ambiguous failure", async () => {
    const create = vi.fn().mockResolvedValueOnce({ results: [{ bank_transaction_id: "a", status: "CREATED" }] })
      .mockRejectedValueOnce(new Error("timeout"));
    const progress = vi.fn();
    await expect(createBankEntriesSequentially(["a", "b", "c"], create, progress)).rejects.toThrow("timeout");
    expect(create.mock.calls).toEqual([["a"], ["b"]]);
    expect(progress).toHaveBeenCalledTimes(1);
  });

  test("continues past explicit skipped and failed items", async () => {
    const statuses = ["SKIPPED", "FAILED", "CREATED"];
    const results = await createBankEntriesSequentially(["a", "b", "c"], async (id) => ({
      results: [{ bank_transaction_id: id, status: statuses.shift() }],
    }), () => {});
    expect(results.map((r) => r.status)).toEqual(["SKIPPED", "FAILED", "CREATED"]);
  });

  test("does not report malformed responses as successful writes", async () => {
    const progress = vi.fn();
    await expect(createBankEntriesSequentially(["a"], async () => ({ results: [] }), progress)).rejects.toThrow("could not be confirmed");
    expect(progress).not.toHaveBeenCalled();
  });
});
