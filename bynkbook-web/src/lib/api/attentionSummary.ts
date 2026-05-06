import { apiFetch } from "@/lib/api/client";

export type AttentionSummary = {
  ok: true;
  issue_count: number;
  uncategorized_count: number;
  bank_unmatched_count?: number | null;
};

export async function getAttentionSummary(params: {
  businessId: string;
  accountId: string;
}): Promise<AttentionSummary> {
  const { businessId, accountId } = params;
  const res: any = await apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/attention-summary`,
    { method: "GET" }
  );

  const summary: AttentionSummary = {
    ok: true,
    issue_count: Number(res?.issue_count ?? 0) || 0,
    uncategorized_count: Number(res?.uncategorized_count ?? 0) || 0,
  };

  if (res?.bank_unmatched_count !== undefined) {
    summary.bank_unmatched_count =
      res.bank_unmatched_count === null ? null : Number(res.bank_unmatched_count) || 0;
  }

  return summary;
}
