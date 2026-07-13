import { describe, expect, test } from "vitest";

import { buildForecast, daysBetween, freshnessState } from "./operationsOverview";

describe("operations overview", () => {
  test("classifies bank connection freshness without treating an active sync as disconnected", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");

    expect(freshnessState(null, now)).toBe("NOT_CONNECTED");
    expect(freshnessState({ status: "PENDING_SYNC" }, now)).toBe("SYNCING");
    expect(
      freshnessState({ status: "CONNECTED", last_sync_at: "2026-07-13T08:00:00.000Z" }, now)
    ).toBe("HEALTHY");
    expect(
      freshnessState({ status: "CONNECTED", last_sync_at: "2026-07-10T08:00:00.000Z" }, now)
    ).toBe("STALE");
    expect(freshnessState({ status: "ITEM_LOGIN_REQUIRED" }, now)).toBe("NEEDS_ATTENTION");
  });

  test("measures posting distance for transfer candidates", () => {
    expect(daysBetween("2026-07-10", "2026-07-10")).toBe(0);
    expect(daysBetween("2026-07-10", "2026-07-13")).toBe(3);
  });

  test("projects only stable recurring ledger activity into 13 weekly buckets", () => {
    const entries = [
      { date: "2026-04-03", payee: "Payroll deposit", amount_cents: 100_000n, type: "INCOME" },
      { date: "2026-05-03", payee: "Payroll deposit", amount_cents: 100_000n, type: "INCOME" },
      { date: "2026-06-02", payee: "Payroll deposit", amount_cents: 100_000n, type: "INCOME" },
      { date: "2026-04-10", payee: "Office rent", amount_cents: -40_000n, type: "EXPENSE" },
      { date: "2026-05-10", payee: "Office rent", amount_cents: -40_000n, type: "EXPENSE" },
      { date: "2026-06-09", payee: "Office rent", amount_cents: -40_000n, type: "EXPENSE" },
      { date: "2026-06-12", payee: "One-off equipment", amount_cents: -250_000n, type: "EXPENSE" },
    ];

    const forecast = buildForecast(entries, 500_000n, 13);

    expect(forecast.weeks).toHaveLength(13);
    expect(forecast.recurring).toHaveLength(2);
    expect(forecast.recurring.some((row) => row.payee === "One-off equipment")).toBe(false);
    expect(forecast.methodology).toContain("3+ observations");
  });
});
