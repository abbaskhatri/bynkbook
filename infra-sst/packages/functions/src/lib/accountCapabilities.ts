export function isCashAccountType(value: unknown) {
  return String(value ?? "").trim().toUpperCase() === "CASH";
}

export const CASH_ACCOUNT_BANKING_ERROR = {
  code: "CASH_ACCOUNT_BANKING_NOT_APPLICABLE",
  error: "Cash accounts do not use bank connections, bank statements, or reconciliation.",
} as const;
