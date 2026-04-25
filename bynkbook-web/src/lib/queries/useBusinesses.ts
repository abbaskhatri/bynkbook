import { useQuery } from "@tanstack/react-query";
import { listBusinesses } from "@/lib/api/businesses";

export function useBusinesses(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
    enabled: options?.enabled ?? true,
  });
}
