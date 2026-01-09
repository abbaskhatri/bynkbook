"use client";

import React from "react";

export function LedgerTableShell(props: {
  colgroup: React.ReactNode; // pass array of <col/> (we filter just in case)
  header: React.ReactNode;   // <tr>...
  addRow: React.ReactNode;   // <tr>...
  body: React.ReactNode;     // <tr>...
  footer: React.ReactNode;   // <tr>...
}) {
  const { colgroup, header, addRow, body, footer } = props;

  const safeCols = React.Children.toArray(colgroup).filter(
    (c) => typeof c !== "string" && typeof c !== "number"
  );

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-hidden rounded-lg border bg-white">
      <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed border-collapse">
          <colgroup>{safeCols}</colgroup>

          <thead className="sticky top-0 z-40 bg-slate-50">
            {header}
            {addRow}
          </thead>

          <tbody>{body}</tbody>

          <tfoot className="sticky bottom-0 z-20 bg-white border-t">
            {footer}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
