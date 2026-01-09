"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { inputH7 } from "@/components/primitives/tokens";

export function FilterBar(props: {
  searchValue: string;
  onSearchChange: (v: string) => void;
  right?: ReactNode;
  onReset?: () => void;
}) {
  const { searchValue, onSearchChange, right, onReset } = props;

  return (
    <div className="flex items-center gap-3 pl-0.5">
      {/* Do NOT use the generic Input component here (it has a thick 3px ring).
          We enforce canonical inputH7 for consistent focus + border thickness. */}
      <input
        className={[
          inputH7,
          "max-w-[15%]",
          "hover:border-slate-300",
        ].join(" ")}
        placeholder="Search payee..."
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      {onReset ? (
        <Button
          variant="outline"
          className="h-7 px-3 text-xs"
          onClick={onReset}
        >
          Reset
        </Button>
      ) : null}

      {right ? <div className="flex items-center gap-2 ml-auto">{right}</div> : null}
    </div>
  );
}
