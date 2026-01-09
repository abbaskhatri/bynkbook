"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ringFocus } from "@/components/primitives/tokens";

export function CapsuleSelect(props: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  loading?: boolean;
  includeAllOption?: boolean;
  allLabel?: string;
}) {
  const {
    value,
    onValueChange,
    options,
    placeholder,
    loading,
    includeAllOption,
    allLabel = "All Accounts",
  } = props;

  // Match Phase 3 height standards so text is never clipped.
  if (loading) return <Skeleton className="h-7 w-44 rounded-full" />;

   // pill shape + consistent height + no clipping
  const capsuleTriggerClass =
  "!h-[28px] !min-h-0 w-auto rounded-full bg-white border border-slate-200 px-3 !py-0 " +
  "text-xs leading-tight inline-flex items-center justify-between gap-2 " +
  ringFocus;

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={capsuleTriggerClass}>
        <SelectValue
          className="truncate max-w-[320px] leading-tight"
          placeholder={placeholder}
        />
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
