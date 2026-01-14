import { useQuery } from "@tanstack/react-query";
import { listBusinesses } from "@/lib/api/businesses";

export function useBusinesses() {
  return useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });
}
