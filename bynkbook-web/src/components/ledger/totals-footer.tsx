"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { inputH7, iconButtonH7 } from "@/components/primitives/tokens";

export function TotalsFooter(props: {
  rowsPerPage: number;
  setRowsPerPage: (n: number) => void;

  page: number;
  setPage: (n: number) => void;

  totalPages: number;
  pageLabel?: ReactNode;
  paginationNote?: ReactNode;
  paginationActionLabel?: ReactNode;
  onPaginationAction?: () => void;
  emphasizeNext?: boolean;
  loadMoreText?: ReactNode;
  onLoadMore?: () => void;
  canLoadMore?: boolean;
  isLoadingMore?: boolean;
  /**
   * When true, automatically calls onLoadMore() as soon as the Load-More
   * button scrolls into view (infinite scroll). The button stays visible
   * as a fallback while the next page is loading and as a manual
   * trigger if the observer ever misses.
   */
  autoLoadMore?: boolean;
  canPrev: boolean;
  canNext: boolean;

  incomeText: ReactNode;
  expenseText: ReactNode;
  netText: ReactNode;
  balanceText: ReactNode;
  totalsScopeLabel?: ReactNode;
  totalsScopeNote?: ReactNode;
  balanceLabel?: ReactNode;
}) {
  const {
    rowsPerPage,
    setRowsPerPage,
    page,
    setPage,
    totalPages,
    pageLabel,
    paginationNote,
    paginationActionLabel,
    onPaginationAction,
    emphasizeNext,
    loadMoreText,
    onLoadMore,
    canLoadMore,
    isLoadingMore,
    autoLoadMore,
    canPrev,
    canNext,
    incomeText,
    expenseText,
    netText,
    balanceText,
    totalsScopeLabel,
    totalsScopeNote,
    balanceLabel,
  } = props;

  const navBtnClass = iconButtonH7;

  // Infinite scroll: when autoLoadMore is on, observe the Load-More button
  // and fire onLoadMore once it enters the viewport. Guards prevent the
  // observer from re-firing while a fetch is in-flight, and re-arm when
  // the button leaves the viewport so we only trigger on fresh enters.
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const firedForCurrentVisitRef = useRef(false);
  useEffect(() => {
    if (!autoLoadMore) return;
    if (!loadMoreText) return;
    const target = loadMoreRef.current;
    if (!target) return;
    if (typeof IntersectionObserver === "undefined") return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) {
            firedForCurrentVisitRef.current = false;
            continue;
          }
          if (firedForCurrentVisitRef.current) continue;
          if (!canLoadMore) continue;
          if (isLoadingMore) continue;
          firedForCurrentVisitRef.current = true;
          onLoadMore?.();
        }
      },
      { rootMargin: "200px" }
    );
    obs.observe(target);
    return () => obs.disconnect();
  }, [autoLoadMore, loadMoreText, canLoadMore, isLoadingMore, onLoadMore]);

  return (
    <div className="flex min-w-0 items-center gap-3 overflow-x-auto px-3 py-2 text-xs text-bb-text-muted sm:px-4">
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        <span>Rows:</span>

        <Select
          value={String(rowsPerPage)}
          onValueChange={(v) => {
            const n = Number(v);
            setRowsPerPage(n);
            setPage(1);
          }}
        >
          <SelectTrigger className={`${inputH7} !h-7 !py-0 w-16`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="top" align="start">
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
            <SelectItem value="200">200</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          className={navBtnClass}
          disabled={!canPrev}
          onClick={() => setPage(Math.max(1, page - 1))}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-[116px] text-center text-xs whitespace-nowrap">
          {pageLabel ?? <>Page {page} of {totalPages}</>}
        </div>

        <Button
          variant="outline"
          className={`${navBtnClass} ${emphasizeNext && canNext ? "border-bb-border bg-bb-surface-elevated text-bb-text shadow-sm hover:bg-bb-table-row-hover" : ""}`}
          disabled={!canNext}
          onClick={() => setPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {paginationNote ? (
        <div className="flex min-w-0 max-w-[420px] items-center gap-2 text-[11px] text-bb-text-muted">
          <span
            className="min-w-0 truncate"
            title={typeof paginationNote === "string" ? paginationNote : undefined}
          >
            {paginationNote}
          </span>
          {paginationActionLabel && onPaginationAction ? (
            <button
              type="button"
              className="h-6 shrink-0 rounded-md border border-bb-border bg-bb-surface-card px-2 text-[11px] font-medium text-bb-text hover:bg-bb-table-row-hover"
              onClick={onPaginationAction}
            >
              {paginationActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      {loadMoreText ? (
        <div ref={loadMoreRef} className="shrink-0">
          <Button
            variant="outline"
            className="h-7 rounded-md px-2 text-xs"
            disabled={!canLoadMore || isLoadingMore}
            onClick={() => onLoadMore?.()}
          >
            {isLoadingMore ? "Loading…" : loadMoreText}
          </Button>
        </div>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-3 border-l border-bb-border/70 pl-3 text-right text-xs tabular-nums">
        {totalsScopeLabel ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 items-center rounded-md border border-bb-border bg-bb-surface-card px-2 text-[11px] font-semibold text-bb-text">
              {totalsScopeLabel}
            </span>
            {totalsScopeNote ? (
              <span
                className="max-w-[260px] truncate text-[11px] text-bb-text-muted"
                title={typeof totalsScopeNote === "string" ? totalsScopeNote : undefined}
              >
                {totalsScopeNote}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="whitespace-nowrap">
          <span className="mr-1">Income:</span>
          <span className="font-semibold text-bb-text">{incomeText}</span>
        </div>

        <div className="whitespace-nowrap">
          <span className="mr-1">Expense:</span>
          <span className="font-semibold text-bb-amount-negative">{expenseText}</span>
        </div>

        <div className="whitespace-nowrap">
          <span className="mr-1">Net:</span>
          <span className="font-semibold">{netText}</span>
        </div>

        <div className="whitespace-nowrap">
          <span className="mr-1">{balanceLabel ?? "Balance"}:</span>
          <span className="font-semibold">{balanceText}</span>
        </div>
      </div>
    </div>
  );
}
