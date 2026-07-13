const INACTIVE_ENTRY_STATUSES = ["VOIDED", "DELETED", "SOFT_DELETED", "REMOVED"];

export function actionableUncategorizedEntryWhere(params: {
  businessId: string;
  accountId?: string;
  activeAccountsOnly?: boolean;
}) {
  return {
    business_id: params.businessId,
    ...(params.accountId ? { account_id: params.accountId } : {}),
    ...(params.activeAccountsOnly ? { account: { archived_at: null } } : {}),
    category_id: null,
    deleted_at: null,
    type: { in: ["EXPENSE", "INCOME"] },
    status: { notIn: INACTIVE_ENTRY_STATUSES },
    NOT: [
      { payee: { startsWith: "opening balance", mode: "insensitive" } },
    ],
  };
}
