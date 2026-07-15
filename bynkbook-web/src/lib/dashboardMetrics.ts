import type { AccountsSummaryRow, CashflowSeriesResponse } from "@/lib/api/reports";

const CASH_ACCOUNT_TYPES = new Set(["CHECKING", "SAVINGS", "CASH"]);
const BANK_CASH_ACCOUNT_TYPES = new Set(["CHECKING", "SAVINGS"]);

function toBigInt(value: unknown) {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

function monthKey(value: unknown) {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
  return "";
}

function isLastDayOfMonth(ymd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [year, month, day] = ymd.split("-").map(Number);
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isCashAccountType(type: unknown) {
  return CASH_ACCOUNT_TYPES.has(String(type ?? "").trim().toUpperCase());
}

export function ledgerBalanceCents(row: Pick<AccountsSummaryRow, "balance_cents" | "ledger_balance_cents">) {
  return String(row.ledger_balance_cents ?? row.balance_cents ?? "0");
}

export function isBankSnapshotComparable(bankBalanceAt: string | null | undefined, asOf: string) {
  if (!bankBalanceAt || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return false;
  const parsed = new Date(bankBalanceAt);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === asOf;
}

export function sumLedgerCashCents(rows: AccountsSummaryRow[]) {
  return rows.reduce(
    (sum, row) => sum + (isCashAccountType(row.type) ? toBigInt(ledgerBalanceCents(row)) : 0n),
    0n
  ).toString();
}

export function summarizeBankCash(rows: AccountsSummaryRow[]) {
  let total = 0n;
  let snapshotCount = 0;
  let eligibleCount = 0;
  let oldestSnapshotAt: string | null = null;

  for (const row of rows) {
    if (!BANK_CASH_ACCOUNT_TYPES.has(String(row.type ?? "").trim().toUpperCase())) continue;
    if (!row.bank_connection_status && row.bank_balance_cents == null) continue;
    eligibleCount += 1;
    if (row.bank_balance_cents == null) continue;

    total += toBigInt(row.bank_balance_cents);
    snapshotCount += 1;
    if (row.bank_balance_at && (!oldestSnapshotAt || row.bank_balance_at < oldestSnapshotAt)) {
      oldestSnapshotAt = row.bank_balance_at;
    }
  }

  return {
    totalCents: total.toString(),
    snapshotCount,
    eligibleCount,
    oldestSnapshotAt,
    complete: eligibleCount > 0 && snapshotCount === eligibleCount,
  };
}

export function calculateCashRunway(params: {
  monthly: CashflowSeriesResponse["monthly"];
  cashBalanceCents: string;
  asOf: string;
}) {
  const asOfMonth = params.asOf.slice(0, 7);
  const includeAsOfMonth = isLastDayOfMonth(params.asOf);
  const completed = params.monthly
    .map((row) => ({ month: monthKey(row.month), expenseCents: toBigInt(row.cash_out_cents) }))
    .filter((row) => row.month && (includeAsOfMonth ? row.month <= asOfMonth : row.month < asOfMonth))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-3);

  if (completed.length < 3) {
    return { display: "—", tooltip: "Runway needs three completed months of expense history." };
  }

  const expenseTotal = completed.reduce(
    (sum, row) => sum + (row.expenseCents < 0n ? -row.expenseCents : row.expenseCents),
    0n
  );
  const averageExpense = expenseTotal / BigInt(completed.length);
  const cash = toBigInt(params.cashBalanceCents);

  if (averageExpense <= 0n) return { display: "—", tooltip: "No expenses in the last three completed months." };
  if (cash <= 0n) return { display: "0.0 months", tooltip: "Runway: 0.0 months" };

  const months = Number(cash) / Number(averageExpense);
  if (!Number.isFinite(months)) return { display: "—", tooltip: null as string | null };

  const rounded = Math.round(months * 10) / 10;
  return {
    display: rounded > 24 ? "24+ months" : `${rounded.toFixed(1)} months`,
    tooltip: rounded > 24 ? `Runway: ${rounded.toFixed(1)} months (display capped)` : `Runway: ${rounded.toFixed(1)} months`,
  };
}
