import { describe, expect, test } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { keepScopedData } from "./keepScopedData";

describe("workspace placeholder data", () => {
  test("keeps rows while loading another page of the same account", () => {
    const rows = [{ id: "entry-a" }];
    expect(keepScopedData({ 1: "business-a", 2: "account-a" })(rows, {
      queryKey: ["entries", "business-a", "account-a", 1],
    })).toBe(rows);
  });

  test.each([
    { 1: "business-b", 2: "account-a" },
    { 1: "business-a", 2: "account-b" },
  ])("clears previous rows when workspace changes: %j", scope => {
    const client = new QueryClient();
    const initialKey = ["entries", "business-a", "account-a"];
    client.setQueryData(initialKey, [{ id: "entry-a" }]);
    const observer = new QueryObserver(client, { queryKey: initialKey, enabled: false });
    const unsubscribe = observer.subscribe(() => {});
    observer.setOptions({
      queryKey: ["entries", scope[1], scope[2]],
      enabled: false,
      placeholderData: keepScopedData(scope),
    });
    expect(observer.getCurrentResult().data).toBeUndefined();
    unsubscribe();
    client.clear();
  });

  test("supports dashboard keys whose workspace occupies different positions", () => {
    expect(keepScopedData({ 2: "business-b", 4: "all" })({ balance: 500 }, {
      queryKey: ["dashboardExec", "accountsSummary", "business-a", "2026-09-12", "all"],
    })).toBeUndefined();
  });
});
