export function normalizeMerchant(payee: any, memo?: any): string {
  const raw = `${String(payee ?? "")} ${String(memo ?? "")}`.trim().toLowerCase();

  if (!raw) return "";

  return raw
    .replace(/[.,/#!$%^&*;:{}=\-_`~()@\[\]\\|+?<>"]/g, " ")
    .replace(/\b(?:pos|debit|credit|purchase|card|checkcard|check card|visa|mastercard|mc|amex|ach|online|payment|pending)\b/g, " ")
    .replace(/\b(?:inc|llc|l\.l\.c|corp|corporation|co|company|ltd)\b/g, " ")
    .replace(/\b(?:marketplace|market place)\b/g, " ")
    .replace(/\b(?:com)\b/g, " ")
    .replace(/\b(?:digital svcs|digital services)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeFreeText(value: any): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeMerchantText(payee: any, memo?: any): string[] {
  const text = normalizeFreeText(`${String(payee ?? "")} ${String(memo ?? "")}`);
  if (!text) return [];

  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "to",
    "of",
    "a",
    "an",
    "inc",
    "llc",
    "co",
    "company",
    "payment",
    "purchase",
    "card",
    "online",
    "pending",
  ]);

  return text
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && !stop.has(x));
}