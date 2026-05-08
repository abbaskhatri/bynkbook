"use client";

import type { ReactNode } from "react";
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

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 text-xs text-bb-text-muted">
      {/* Left: rows + paging */}
      <div className="flex items-center gap-2">
        <span>Rows:</span>

        <Select
          value={String(rowsPerPage)}
          onValueChange={(v) => {
            const n = Number(v);
            setRowsPerPage(n);
            setPage(1);
          }}
        >
          <SelectTrigger className={`${inputH7} !h-7 !py-0 w-[70px]`}>
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

        <div className="min-w-[116px] text-center text-xs">
          {pageLabel ?? <>Page {page} of {totalPages}</>}
        </div>

        <Button
          variant="outline"
          className={`${navBtnClass} ${emphasizeNext && canNext ? "border-amber-300 bg-amber-50 text-amber-950 shadow-sm hover:bg-amber-100" : ""}`}
          disabled={!canNext}
          onClick={() => setPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {paginationNote ? (
          <div className="flex max-w-[540px] items-center gap-2 text-[11px] text-amber-700">
            <span className="truncate" title={typeof paginationNote === "string" ? paginationNote : undefined}>
              {paginationNote}
            </span>
            {paginationActionLabel && onPaginationAction ? (
              <button
                type="button"
                className="h-6 shrink-0 rounded-md border border-amber-300 bg-white px-2 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                onClick={onPaginationAction}
              >
                {paginationActionLabel}
              </button>
            ) : null}
          </div>
        ) : null}

        {loadMoreText ? (
          <Button
            variant="outline"
            className="h-7 rounded-md px-2 text-xs"
            disabled={!canLoadMore || isLoadingMore}
            onClick={() => onLoadMore?.()}
          >
            {loadMoreText}
          </Button>
        ) : null}
      </div>

      {/* Right: totals */}
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs tabular-nums">
        {totalsScopeLabel ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 items-center rounded-md border border-bb-border bg-bb-surface-card px-2 text-[11px] font-semibold text-bb-text">
              {totalsScopeLabel}
            </span>
            {totalsScopeNote ? (
              <span
                className="max-w-[320px] truncate text-[11px] text-bb-text-muted"
                title={typeof totalsScopeNote === "string" ? totalsScopeNote : undefined}
              >
                {totalsScopeNote}
              </span>
            ) : null}
          </div>
        ) : null}

        <div>
          <span className="mr-1">Income:</span>
          <span className="font-semibold text-bb-text">{incomeText}</span>
        </div>

        <div>
          <span className="mr-1">Expense:</span>
          <span className="font-semibold text-bb-amount-negative">{expenseText}</span>
        </div>

        <div>
          <span className="mr-1">Net:</span>
          <span className="font-semibold">{netText}</span>
        </div>

        <div>
          <span className="mr-1">{balanceLabel ?? "Balance"}:</span>
          <span className="font-semibold">{balanceText}</span>
        </div>
      </div>
    </div>
  );
}
