import * as React from "react";
import { surfaceCard } from "./tokens";

type LedgerTableShellProps = {
  header?: React.ReactNode;
  table?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

/**
 * Canonical shell for ledger-like tables.
 * This component must remain render-cheap (no render-time sorting/filtering/detection).
 * It is a structural wrapper only.
 */
export function LedgerTableShell({ header, table, footer, className }: LedgerTableShellProps) {
  return (
    <section className={[surfaceCard, "w-full overflow-hidden", className].filter(Boolean).join(" ")}>
      {header ? <div className="px-3 pt-3">{header}</div> : null}

      <div className="w-full overflow-x-auto">
        {table ? table : null}
      </div>

      {footer ? <div className="px-3 pb-3 pt-2">{footer}</div> : null}
    </section>
  );
}
