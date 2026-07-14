import { describe, expect, test } from "vitest";

import { pickPreferredAccountId } from "./accountSelection";

const cash = { id: "cash-1", type: "CASH" };
const checking = { id: "bank-1", type: "CHECKING" };

describe("pickPreferredAccountId", () => {
  test("does not select an explicitly requested cash account for reconciliation", () => {
    expect(
      pickPreferredAccountId({
        accounts: [cash, checking],
        accountIdFromUrl: cash.id,
        excludeCash: true,
      }),
    ).toBe(checking.id);
  });

  test("returns no account when only excluded cash accounts are loaded", () => {
    expect(
      pickPreferredAccountId({
        accounts: [cash],
        accountIdFromUrl: cash.id,
        excludeCash: true,
      }),
    ).toBe("");
  });

  test("preserves an explicit account while the account list is still loading", () => {
    expect(
      pickPreferredAccountId({
        accounts: [],
        accountIdFromUrl: checking.id,
        excludeCash: true,
      }),
    ).toBe(checking.id);
  });
});
