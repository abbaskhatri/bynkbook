import { describe, expect, test } from "vitest";

import { incrementCheckNumber, normalizeAllocations, normalizeCheckNumber } from "./checks";

describe("check printing helpers", () => {
  test("preserves the printed check number width when advancing", () => {
    expect(normalizeCheckNumber("001009")).toBe("001009");
    expect(incrementCheckNumber("001009")).toBe("001010");
    expect(incrementCheckNumber("999")).toBe("1000");
  });

  test("rejects invalid or duplicate physical check numbers", () => {
    expect(normalizeCheckNumber("10A2")).toBeNull();
    expect(normalizeCheckNumber("")).toBeNull();
  });

  test("allows optional bill allocations but never over-allocates the check", () => {
    const billId = "11111111-1111-4111-8111-111111111111";
    expect(normalizeAllocations([], 10_000n)).toEqual({ ok: true, rows: [] });
    expect(normalizeAllocations([{ bill_id: billId, applied_amount_cents: 5_000 }], 10_000n)).toEqual({
      ok: true,
      rows: [{ bill_id: billId, applied_amount_cents: 5_000n }],
    });
    expect(normalizeAllocations([{ bill_id: billId, applied_amount_cents: 10_001 }], 10_000n)).toEqual({
      ok: false,
      error: "Bill allocations cannot exceed the check amount",
    });
  });
});
