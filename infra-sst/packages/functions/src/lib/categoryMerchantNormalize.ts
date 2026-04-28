function cleanText(value: any): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripReferenceNoise(value: string): string {
  return value
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/\b(?:ref|trace|trn|conf|confirmation|auth|id|seq|trans|transaction)\s*\d+\b/g, " ")
    .replace(/\b(?:xx\d{2,}|x{2,}\d*)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripBankingNoise(value: string): string {
  return value
    .replace(
      /\b(?:pos|debit|credit|purchase|card|checkcard|check card|visa|mastercard|mc|amex|ach|online|payment|pending|withdrawal|deposit|transfer|transaction|txn|dbt|pmt)\b/g,
      " ",
    )
    .replace(/\b(?:check|chk|check no|checknum)\b/g, " ")
    .replace(/\b(?:web|ppd|ccd|tel|same day|orig co name|orig id)\b/g, " ")
    .replace(/\b(?:inc|llc|l l c|corp|corporation|co|company|ltd)\b/g, " ")
    .replace(/\b(?:marketplace|market place)\b/g, " ")
    .replace(/\b(?:com)\b/g, " ")
    .replace(/\b(?:digital svcs|digital services)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseHighSignalAliases(value: string): string {
  let text = value;

  // Government / tax families
  if (/\b(?:irs|eftps|usataxpymt|treas\s+tax|us\s+treasury)\b/.test(text)) {
    text = `${text} tax agency`;
  }

  // Payroll processor families
  if (/\b(?:adp|gusto|paychex|intuit\s+payroll|quickbooks\s+payroll)\b/.test(text)) {
    text = `${text} payroll processor`;
  }

  // Very small set of obvious merchant aliases
  text = text.replace(/\bamzn\b/g, "amazon");
  text = text.replace(/\bamazon marketplace\b/g, "amazon");
  text = text.replace(/\bqt\b/g, "quiktrip");

  return text.replace(/\s+/g, " ").trim();
}

function normalizeMerchantCore(payee: any): string {
  const cleaned = cleanText(payee);
  if (!cleaned) return "";

  return collapseHighSignalAliases(stripBankingNoise(stripReferenceNoise(cleaned)));
}

function normalizeMerchantContext(payee: any, memo?: any): string {
  const cleaned = cleanText(`${String(payee ?? "")} ${String(memo ?? "")}`);
  if (!cleaned) return "";

  return collapseHighSignalAliases(stripBankingNoise(stripReferenceNoise(cleaned)));
}

export function normalizeMerchant(payee: any, memo?: any): string {
  const core = normalizeMerchantCore(payee);
  const context = normalizeMerchantContext(payee, memo);

  if (core && context) {
    return core === context ? core : `${core} ${context}`.trim();
  }

  return core || context || "";
}

export function normalizeFreeText(value: any): string {
  return cleanText(value);
}

export function tokenizeMerchantText(payee: any, memo?: any): string[] {
  const core = normalizeMerchantCore(payee);
  const context = normalizeMerchantContext(payee, memo);
  const text = `${core} ${context}`.trim();

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
    "transaction",
    "transfer",
    "deposit",
    "withdrawal",
    "check",
    "test",
  ]);

  return Array.from(
    new Set(
      text
        .split(" ")
        .map((x) => x.trim())
        .filter((x) => x.length >= 2 && !stop.has(x)),
    ),
  );
}
