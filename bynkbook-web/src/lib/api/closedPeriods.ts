import { apiFetch } from "./client";

export type ClosedPeriodRow = {
  month: string; // YYYY-MM
  closed_at: string;
  closed_by_user_id: string;
};

export async function listClosedPeriods(businessId: string): Promise<{
  ok: true;
  periods: ClosedPeriodRow[];
  closed_through_month?: string | null;
  closed_through_date?: string | null;
}> {
  return apiFetch(`/v1/businesses/${businessId}/closed-periods`);
}

export async function closeThroughDate(businessId: string, through_date: string): Promise<any> {
  return apiFetch(`/v1/businesses/${businessId}/closed-periods/close-through`, {
    method: "POST",
    body: JSON.stringify({ through_date }),
  });
}

export async function reopenPeriod(businessId: string, month: string): Promise<any> {
  return apiFetch(`/v1/businesses/${businessId}/closed-periods/${encodeURIComponent(month)}`, {
    method: "DELETE",
  });
}

// Account-scoped preview (Ledger uses selected account)
export async function previewClosedPeriods(args: {
  businessId: string;
  accountId: string; // UUID (required)
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}) {
  const q = new URLSearchParams({
    from: args.from,
    to: args.to,
    accountId: args.accountId,
  }).toString();

  return apiFetch(`/v1/businesses/${args.businessId}/closed-periods/preview?${q}`);
}
