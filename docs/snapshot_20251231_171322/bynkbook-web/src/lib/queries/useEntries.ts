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
  });
}
