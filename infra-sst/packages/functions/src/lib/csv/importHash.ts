import { createHash } from "node:crypto";

export function normalizeDesc(s: string): string {
  return (s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function computeImportHash(args: {
  businessId: string;
  accountId: string;
  postedDate: string; // YYYY-MM-DD
  amountCents: string; // bigint as string
  description: string;
  parser: string;
  occurrence?: number; // 1-based occurrence for same date/amount/description/parser within a statement
}) {
  const key = [
    args.businessId,
    args.accountId,
    args.postedDate,
    args.amountCents,
    normalizeDesc(args.description),
    args.parser,
    ...(args.occurrence && args.occurrence > 1 ? [`occurrence:${args.occurrence}`] : []),
  ].join("|");

  return createHash("sha256").update(key, "utf8").digest("hex");
}
