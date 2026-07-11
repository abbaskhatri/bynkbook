import { describe, expect, test, vi } from "vitest";
import { waitForPlaidSyncCompletion } from "./plaidSyncMonitor";

describe("waitForPlaidSyncCompletion", () => {
  test("keeps polling an active lease and returns the completed sync result", async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce({ ok: true, syncInProgress: true })
      .mockResolvedValueOnce({ ok: true, syncInProgress: true })
      .mockResolvedValueOnce({ ok: true, syncInProgress: false, newCount: 3 });
    const onWaiting = vi.fn();
    const wait = vi.fn(async () => {});

    const outcome = await waitForPlaidSyncCompletion({ sync, wait, onWaiting, maxAttempts: 5 });

    expect(outcome).toEqual({
      kind: "complete",
      result: { ok: true, syncInProgress: false, newCount: 3 },
    });
    expect(sync).toHaveBeenCalledTimes(3);
    expect(onWaiting).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenNthCalledWith(1, 2000, undefined);
    expect(wait).toHaveBeenNthCalledWith(3, 4000, undefined);
  });

  test("returns a bounded timeout instead of polling forever", async () => {
    const sync = vi.fn(async () => ({ ok: true, syncInProgress: true }));

    const outcome = await waitForPlaidSyncCompletion({
      sync,
      wait: async () => {},
      maxAttempts: 2,
    });

    expect(outcome.kind).toBe("timed_out");
    expect(sync).toHaveBeenCalledTimes(2);
  });

  test("cancels without calling sync when the account scope changes", async () => {
    const controller = new AbortController();
    controller.abort();
    const sync = vi.fn();

    const outcome = await waitForPlaidSyncCompletion({
      sync,
      signal: controller.signal,
      wait: async (_delay, signal) => {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      },
    });

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(sync).not.toHaveBeenCalled();
  });
});
