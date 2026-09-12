import { afterEach, beforeEach, expect, test, vi } from "vitest";
class Script extends EventTarget { src = ""; async = false; removed = false; remove() { this.removed = true; } }
let scripts: Script[];
beforeEach(() => {
  vi.resetModules(); scripts = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { querySelector: () => scripts.find((script) => !script.removed) ?? null, createElement: () => new Script(), head: { appendChild: (script: Script) => scripts.push(script) } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
test("shares one script between simultaneous bank connection launches", async () => {
  const { loadPlaidLink } = await import("./loadLink");
  const first = loadPlaidLink(); const second = loadPlaidLink();
  expect(first).toBe(second); expect(scripts).toHaveLength(1);
  window.Plaid = { create: vi.fn() }; scripts[0].dispatchEvent(new Event("load"));
  await first;
});
test("failed scripts can be retried without reloading the app", async () => {
  const { loadPlaidLink } = await import("./loadLink");
  const failure = expect(loadPlaidLink()).rejects.toThrow("try again");
  scripts[0].dispatchEvent(new Event("error")); await failure;
  const retry = loadPlaidLink(); expect(scripts).toHaveLength(2);
  window.Plaid = { create: vi.fn() }; scripts[1].dispatchEvent(new Event("load")); await retry;
});
test("a stalled script reaches a retryable timeout", async () => {
  vi.useFakeTimers();
  const { loadPlaidLink } = await import("./loadLink");
  const failure = expect(loadPlaidLink()).rejects.toThrow("try again");
  await vi.advanceTimersByTimeAsync(15_000); await failure;
  expect(scripts[0].removed).toBe(true);
});
