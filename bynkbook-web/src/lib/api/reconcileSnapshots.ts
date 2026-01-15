import { apiFetch } from "@/lib/api/client";

export type ReconcileSnapshotListItem = {
  id: string;
  month: string;
  bank_unmatched_count: number;
  bank_partial_count: number;
  bank_matched_count: number;
  entries_expected_count: number;
  entries_matched_count: number;
  revert_count: number;
  remaining_abs_cents: string;
  created_at: string;
  created_by_user_id: string;
};

export type ReconcileSnapshot = ReconcileSnapshotListItem & {
  business_id?: string;
  account_id?: string;
  bank_csv_s3_key?: string;
  matches_csv_s3_key?: string;
  audit_csv_s3_key?: string;
  bank_csv_sha256?: string | null;
  matches_csv_sha256?: string | null;
  audit_csv_sha256?: string | null;
  urls?: {
    bank?: string;
    matches?: string;
    audit?: string;
    expiresInSeconds?: number;
  } | null;
};

export async function listReconcileSnapshots(businessId: string, accountId: string): Promise<ReconcileSnapshotListItem[]> {
  const res: any = await apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/reconcile-snapshots`);
  return res?.items ?? [];
}

export async function createReconcileSnapshot(businessId: string, accountId: string, month: string): Promise<ReconcileSnapshot> {
  const res: any = await apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/reconcile-snapshots`, {
    method: "POST",
    body: JSON.stringify({ month }),
  });
  return res?.snapshot;
}

export async function getReconcileSnapshot(businessId: string, accountId: string, snapshotId: string): Promise<ReconcileSnapshot> {
  const res: any = await apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/reconcile-snapshots/${snapshotId}`);
  return res?.snapshot;
}

export async function getReconcileSnapshotExportUrl(
  businessId: string,
  accountId: string,
  snapshotId: string,
  kind: "bank" | "matches" | "audit"
): Promise<{ url: string; expiresInSeconds?: number }> {
  const res: any = await apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/reconcile-snapshots/${snapshotId}/exports/${kind}`
  );
  return { url: res?.url, expiresInSeconds: res?.expiresInSeconds };
}
