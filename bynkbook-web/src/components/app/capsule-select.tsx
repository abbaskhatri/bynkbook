"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ringFocus } from "@/components/primitives/tokens";
import { ChevronDown, Loader2, Wallet } from "lucide-react";

export function CapsuleSelect(props: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  loading?: boolean;
  includeAllOption?: boolean;
  allLabel?: string;
  variant?: "default" | "flat";
}) {
  const {
    value,
    onValueChange,
    options,
    placeholder,
    loading,
    includeAllOption,
    allLabel = "All Accounts",
    variant = "default",
  } = props;

  // Match Phase 3 height standards so text is never clipped.
  if (loading) return <Skeleton className="h-7 w-44 rounded-full" />;

  // pill shape + consistent height + no clipping
  // variant="default" keeps current look everywhere.
  // variant="flat" removes the inner white capsule chrome so the outer wrapper defines the pill.
  const capsuleTriggerClass =
    (variant === "flat"
      ? "!h-[28px] !min-h-0 w-auto bg-transparent border-0 shadow-none px-2 !py-0 "
      : "!h-[28px] !min-h-0 w-auto rounded-full bg-white border border-slate-200 px-3 !py-0 ") +
    // Hide any default trigger SVG (we render our own chevron)
    "[&>svg]:hidden " +
    "text-xs leading-tight inline-flex items-center justify-between gap-2 " +
    ringFocus;

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={capsuleTriggerClass}>
        <div className="flex items-center gap-2 min-w-0">
          {variant === "flat" ? <Wallet className="h-4 w-4 text-emerald-700 shrink-0" /> : null}
          <div className="min-w-0">
            <SelectValue placeholder={loading ? "Loading..." : placeholder} />
          </div>
        </div>

        {loading ? <Loader2 className="h-4 w-4 animate-spin opacity-60" /> : null}
      </SelectTrigger>

      <SelectContent>
        {includeAllOption ? <SelectItem value="all">{allLabel}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
