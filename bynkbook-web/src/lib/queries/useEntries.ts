import { useQuery } from "@tanstack/react-query";
import { listEntries } from "@/lib/api/entries";

export function useEntries(params: {
  businessId: string | null;
  accountId: string | null;
  limit: number;
  pageCount?: number;
  includeDeleted?: boolean;
  date_from?: string;
  date_to?: string;
}) {
  const { businessId, accountId, limit, pageCount, includeDeleted, date_from, date_to } = params;

  return useQuery({
    queryKey: ["entries", businessId, accountId, limit, !!includeDeleted, date_from ?? "", date_to ?? "", pageCount ?? 1],
    queryFn: () =>
      listEntries({
        businessId: businessId as string,
        accountId: accountId as string,
        limit,
        pageCount: pageCount ?? 1,
        includeDeleted: !!includeDeleted,
        date_from,
        date_to,
      }),
    enabled: !!businessId && !!accountId,

    // Align entries with app-wide query discipline so page revisits,
    // focus changes, and small follow-up refreshes do not feel heavy.
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,

    // Keep last-good rows visible while a background refresh resolves.
    placeholderData: (prev) => prev,
  });
}
