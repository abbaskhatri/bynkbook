import type { QueryClient } from "@tanstack/react-query";

// Reuse recent reads on navigation; successful writes invalidate their scope.
export const FINANCIAL_STALE_TIME = 2 * 60_000;
export type FinancialScope = { businessId: string; accountId?: string };
const listeners = new Set<(scope: FinancialScope) => void>();

export function financialWriteScope(path: string, method: string): FinancialScope | null {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) return null;
  const parts = path.split("?")[0].split("/").filter(Boolean);
  if (parts[0] !== "v1" || parts[1] !== "businesses" || !parts[2]) return null;
  const accountId = parts[3] === "accounts" ? parts[4] : undefined;
  const resource = accountId ? parts[5] ?? "accounts" : parts[3];
  // Only expire browser reads after an existing banking action succeeds. This
  // does not initiate, retry, delay, or change any Plaid request or sync operation.
  if (resource === "plaid") {
    return ["sync", "exchange", "repair-account", "apply-opening", "disconnect", "create-account"].includes(parts.at(-1) ?? "")
      ? { businessId: parts[2] }
      : null;
  }
  // Read-only POST endpoints do not expire financial data.
  if (!["entries", "bank-transactions", "match-groups", "matches", "accounts", "categories", "vendors", "closed-periods", "uploads", "transfers", "checks", "category-migration"].includes(resource)) return null;
  if (parts.includes("placement-summary") || parts.includes("preview")) return null;
  if (resource === "uploads" && parts.at(-1) !== "import") return null;
  return { businessId: parts[2], ...(accountId && resource !== "transfers" ? { accountId } : {}) };
}

export function notifyFinancialWrite(path: string, method: string) {
  const scope = financialWriteScope(path, method);
  if (scope) for (const listener of listeners) {
    try { listener(scope); } catch { /* Cache housekeeping must not fail a completed write. */ }
  }
}

export function subscribeFinancialWrites(listener: (scope: FinancialScope) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function invalidateFinancialReads(client: QueryClient, scope: FinancialScope) {
  return client.invalidateQueries({
    predicate: ({ queryKey: key }) => {
      if (key[0] === "dashboardExec") return key[2] === scope.businessId;
      if (key[0] !== "entries" && key[0] !== "ledgerSummary") return false;
      return key[1] === scope.businessId && (!scope.accountId || key[2] === scope.accountId);
    },
    // The current screen owns its mutation refresh. Other screens refresh on return.
    refetchType: "none",
  });
}
