type ParsedRow = {
  postedDate: string; // YYYY-MM-DD
  description: string;
  amountCents: bigint;
  sourceRowIndex: number; // 1-based line number from the CSV file
  raw: Record<string, any>;
};

function parseDateMDY(s: string): string | null {
  // Supports M/D/YYYY or MM/DD/YYYY
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function parseAmountToCents(s: string): bigint | null {
  const t = (s ?? "").trim();
  if (!t) return null;

  // Handle parentheses accounting format
  const isParenNeg = t.startsWith("(") && t.endsWith(")");
  const cleaned = t.replace(/[(),$]/g, "").replace(/,/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;

  const cents = BigInt(Math.round(n * 100));
  return isParenNeg ? -cents : cents;
}

export function matchesBoa(lines: string[]): boolean {
  // Look for header line: Date,Description,Amount,Running Bal.
  return lines.some((ln) => ln.trim().toLowerCase() === "date,description,amount,running bal.");
}

export function parseBoa(lines: string[]) {
  const headerIdx = lines.findIndex((ln) => ln.trim().toLowerCase() === "date,description,amount,running bal.");
  if (headerIdx === -1) throw new Error("BOA CSV header not found");

  const rows: ParsedRow[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;

    const parts = line.split(",");
    if (parts.length < 3) continue;

    const dateRaw = parts[0] ?? "";
    const desc = parts[1] ?? "";
    const amountRaw = parts[2] ?? "";
    const runningBal = parts[3] ?? null;

    const postedDate = parseDateMDY(dateRaw);
    const amountCents = parseAmountToCents(amountRaw);

    if (!postedDate || amountCents === null) continue;

    rows.push({
      postedDate,
      description: desc.trim(),
      amountCents,
      sourceRowIndex: i + 1, // 1-based
      raw: {
        bank: "BANK_OF_AMERICA",
        columns: {
          Date: dateRaw,
          Description: desc,
          Amount: amountRaw,
          "Running Bal.": runningBal,
        },
      },
    });
  }

  return {
    parser: "BANK_OF_AMERICA",
    rows,
  };
}
