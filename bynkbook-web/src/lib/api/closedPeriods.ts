import { apiFetch } from "./client";

export type ClosedPeriodRow = {
  month: string; // YYYY-MM
  closed_at: string;
  closed_by_user_id: string;
};

export async function listClosedPeriods(businessId: string): Promise<{ ok: true; periods: ClosedPeriodRow[] }> {
  return apiFetch(`/v1/businesses/${businessId}/closed-periods`);
}

export async function closePeriod(businessId: string, month: string): Promise<any> {
  return apiFetch(`/v1/businesses/${businessId}/closed-periods`, {
    method: "POST",
    body: JSON.stringify({ month }),
  });
}

export async function reopenPeriod(businessId: string, month: string): Promise<any> {
  return apiFetch(`/v1/businesses/${businessId}/closed-periods/${encodeURIComponent(month)}`, {
    method: "DELETE",
  });
}

export async function previewClosedPeriods(args: {
  businessId: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  accountId: string; // "all" or UUID
}) {
  const q = new URLSearchParams({
    from: args.from,
    to: args.to,
    accountId: args.accountId ?? "all",
  }).toString();

  return apiFetch(`/v1/businesses/${args.businessId}/closed-periods/preview?${q}`);
}
