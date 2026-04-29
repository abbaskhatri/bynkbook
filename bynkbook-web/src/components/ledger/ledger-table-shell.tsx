"use client";

/**
 * ================================
 * SECTION: LedgerTableShell
 * - Sticky header
 * - Sticky add-row
 * - Body scrolls vertically
 * - Table scrolls horizontally after its declared column minimums stop fitting
 * - Sticky footer
 * ================================
 */

import React from "react";

function widthToPixels(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed === "auto") return null;

  const px = trimmed.match(/^(\d+(?:\.\d+)?)px$/);
  if (px) return Number(px[1]);

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function declaredColumnWidth(node: React.ReactNode): number {
  return React.Children.toArray(node).reduce<number>((total, child) => {
    if (!React.isValidElement(child)) return total;

    if (child.type === React.Fragment) {
      return total + declaredColumnWidth((child.props as any).children);
    }

    const style = ((child.props as any).style ?? {}) as React.CSSProperties;
    const width = widthToPixels(style.width);
    const minWidth = widthToPixels(style.minWidth);

    return total + Math.max(width ?? 0, minWidth ?? 0);
  }, 0);
}

export function LedgerTableShell(props: {
  colgroup: React.ReactNode;
  header: React.ReactNode;
  addRow: React.ReactNode;
  body: React.ReactNode;
  footer: React.ReactNode;
  disableInnerScroll?: boolean;
  scrollMode?: "auto" | "visible";
  minWidth?: React.CSSProperties["minWidth"];
}) {
  const { colgroup, header, addRow, body, footer, disableInnerScroll, scrollMode, minWidth } = props;

  const safeCols = React.Children.toArray(colgroup).filter(
    (c) => typeof c !== "string" && typeof c !== "number"
  );
  const derivedMinWidth = declaredColumnWidth(colgroup);
  const tableMinWidth = minWidth ?? (derivedMinWidth > 0 ? `${Math.ceil(derivedMinWidth)}px` : undefined);

  const addRowChildren =
    React.isValidElement(addRow) && (addRow as any).props?.children
      ? (addRow as any).props.children
      : null;

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-hidden rounded-lg border border-bb-border bg-bb-surface-card">
      <div
        className={
          disableInnerScroll
            ? "overflow-x-auto"
            : scrollMode === "visible"
              ? "h-full min-h-0 overflow-y-visible overflow-x-auto"
              : "h-full min-h-0 overflow-y-auto overflow-x-auto"
        }
      >
        <table className="w-full table-fixed border-collapse" style={tableMinWidth ? { minWidth: tableMinWidth } : undefined}>
          <colgroup>{safeCols}</colgroup>

          <thead className="sticky top-0 z-40 bg-bb-table-header border-b border-bb-border">
            {header}
          </thead>

          <tbody>
            {addRowChildren ? (
              <tr className="sticky top-[28px] z-30 bg-primary/10 border-b-2 border-primary/20">
                {addRowChildren}
              </tr>
            ) : null}

            {body}
          </tbody>

          <tfoot className="sticky bottom-0 z-20 bg-bb-table-header border-t border-bb-border">
            {footer}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
