import { describe, expect, test } from "vitest";

import {
  canAutomaticallyRepairPlaidSelection,
  missingRequiredPlaidAccount,
  plaidAccountSelectionMatches,
  splitPlaidAccountsByExistingMapping,
} from "./accountSelection";

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

  test("separates accounts BynkBook can reconnect automatically from new unmatched accounts", () => {
    const result = splitPlaidAccountsByExistingMapping(
      [
        { id: "new-frisco", mask: "1751", type: "depository", subtype: "checking" },
        { id: "new-led", mask: "3290", type: "depository", subtype: "checking" },
        { id: "new-savings", mask: "2468", type: "depository", subtype: "savings" },
      ],
      [
        { accountId: "acct-frisco", plaidAccountId: "old-frisco", mask: "1751", plaidType: "depository", plaidSubtype: "checking", name: "Frisco" },
        { accountId: "acct-led", plaidAccountId: "old-led", mask: "3290", plaidType: "depository", plaidSubtype: "checking", name: "LED World" },
      ],
    );

    expect(result.existing.map(({ mapping }) => mapping.accountId)).toEqual(["acct-frisco", "acct-led"]);
    expect(result.unmatched.map((account) => account.id)).toEqual(["new-savings"]);
  });

  test("automatically repairs recognized siblings after the user selects a new target account", () => {
    const returnedAccounts = [
      { id: "new-frisco", mask: "1751", type: "depository", subtype: "checking" },
      { id: "new-dallas", mask: "0358", type: "depository", subtype: "checking" },
    ];
    const relatedAccounts = [
      { accountId: "acct-frisco", plaidAccountId: "old-frisco", mask: "1751", plaidType: "depository", plaidSubtype: "checking" },
    ];

    expect(canAutomaticallyRepairPlaidSelection({
      returnedAccounts,
      relatedAccounts,
      targetPlaidAccountId: "new-dallas",
      targetSelectionIsCertain: true,
    })).toBe(true);
  });

  test("requires review when Plaid returns an additional unmatched account", () => {
    const returnedAccounts = [
      { id: "new-frisco", mask: "1751", type: "depository", subtype: "checking" },
      { id: "new-dallas", mask: "0358", type: "depository", subtype: "checking" },
      { id: "new-savings", mask: "2468", type: "depository", subtype: "savings" },
    ];
    const relatedAccounts = [
      { accountId: "acct-frisco", plaidAccountId: "old-frisco", mask: "1751", plaidType: "depository", plaidSubtype: "checking" },
    ];

    expect(canAutomaticallyRepairPlaidSelection({
      returnedAccounts,
      relatedAccounts,
      targetPlaidAccountId: "new-dallas",
      targetSelectionIsCertain: true,
    })).toBe(false);
  });
});
