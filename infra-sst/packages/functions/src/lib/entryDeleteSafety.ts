import { normalizeToYmd } from "./closedPeriods";

export const ENTRY_MATCHED_REQUIRES_UNMATCH = "ENTRY_MATCHED_REQUIRES_UNMATCH";

const MATCHED_DELETE_MESSAGE =
  "This entry is matched to a bank transaction. Unmatch or revert the match before deleting it.";

function centsToString(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  const s = String(value).trim();
  return s || null;
}

function matchedDelete409(details: {
  matchGroupId: string;
  bankTransaction?: {
    id: string;
    date: string | null;
    name: string | null;
    amount_cents: string | null;
  } | null;
}) {
  return {
    statusCode: 409,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: false,
      code: ENTRY_MATCHED_REQUIRES_UNMATCH,
      error: ENTRY_MATCHED_REQUIRES_UNMATCH,
      message: MATCHED_DELETE_MESSAGE,
      matchGroupId: details.matchGroupId,
      bankTransaction: details.bankTransaction ?? null,
    }),
  };
}

export async function assertEntryNotActiveMatchedForDelete(args: {
  prisma: any;
  businessId: string;
  accountId: string;
  entryId: string;
}): Promise<{ ok: true } | { ok: false; response: any }> {
  const entryLink = await args.prisma.matchGroupEntry.findFirst({
    where: {
      business_id: args.businessId,
      account_id: args.accountId,
      entry_id: args.entryId,
      matchGroup: { status: "ACTIVE" },
    },
    select: { match_group_id: true },
  });

  const matchGroupId = String(entryLink?.match_group_id ?? "").trim();
  if (!matchGroupId) return { ok: true };

  const bankLink = await args.prisma.matchGroupBank.findFirst({
    where: {
      business_id: args.businessId,
      account_id: args.accountId,
      match_group_id: matchGroupId,
    },
    select: { bank_transaction_id: true },
  });

  const bankTransactionId = String(bankLink?.bank_transaction_id ?? "").trim();
  const bankTransaction = bankTransactionId
    ? await args.prisma.bankTransaction.findFirst({
        where: {
          id: bankTransactionId,
          business_id: args.businessId,
          account_id: args.accountId,
        },
        select: {
          id: true,
          posted_date: true,
          name: true,
          amount_cents: true,
        },
      })
    : null;

  return {
    ok: false,
    response: matchedDelete409({
      matchGroupId,
      bankTransaction: bankTransaction
        ? {
            id: String(bankTransaction.id),
            date: normalizeToYmd(bankTransaction.posted_date),
            name: bankTransaction.name ? String(bankTransaction.name) : null,
            amount_cents: centsToString(bankTransaction.amount_cents),
          }
        : null,
    }),
  };
}
