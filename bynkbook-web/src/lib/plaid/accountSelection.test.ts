import { describe, expect, test } from "vitest";

import { missingRequiredPlaidAccount, plaidAccountSelectionMatches } from "./accountSelection";

describe("Plaid update-mode account retention", () => {
  test("accepts a replacement account id when mask and account identity are unchanged", () => {
    expect(plaidAccountSelectionMatches(
      { plaidAccountId: "old-id", mask: "1751", plaidType: "depository", plaidSubtype: "checking" },
      { id: "new-id", mask: "1751", type: "depository", subtype: "checking" },
    )).toBe(true);
  });

  test("does not treat a different account with the same mask but incompatible type as retained", () => {
    expect(plaidAccountSelectionMatches(
      { plaidAccountId: "old-id", mask: "1751", plaidType: "depository", plaidSubtype: "checking" },
      { id: "new-id", mask: "1751", type: "credit", subtype: "credit card" },
    )).toBe(false);
  });

  test("reports only genuinely omitted preserved accounts", () => {
    const missing = missingRequiredPlaidAccount(
      [
        { plaidAccountId: "old-frisco", mask: "1751", plaidType: "depository", plaidSubtype: "checking", name: "Frisco" },
        { plaidAccountId: "old-led", mask: "3290", plaidType: "depository", plaidSubtype: "checking", name: "LED World" },
      ],
      [
        { id: "new-frisco", mask: "1751", type: "depository", subtype: "checking" },
      ],
    );

    expect(missing?.name).toBe("LED World");
  });
});
