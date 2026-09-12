"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Bounded card pages, shared by the mobile ledger and reconciliation. */
export function MobileRecordList<T>({ items, renderItem, hasMore, loading, onLoadMore }: {
  items: T[];
  renderItem: (item: T) => ReactNode;
  hasMore?: boolean;
  loading?: boolean;
  onLoadMore?: () => void;
}) {
  const [requestedPage, setPage] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const size = 25;
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(requestedPage, pages - 1);
  function move(next: number) {
    setPage(next);
    top.current?.scrollIntoView({ block: "start" });
    top.current?.focus({ preventScroll: true });
  }
  return (
    <div ref={top} tabIndex={-1} className="space-y-2 scroll-mt-20 outline-none">
      {items.slice(page * size, (page + 1) * size).map(renderItem)}
      {items.length > 0 || hasMore ? (
        <nav aria-label="Record pages" className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span role="status" className="text-xs text-bb-text-muted">
            {items.length ? page * size + 1 : 0}–{Math.min((page + 1) * size, items.length)} of {items.length}{hasMore ? "+" : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11" disabled={page === 0} onClick={() => move(page - 1)}>Previous</Button>
            {page < pages - 1 ? (
              <Button variant="outline" className="min-h-11" onClick={() => move(page + 1)}>Next</Button>
            ) : hasMore ? (
              <Button variant="outline" className="min-h-11" disabled={loading} onClick={onLoadMore}>{loading ? "Loading…" : "Load more"}</Button>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
