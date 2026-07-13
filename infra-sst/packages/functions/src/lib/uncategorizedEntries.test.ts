import { describe, expect, test } from "vitest";

import { actionableUncategorizedEntryWhere } from "./uncategorizedEntries";

describe("actionable uncategorized entry scope", () => {
  test("matches the account category-review queue", () => {
    expect(actionableUncategorizedEntryWhere({ businessId: "biz-1", accountId: "acct-1" })).toEqual({
      business_id: "biz-1",
      account_id: "acct-1",
      category_id: null,
      deleted_at: null,
      type: { in: ["EXPENSE", "INCOME"] },
      status: { notIn: ["VOIDED", "DELETED", "SOFT_DELETED", "REMOVED"] },
      NOT: [
        { payee: { startsWith: "opening balance", mode: "insensitive" } },
      ],
    });
  });

  test("limits business-wide counts to active accounts", () => {
    expect(actionableUncategorizedEntryWhere({ businessId: "biz-1", activeAccountsOnly: true })).toMatchObject({
      business_id: "biz-1",
      account: { archived_at: null },
    });
  });
});
