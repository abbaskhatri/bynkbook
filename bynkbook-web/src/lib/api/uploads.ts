import { apiFetch } from "@/lib/api/client";

export type CompleteUploadMode = "REVIEW_ONLY";

export type CompleteUploadOptions = {
  reviewOnly?: boolean;
  mode?: CompleteUploadMode;
};

export async function completeUpload(
  businessId: string,
  uploadId: string,
  options: CompleteUploadOptions = {},
) {
  return apiFetch(`/v1/businesses/${businessId}/uploads/complete`, {
    method: "POST",
    body: JSON.stringify({
      uploadId,
      ...options,
    }),
  });
}

export async function importBankStatementUpload(businessId: string, uploadId: string) {
  return apiFetch(`/v1/businesses/${businessId}/uploads/${uploadId}/import`, {
    method: "POST",
    body: "{}",
  });
}
