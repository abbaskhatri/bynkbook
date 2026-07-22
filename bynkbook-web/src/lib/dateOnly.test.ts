import { describe, expect, test } from "vitest";

import { isFutureDateOnly, localTodayDateOnly } from "./dateOnly";

describe("date-only comparisons", () => {
  test("identifies only dates after the supplied local day as future dates", () => {
    expect(isFutureDateOnly("2026-07-23", "2026-07-22")).toBe(true);
    expect(isFutureDateOnly("2026-07-22", "2026-07-22")).toBe(false);
    expect(isFutureDateOnly("2026-07-21", "2026-07-22")).toBe(false);
    expect(isFutureDateOnly("", "2026-07-22")).toBe(false);
  });

  test("formats the local calendar day without UTC rollover", () => {
    expect(localTodayDateOnly(new Date("2026-07-22T18:30:00.000Z"))).toMatch(/^2026-07-22$/);
  });
});
