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
}) {
  const key = [
    args.businessId,
    args.accountId,
    args.postedDate,
    args.amountCents,
    normalizeDesc(args.description),
    args.parser,
  ].join("|");

  return createHash("sha256").update(key, "utf8").digest("hex");
}
