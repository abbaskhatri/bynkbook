import { apiFetch } from "@/lib/api/client";

export async function importBankStatementUpload(businessId: string, uploadId: string) {
  return apiFetch(`/v1/businesses/${businessId}/uploads/${uploadId}/import`, {
    method: "POST",
    body: "{}",
  });
}
