import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { loadEntriesForQuery, type EntryList } from "@/lib/api/entries";
import { keepScopedData } from "./keepScopedData";
import { FINANCIAL_STALE_TIME } from "./financialFreshness";

export function useEntries(params: {
  businessId: string | null;
  accountId: string | null;
  limit: number;
  pageCount?: number;
  includeDeleted?: boolean;
  search?: string;
  date_from?: string;
  date_to?: string;
  uncategorized?: boolean;
  excludeOpening?: boolean;
  unmatchedOnly?: boolean;
}) {
  const { businessId, accountId, limit, pageCount, includeDeleted, search, date_from, date_to, uncategorized, excludeOpening, unmatchedOnly } = params;

  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["entries", businessId, accountId, limit, !!includeDeleted, search ?? "", date_from ?? "", date_to ?? "", 1, !!uncategorized, !!excludeOpening, !!unmatchedOnly],
    queryFn: async ({ signal, queryKey }) => {
      const state = client.getQueryState<EntryList>(queryKey);
      return loadEntriesForQuery({ businessId: businessId!, accountId: accountId!, limit,
        pageCount, includeDeleted: !!includeDeleted, search, date_from, date_to,
        uncategorized, excludeOpening, unmatchedOnly, signal }, state?.data, state?.isInvalidated);
    },
    enabled: !!businessId && !!accountId,

    // Align entries with app-wide query discipline so page revisits,
    // focus changes, and small follow-up refreshes do not feel heavy.
    staleTime: FINANCIAL_STALE_TIME,
    gcTime: 10 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,

    // Keep last-good rows visible while a background refresh resolves.
    placeholderData: keepScopedData({ 1: businessId, 2: accountId }),
  });
  const loadedPages = query.data?.meta?.loadedPages ?? 1;
  const hasMore = query.data?.meta?.hasMore;
  const { refetch } = query;
  useEffect(() => {
    if ((pageCount ?? 1) > loadedPages && hasMore) void refetch({ cancelRefetch: false });
  }, [pageCount, loadedPages, hasMore, refetch, query.dataUpdatedAt]);
  return query;
}
