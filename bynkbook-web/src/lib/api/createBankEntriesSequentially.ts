export type BankEntryResult = {
  bank_transaction_id: string;
  status: "CREATED" | "SKIPPED" | "FAILED";
  code?: string;
  [key: string]: unknown;
};

// Each entry gets its own server time budget. Never automatically retry an
// ambiguous write; preserve acknowledged results and refresh before retrying.
export async function createBankEntriesSequentially(
  ids: string[],
  create: (id: string) => Promise<unknown>,
  onResult: (result: BankEntryResult, completed: number) => void,
): Promise<BankEntryResult[]> {
  const results: BankEntryResult[] = [];
  for (const id of new Set(ids)) {
    const response = await create(id) as { results?: BankEntryResult[] };
    const result = response?.results?.find((item) => item.bank_transaction_id === id);
    if (!result || !["CREATED", "SKIPPED", "FAILED"].includes(result.status)) {
      throw new Error("Creation result could not be confirmed. Refresh before retrying.");
    }
    results.push(result);
    onResult(result, results.length);
  }
  return results;
}
