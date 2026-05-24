// Canonical money utilities for the entire app.
//
// Why this file exists:
//
// `formatUsdFromCents` was previously defined in 13 separate files with
// 3 different display rules (some with `$`, some without, one using
// Intl.NumberFormat). `toBigIntSafe` had 7 copies. `parseMoneyToCents`
// existed only in lib/ledger/helpers.ts but settings/vendors used a
// `Math.round(Number(x) * 100)` float pattern that has a 1-cent
// ambiguity at penny boundaries.
//
// All of those now route through this single module. Behavior is
// preserved per-page via the small options object on `formatUsd`.
//
// IMPORTANT: do not change the BigInt math here without explicit review.
// The whole app's totals depend on it.

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

export type FormatUsdOptions = {
  /** Prefix with "$"? Default true. Reconcile sets false for denser tables. */
  dollarSign?: boolean;
  /** How to render negatives. Default "parens" (accounting style). */
  negStyle?: "parens" | "minus";
};

/**
 * Safely coerce any value to bigint cents. Never throws.
 * Returns 0n on null, undefined, NaN, empty string, or parse failure.
 */
export function toBigIntSafe(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch {
    /* fall through to default */
  }
  return ZERO;
}

/**
 * Format bigint cents as a USD display string.
 *
 *   formatUsd(123456n)                                  → "$1,234.56"
 *   formatUsd(-123456n)                                 → "($1,234.56)"
 *   formatUsd(123456n, { dollarSign: false })            → "1,234.56"
 *   formatUsd(-123456n, { dollarSign: false })           → "(1,234.56)"
 *   formatUsd(-123456n, { negStyle: "minus" })           → "-$1,234.56"
 *   formatUsd(123456n,  { dollarSign: false, negStyle: "minus" }) → "1,234.56"
 *
 * Pure BigInt math — no floating-point rounding errors.
 */
export function formatUsd(cents: bigint, opts?: FormatUsdOptions): string {
  const dollarSign = opts?.dollarSign !== false;
  const negStyle = opts?.negStyle ?? "parens";

  const neg = cents < ZERO;
  const abs = neg ? -cents : cents;
  const dollars = abs / HUNDRED;
  const pennies = abs % HUNDRED;

  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const numeric = `${withCommas}.${pennies.toString().padStart(2, "0")}`;
  const signed = dollarSign ? `$${numeric}` : numeric;

  if (!neg) return signed;
  return negStyle === "parens" ? `(${signed})` : `-${signed}`;
}

/**
 * Convenience: parse any value to bigint and format. Equivalent to
 * `formatUsd(toBigIntSafe(value), opts)`. Returned string for unparseable
 * input is "$0.00" (or "0.00" with `dollarSign: false`).
 */
export function formatUsdSafe(value: unknown, opts?: FormatUsdOptions): string {
  return formatUsd(toBigIntSafe(value), opts);
}

/**
 * Parse a user-typed money string into integer cents.
 * Robust against $ signs, commas, parens-for-negative, missing decimals.
 * Returns 0 on any parse failure.
 *
 * IMPORTANT: this implementation parses the dollars and cents PARTS as
 * separate integer strings and does integer arithmetic. It does NOT use
 * `Number(x) * 100` which has float-precision issues at penny boundaries
 * (e.g. "1234.005" * 100 = 123400.5).
 *
 *   parseMoneyToCents("1234.56")    → 123456
 *   parseMoneyToCents("$1,234.56")  → 123456
 *   parseMoneyToCents("(1234.56)")  → -123456
 *   parseMoneyToCents("-1234.5")    → -123450
 *   parseMoneyToCents("1234")       → 123400
 *   parseMoneyToCents("")           → 0
 *   parseMoneyToCents("abc")        → 0
 */
export function parseMoneyToCents(input: string): number {
  const raw = (input || "").trim();
  if (!raw) return 0;

  const parenNeg = raw.startsWith("(") && raw.endsWith(")");
  const cleaned = raw.replace(/^\(|\)$/g, "").replace(/[\$,]/g, "").trim();
  if (!cleaned) return 0;

  const m = cleaned.match(/^(-)?(\d+)(?:\.(\d{0,2}))?$/);
  if (!m) return 0;

  const neg = parenNeg || !!m[1];
  const dollars = Number(m[2] || "0");
  const centsPart = (m[3] || "").padEnd(2, "0").slice(0, 2);
  const cents = Number(centsPart || "0");
  const total = dollars * 100 + cents;
  return neg ? -total : total;
}
