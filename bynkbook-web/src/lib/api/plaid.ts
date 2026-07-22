import { apiFetch } from "@/lib/api/client";

export async function plaidLinkToken(
  businessId: string,
  accountId: string,
  options?: { listOptions?: boolean; sourceAccountId?: string },
) {
  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/plaid/link-token`,
    { method: "POST", body: JSON.stringify(options ?? {}) }
  );
}

export async function plaidReconnectLinkToken(businessId: string, accountId: string) {
  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/plaid/link-token`,
    { method: "POST", body: JSON.stringify({ mode: "update" }) }
  );
}

export async function plaidExchange(
  businessId: string,
  accountId: string,
  body: {
    public_token: string;
    plaidAccountId: string;
    effectiveStartDate?: string;
    endDate?: string; // optional YYYY-MM-DD
    institution?: { name?: string; institution_id?: string };
    mask?: string;
    additionalAccounts?: Array<{
      plaidAccountId: string;
      name: string;
      type?: string;
      subtype?: string;
      mask?: string;
      effectiveStartDate?: string;
    }>;
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

export async function plaidRepairAccount(
  businessId: string,
  accountId: string,
  body: {
    plaidAccountId: string;
    sourceAccountId?: string;
    institution?: { name?: string; institution_id?: string };
    mask?: string;
    additionalAccounts?: Array<{
      plaidAccountId: string;
      name: string;
      type?: string;
      subtype?: string;
      mask?: string;
      effectiveStartDate?: string;
    }>;
  }
) {
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/plaid/repair-account`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function plaidDisconnect(businessId: string, accountId: string) {
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/plaid/disconnect`, {
    method: "DELETE",
  });
}

export async function plaidSync(
  businessId: string,
  accountId: string,
  options?: { afterReconnect?: boolean; refreshBalance?: boolean; refreshTransactions?: boolean },
) {
  const totals = {
    newCount: 0,
    upgradedCount: 0,
    duplicateCount: 0,
    skippedHistoricalCount: 0,
    skippedRemovedCount: 0,
    replacementUpgradeCount: 0,
    protectedMatchedRemovalCount: 0,
    restoredMatchedHistoryCount: 0,
    retentionPrunedCount: 0,
    pages: 0,
    totalSeen: 0,
  };
  let result: any = null;
  const maxContinuationCalls = 10;

  for (let pass = 0; pass < maxContinuationCalls; pass += 1) {
    result = await apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/plaid/sync`, {
      method: "POST",
      // The Lambda has a 45-second ceiling and a real-time institution balance
      // check can legitimately take more than the API client's 30-second default.
      timeoutMs: 55_000,
      body: JSON.stringify({
        afterReconnect: pass === 0 && options?.afterReconnect === true,
        forceBalanceRefresh: pass === 0 && options?.refreshBalance === true,
        forceRefresh: pass === 0 && options?.refreshTransactions === true,
      }),
    });

    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      totals[key] += Number(result?.[key] ?? 0);
    }

    if (result?.syncInProgress) break;
    if (!result?.drainIncomplete && !result?.hasMore) break;
  }

  const drainIncomplete = Boolean(result?.drainIncomplete || result?.hasMore);
  return {
    ...result,
    ...totals,
    capped: drainIncomplete,
    hasMore: drainIncomplete,
    drainIncomplete,
  };
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
  additionalAccounts?: Array<{
    plaidAccountId: string;
    name: string;
    type?: string;
    subtype?: string;
    mask?: string;
    effectiveStartDate?: string;
  }>;
}) {
  return apiFetch(`/v1/businesses/${businessId}/plaid/create-account`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
