import { describe, expect, test } from "vitest";

import { isCashAccountType, requiresReconciliation, supportsBankConnection } from "./accountCapabilities";

describe("account capabilities", () => {
  test("cash accounts are ledger-only", () => {
    expect(isCashAccountType("cash")).toBe(true);
    expect(supportsBankConnection("CASH")).toBe(false);
    expect(requiresReconciliation("CASH")).toBe(false);
  });

  test("bank and other accounts retain banking capabilities", () => {
    for (const type of ["CHECKING", "SAVINGS", "CREDIT_CARD", "OTHER"]) {
      expect(isCashAccountType(type)).toBe(false);
      expect(supportsBankConnection(type)).toBe(true);
      expect(requiresReconciliation(type)).toBe(true);
    }
  });
});
