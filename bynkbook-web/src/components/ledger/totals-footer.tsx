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
  canPrev: boolean;
  canNext: boolean;

  incomeText: ReactNode;
  expenseText: ReactNode;
  netText: ReactNode;
  balanceText: ReactNode;
}) {
  const {
    rowsPerPage,
    setRowsPerPage,
    page,
    setPage,
    totalPages,
    canPrev,
    canNext,
    incomeText,
    expenseText,
    netText,
    balanceText,
  } = props;

  const navBtnClass = iconButtonH7;

  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-600">
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
            <SelectItem value="500">500</SelectItem>
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

        <div className="min-w-[92px] text-center text-xs">
          Page {page} of {totalPages}
        </div>

        <Button
          variant="outline"
          className={navBtnClass}
          disabled={!canNext}
          onClick={() => setPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Right: totals */}
      <div className="flex items-center gap-6 text-xs tabular-nums">
        <div>
          <span className="mr-1">Income:</span>
          <span className="font-semibold text-emerald-700">{incomeText}</span>
        </div>

        <div>
          <span className="mr-1">Expense:</span>
          <span className="font-semibold text-red-700">{expenseText}</span>
        </div>

        <div>
          <span className="mr-1">Net:</span>
          <span className="font-semibold">{netText}</span>
        </div>

        <div>
          <span className="mr-1">Balance:</span>
          <span className="font-semibold">{balanceText}</span>
        </div>
      </div>
    </div>
  );
}
