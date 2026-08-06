import { describe, expect, test } from "vitest";

import { latestCompletedMonth, monthEndYmd, monthToRange, previousMonth } from "./date-range";

describe("closed-period date ranges", () => {
  test("uses the previous month until the current month is complete", () => {
    expect(latestCompletedMonth("2026-08-06")).toBe("2026-07");
    expect(latestCompletedMonth("2026-08-31")).toBe("2026-08");
  });

  test("handles year boundaries and leap years", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(monthEndYmd("2028-02")).toBe("2028-02-29");
    expect(monthToRange("2026-04")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });
});
