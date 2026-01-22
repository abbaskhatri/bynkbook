import { apiFetch } from "@/lib/api/client";

export type ActivityLogItem = {
  id: string;
  created_at: string;
  event_type: string;
  actor_user_id: string;
  business_id: string;
  scope_account_id: string | null;
  payload_json: any;
};

export async function getActivity(
  businessId: string,
  params?: { limit?: number; before?: string; eventType?: string; actorUserId?: string; accountId?: string }
): Promise<{ items: ActivityLogItem[] }> {
  const q = new URLSearchParams();
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.before) q.set("before", params.before);
  if (params?.eventType) q.set("event_type", params.eventType);
  if (params?.actorUserId) q.set("actor_user_id", params.actorUserId);
  if (params?.accountId) q.set("account_id", params.accountId);

  const qs = q.toString();
  return apiFetch(`/v1/businesses/${businessId}/activity${qs ? `?${qs}` : ""}`);
}
