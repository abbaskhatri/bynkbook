import { beforeEach, expect, test } from "vitest";
import { metrics } from "./metrics";
beforeEach(() => metrics.reset());
test("does not retain query text or account identifiers in API metrics", () => {
  metrics.api("/accounts/11111111-1111-4111-8111-111111111111/entries?search=private-payee", 12);
  expect(metrics.getSnapshot().api[0].name).toBe("/accounts/:id/entries");
});
test("bounds metric names and samples in long sessions", () => {
  for (let n = 0; n < 300; n++) { metrics.api(`/route-${n}`, n); metrics.incCounter(`count-${n}`); }
  expect(metrics.getSnapshot().api).toHaveLength(100);
  expect(Object.keys(metrics.getSnapshot().counters)).toHaveLength(100);
  for (let n = 0; n < 300; n++) metrics.api("/bounded", n);
  expect(metrics.getSnapshot().api.find((row) => row.name === "/bounded")?.n).toBe(200);
});
