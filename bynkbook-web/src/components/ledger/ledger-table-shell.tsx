"use client";

/**
 * ================================
 * SECTION: LedgerTableShell
 * - Sticky header
 * - Sticky add-row
 * - Body scroll only
 * - NO horizontal scroll (required)
 * - Sticky footer
 * ================================
 */

import React from "react";

export function LedgerTableShell(props: {
  colgroup: React.ReactNode;
  header: React.ReactNode;
  addRow: React.ReactNode;
  body: React.ReactNode;
  footer: React.ReactNode;
}) {
  const { colgroup, header, addRow, body, footer } = props;

  const safeCols = React.Children.toArray(colgroup).filter(
    (c) => typeof c !== "string" && typeof c !== "number"
  );

  const addRowChildren =
    React.isValidElement(addRow) && (addRow as any).props?.children
      ? (addRow as any).props.children
      : null;

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-hidden rounded-lg border bg-white">
      {/* IMPORTANT: no horizontal scroll */}
      <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed border-collapse">
          <colgroup>{safeCols}</colgroup>

          <thead className="sticky top-0 z-40 bg-slate-50 border-b border-slate-200">
            {header}
          </thead>

          <tbody>
            {addRowChildren ? (
              <tr className="sticky top-[28px] z-30 bg-emerald-50 border-b-2 border-emerald-200">
                {addRowChildren}
              </tr>
            ) : null}

            {body}
          </tbody>

          <tfoot className="sticky bottom-0 z-20 bg-slate-50 border-t border-slate-200">
            {footer}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
