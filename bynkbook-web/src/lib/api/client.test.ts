import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: vi.fn(), expire: vi.fn() }));
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: auth.session }));
vi.mock("@/lib/auth/sessionPolicy", () => ({ expireSessionIfNeeded: auth.expire }));
vi.mock("@/lib/perf/metrics", () => ({ metrics: { api: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
  auth.expire.mockResolvedValue(null);
  auth.session.mockResolvedValue({ tokens: { idToken: { toString: () => "test-token" } } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("API request lifecycle", () => {
  test("preserves status and payload for friendly validation errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "INVALID_INPUT", error: "Choose an account." }), {
      status: 400, headers: { "content-type": "application/json" },
    })));
    const { apiFetch } = await import("./client");
    await expect(apiFetch("/entries")).rejects.toMatchObject({ status: 400, code: "INVALID_INPUT", payload: { error: "Choose an account." } });
  });

  test("does not authenticate or fetch an already cancelled search", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("./client");
    const controller = new AbortController();
    controller.abort();
    await expect(apiFetch("/search", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(auth.session).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not start a request cancelled while authentication was pending", async () => {
    let release!: (value: unknown) => void;
    auth.session.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("./client");
    const controller = new AbortController();
    const promise = apiFetch("/search", { signal: controller.signal });
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    release({ tokens: { idToken: { toString: () => "test-token" } } });
    await assertion;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("times out a stalled body even after response headers arrive", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => ({
      text: () => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    })));
    const { apiFetch } = await import("./client");
    const assertion = expect(apiFetch("/entries", { timeoutMs: 100 })).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  test("removes caller abort listeners after successful requests", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"ok":true}', { headers: { "content-type": "application/json" } })));
    const { apiFetch } = await import("./client");
    await expect(apiFetch("/entries", { signal: controller.signal })).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  test("refreshes and retries once on 401", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("./client");
    await expect(apiFetch("/entries")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.session).toHaveBeenLastCalledWith({ forceRefresh: true });
  });
});
