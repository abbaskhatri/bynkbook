import { useQuery } from "@tanstack/react-query";
import { getLedgerSummary } from "@/lib/api/ledgerSummary";

export function useLedgerSummary(params: {
  businessId: string | null;
  accountId: string | null;
  from: string;
  to: string;
}) {
  const { businessId, accountId, from, to } = params;

  return useQuery({
    queryKey: ["ledgerSummary", businessId, accountId, from, to],
    queryFn: () =>
      getLedgerSummary({
        businessId: businessId as string,
        accountId: accountId as string,
        from,
        to,
      }),
    enabled: !!businessId && !!accountId,

    // Match entries query behavior so summary cards do not flicker or
    // refetch aggressively while row-level changes settle in the background.
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });
}
