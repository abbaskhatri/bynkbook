import { apiFetch } from "@/lib/api/client";

export async function plaidLinkToken(businessId: string, accountId: string) {
  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/plaid/link-token`,
    { method: "POST", body: "{}" }
  );
}

export async function plaidExchange(
  businessId: string,
  accountId: string,
  body: {
    public_token: string;
    plaidAccountId: string;
    effectiveStartDate: string;
    endDate?: string; // optional YYYY-MM-DD
    institution?: { name?: string; institution_id?: string };
  }
) {
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/plaid/exchange`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function plaidStatus(businessId: string, accountId: string) {
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/plaid/status`, {
    method: "GET",
  });
}

export async function plaidSync(businessId: string, accountId: string) {
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/plaid/sync`, {
    method: "POST",
    body: "{}",
  });
}
