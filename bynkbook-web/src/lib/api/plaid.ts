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
    mask?: string;
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

export async function plaidDisconnect(businessId: string, accountId: string) {
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/plaid/disconnect`, {
    method: "DELETE",
  });
}

export async function plaidSync(businessId: string, accountId: string) {
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/plaid/sync`, {
    method: "POST",
    body: "{}",
  });
}

export async function plaidPreviewOpening(
  businessId: string,
  accountId: string,
  body: { effectiveStartDate: string }
) {
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/plaid/preview-opening`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function plaidApplyOpening(
  businessId: string,
  accountId: string,
  body: { choice: "APPLY_PLAID" | "KEEP_MANUAL" | "CANCEL"; effectiveStartDate: string; suggestedOpeningCents?: string }
) {
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/plaid/apply-opening`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function plaidChangeOpeningDate(
  businessId: string,
  accountId: string,
  body: { effectiveStartDate: string; confirmPrune?: boolean }
) {
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/plaid/change-opening-date`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// New-account Plaid flow (review before create)
export async function plaidLinkTokenBusiness(businessId: string) {
  return apiFetch(`/v1/businesses/${businessId}/plaid/link-token`, {
    method: "POST",
    body: "{}",
  });
}

export async function plaidCreateAccount(businessId: string, body: {
  public_token: string;
  plaidAccountId: string;
  effectiveStartDate: string; // YYYY-MM-DD
  endDate?: string;
  institution?: { name?: string; institution_id?: string };
  mask?: string;
  name: string;
  type: string;
}) {
  return apiFetch(`/v1/businesses/${businessId}/plaid/create-account`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
