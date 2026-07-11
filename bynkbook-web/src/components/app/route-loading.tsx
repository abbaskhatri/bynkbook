import { Skeleton } from "@/components/ui/skeleton";

export function RouteLoading({ label = "Loading page" }: { label?: string }) {
  return (
    <div className="min-h-[18rem] space-y-4 p-4 md:p-5" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-56 w-full" />
    </div>
  );
}
