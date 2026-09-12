"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";

export type UploadListItem = {
  id: string;
  business_id: string;
  account_id: string | null;
  upload_type: string;
  original_filename: string;
  content_type: string;
  size_bytes: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  meta: any;
};

export function useUploadsList(args: {
  businessId: string;
  accountId?: string;
  type?: string;
  vendorId?: string;
  limit?: number;
}) {
  const { businessId, accountId, type, vendorId, limit = 10 } = args;
  const query = useQuery({
    queryKey: ["uploads", businessId, accountId ?? "", type ?? "", vendorId ?? "", limit],
    enabled: !!businessId,
    staleTime: 15_000,
    queryFn: async ({ signal }): Promise<UploadListItem[]> => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (type) qs.set("type", type);
      if (accountId) qs.set("accountId", accountId);
      if (vendorId) qs.set("vendorId", vendorId);
      const res = await apiFetch(`/v1/businesses/${businessId}/uploads?${qs}`, { signal });
      if (!res?.ok) throw new Error(res?.error || "Failed to load uploads");
      return res.items ?? [];
    },
  });
  return {
    items: businessId ? query.data ?? [] : [],
    loading: query.isFetching,
    error: query.error?.message ?? null,
    refetch: async () => { if (businessId) await query.refetch(); },
  };
}
