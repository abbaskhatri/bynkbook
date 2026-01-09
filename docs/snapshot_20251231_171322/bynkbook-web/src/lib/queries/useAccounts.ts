import { useQuery } from "@tanstack/react-query";
import { listAccounts } from "@/lib/api/accounts";

export function useAccounts(businessId: string | null) {
  return useQuery({
    queryKey: ["accounts", businessId],
    queryFn: () => listAccounts(businessId as string),
    enabled: !!businessId,
  });
}
