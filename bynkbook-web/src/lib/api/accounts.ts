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
  const rows = (res?.accounts ?? []) as any[];

  return rows.map((a) => ({
    ...a,
    opening_balance_cents: Number(a.opening_balance_cents ?? 0),
    opening_balance_date: String(a.opening_balance_date ?? ""),
    archived_at: a.archived_at ?? null,
  })) as Account[];
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
  const a: any = res?.account;
  if (!a) return a;
  return {
    ...a,
    opening_balance_cents: Number(a.opening_balance_cents ?? 0),
    opening_balance_date: String(a.opening_balance_date ?? ""),
    archived_at: a.archived_at ?? null,
  } as Account;
}

export async function patchAccountName(businessId: string, accountId: string, name: string): Promise<{ id: string; name: string }> {
  const res: any = await apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  const a: any = res?.account;
  if (!a) return a;
  return {
    ...a,
    opening_balance_cents: Number(a.opening_balance_cents ?? 0),
    opening_balance_date: String(a.opening_balance_date ?? ""),
    archived_at: a.archived_at ?? null,
  } as Account;
}

export async function patchAccount(
  businessId: string,
  accountId: string,
  patch: Partial<{
    name: string;
    type: AccountType;
    opening_balance_cents: number;
    opening_balance_date: string;
  }>,
): Promise<Account> {
  const res: any = await apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

  const a: any = res?.account;
  if (!a) return a;

  return {
    ...a,
    opening_balance_cents: Number(a.opening_balance_cents ?? 0),
    opening_balance_date: String(a.opening_balance_date ?? ""),
    archived_at: a.archived_at ?? null,
  } as Account;
}

export async function archiveAccount(businessId: string, accountId: string): Promise<void> {
  await apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/archive`, { method: "POST" });
}

export async function unarchiveAccount(businessId: string, accountId: string): Promise<void> {
  await apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/unarchive`, { method: "POST" });
}

export async function getAccountDeleteEligibility(
  businessId: string,
  accountId: string
): Promise<{ eligible: boolean; related_total: number }> {
  const res: any = await apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/delete-eligibility`);
  return {
    eligible: !!res?.eligible,
    related_total: Number(res?.related_total ?? 0),
  };
}

export async function deleteAccount(businessId: string, accountId: string): Promise<void> {
  await apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}`, { method: "DELETE" });
}
