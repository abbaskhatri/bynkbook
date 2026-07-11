export type PlaidSyncMonitorOutcome =
  | { kind: "complete"; result: any }
  | { kind: "timed_out"; result: any }
  | { kind: "cancelled" }
  | { kind: "error"; error: unknown };

type WaitFn = (delayMs: number, signal?: AbortSignal) => Promise<void>;

function defaultWait(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForPlaidSyncCompletion(options: {
  sync: () => Promise<any>;
  signal?: AbortSignal;
  maxAttempts?: number;
  wait?: WaitFn;
  onWaiting?: (result: any, attempt: number) => void;
}): Promise<PlaidSyncMonitorOutcome> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 45);
  const wait = options.wait ?? defaultWait;
  let latestResult: any = null;
  let latestError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const delayMs = Math.min(10_000, 2_000 + attempt * 1_000);
    try {
      await wait(delayMs, options.signal);
    } catch (error) {
      if (options.signal?.aborted || (error as any)?.name === "AbortError") return { kind: "cancelled" };
      latestError = error;
      continue;
    }
    if (options.signal?.aborted) return { kind: "cancelled" };

    try {
      latestResult = await options.sync();
      latestError = null;
    } catch (error) {
      latestError = error;
      continue;
    }
    if (options.signal?.aborted) return { kind: "cancelled" };
    if (!latestResult?.syncInProgress) return { kind: "complete", result: latestResult };

    options.onWaiting?.(latestResult, attempt + 1);
  }

  if (latestResult?.syncInProgress) return { kind: "timed_out", result: latestResult };
  return { kind: "error", error: latestError ?? new Error("Unable to confirm Plaid sync completion") };
}
