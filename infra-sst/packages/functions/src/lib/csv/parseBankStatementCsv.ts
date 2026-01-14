import { matchesBoa, parseBoa } from "./adapters/boa";

export type ParsedCsvRow = {
  postedDate: string; // YYYY-MM-DD
  description: string;
  amountCents: bigint;
  sourceRowIndex: number;
  raw: Record<string, any>;
};

export type ParsedStatement = {
  parser: string; // BANK_OF_AMERICA, etc.
  rows: ParsedCsvRow[];
};

export function parseBankStatementCsv(text: string): ParsedStatement {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\uFEFF/g, "")); // strip BOM if present

  if (matchesBoa(lines)) return parseBoa(lines);

  // Fail-safe
  throw new Error("UNKNOWN_FORMAT");
}
