import { describe, expect, test } from "vitest";
import { deriveBillStatus } from "./ap";

describe("AP deriveBillStatus", () => {
  test("void overrides", () => {
    expect(deriveBillStatus({ isVoid: true, amount: 100n, applied: 0n })).toBe("VOID");
    expect(deriveBillStatus({ isVoid: true, amount: 100n, applied: 100n })).toBe("VOID");
  });

  test("open/partial/paid", () => {
    expect(deriveBillStatus({ isVoid: false, amount: 100n, applied: 0n })).toBe("OPEN");
    expect(deriveBillStatus({ isVoid: false, amount: 100n, applied: 1n })).toBe("PARTIAL");
    expect(deriveBillStatus({ isVoid: false, amount: 100n, applied: 99n })).toBe("PARTIAL");
    expect(deriveBillStatus({ isVoid: false, amount: 100n, applied: 100n })).toBe("PAID");
  });
});
