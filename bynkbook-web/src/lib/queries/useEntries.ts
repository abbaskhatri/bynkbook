import { useQuery } from "@tanstack/react-query";
import { listEntries } from "@/lib/api/entries";

export function useEntries(params: {
  businessId: string | null;
  accountId: string | null;
  limit: number;
  includeDeleted?: boolean;
}) {
  const { businessId, accountId, limit, includeDeleted } = params;

  return useQuery({
    queryKey: ["entries", businessId, accountId, limit, !!includeDeleted],
    queryFn: () =>
      listEntries({
        businessId: businessId as string,
        accountId: accountId as string,
        limit,
        includeDeleted: !!includeDeleted,
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