export function isCashAccountType(value: unknown) {
  return String(value ?? "").trim().toUpperCase() === "CASH";
}

export function supportsBankConnection(value: unknown) {
  return !isCashAccountType(value);
}

export function requiresReconciliation(value: unknown) {
  return !isCashAccountType(value);
}
