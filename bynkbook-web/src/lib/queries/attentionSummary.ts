import { issueCountKey } from "@/lib/queries/issueKeys";

export function attentionSummaryKey(
  businessId: string | null | undefined,
  accountId: string | null | undefined
) {
  return [...issueCountKey(businessId, accountId, "OPEN"), "attentionSummary"] as const;
}
