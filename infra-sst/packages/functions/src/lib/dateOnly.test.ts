import { describe, expect, test } from "vitest";
import { normalizeDateOnly, parseDateOnlyToUtcDate, serializeDateOnly } from "./dateOnly";

describe("date-only helpers", () => {
  test("parses and serializes an account opening date without shifting", () => {
    const parsed = parseDateOnlyToUtcDate("2026-04-01");

    expect(parsed?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(serializeDateOnly(parsed)).toBe("2026-04-01");
  });

  test("parses and serializes a ledger entry date without shifting", () => {
    const parsed = parseDateOnlyToUtcDate("2026-04-22");

    expect(parsed?.toISOString()).toBe("2026-04-22T00:00:00.000Z");
    expect(serializeDateOnly(parsed)).toBe("2026-04-22");
  });

  test("keeps America/Chicago-facing UTC-midnight date strings on their business date", () => {
    expect(normalizeDateOnly("2026-04-01T00:00:00.000Z")).toBe("2026-04-01");
    expect(normalizeDateOnly("2026-04-22T00:00:00.000Z")).toBe("2026-04-22");
  });

  test("normalizes existing ISO date-time input safely", () => {
    expect(normalizeDateOnly("2026-04-01T13:45:30.000Z")).toBe("2026-04-01");
    expect(normalizeDateOnly("2026-04-01T00:00:00-05:00")).toBe("2026-04-01");
  });
});
