import { apiFetch } from "@/lib/api/client";

export type AccountType = "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "CASH" | "OTHER";

export type Account = {
  id: string;
  business_id: string;
  name: string;
  type: AccountType;
  opening_balance_cents: number;
  opening_balance_date: string;
  archived_at: string | null;
  created_at?: string;
  updated_at?: string;
};

export async function listAccounts(businessId: string): Promise<Account[]> {
  const res: any = await apiFetch(`/v1/businesses/${businessId}/accounts`);
  return res?.accounts ?? [];
}

export async function createAccount(
  businessId: string,
  input: {
    name: string;
    type: AccountType;
    opening_balance_cents: number;
    opening_balance_date: string; // ISO date/time string
  }
): Promise<Account> {
  const res: any = await apiFetch(`/v1/businesses/${businessId}/accounts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res?.account;
}
