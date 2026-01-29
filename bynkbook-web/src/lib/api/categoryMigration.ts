import { apiFetch } from "./client";

export type MigrationPreviewRow = {
  memoValue: string;
  count: number;
  sampleEntryIds: string[];
  existingCategoryId: string | null;
  existingCategoryName: string | null;
};

export type MigrationPreviewResponse = {
  ok: true;
  accountId: string;
  minCount: number;
  rows: MigrationPreviewRow[];
};

export async function getCategoryMigrationPreview(
  businessId: string,
  opts: { accountId: string; minCount?: number }
): Promise<MigrationPreviewResponse> {
  const qs = new URLSearchParams({
    accountId: opts.accountId ?? "all",
    minCount: String(opts.minCount ?? 2),
  }).toString();

  return apiFetch(`/v1/businesses/${businessId}/category-migration/preview?${qs}`);
}

export type ApplyMapping = { memoValue: string; categoryName: string };

export type MigrationApplyResult = {
  memoValue: string;
  ok: boolean;
  dryRun?: boolean;
  wouldUpdate?: number;
  updatedCount?: number;
  categoryId?: string | null;
  categoryName?: string;
  error?: string;
};

export type MigrationApplyResponse = {
  ok: true;
  dryRun: boolean;
  accountId: string;
  results: MigrationApplyResult[];
};

export async function postCategoryMigrationApply(
  businessId: string,
  body: { accountId: string; dryRun: boolean; mappings: ApplyMapping[] }
): Promise<MigrationApplyResponse> {
  return apiFetch(`/v1/businesses/${businessId}/category-migration/apply`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
