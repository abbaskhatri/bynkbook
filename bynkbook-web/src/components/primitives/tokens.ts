// Canonical UI tokens (Phase 3).
// Use these instead of redefining per-page styles.
export const surfaceCard =
  "rounded-lg border border-bb-border bg-bb-surface-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]";


export const textMuted = "text-bb-text-muted";

export const surfaceCardSoft =
  "rounded-lg border border-bb-border bg-bb-surface-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

export const ringFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-0";

  // Motion: premium, non-bouncy micro-interactions (200ms ease-out)
export const motionFast =
  "transition-[color,background-color,border-color,opacity,transform,box-shadow] duration-200 ease-out";

// Canonical input height + focus style (Ledger standard)
export const inputH7 =
  "h-11 md:h-7 w-full px-3 md:px-2 py-0 text-base md:text-xs leading-tight bg-bb-input-bg border border-bb-input-border rounded-md " +
  "text-bb-text placeholder:text-bb-input-placeholder " +
  ringFocus;

// IMPORTANT:
// SelectTrigger in this codebase uses data-[size=default]:h-9 (higher specificity than plain h-7).
// So we must override using the SAME specificity (data-[size=...]) to enforce h-7 everywhere.
export const selectTriggerClass =
  inputH7 +
  " justify-between data-[placeholder]:text-bb-input-placeholder " +
  "data-[size=default]:h-11 data-[size=sm]:h-11 md:data-[size=default]:h-7 md:data-[size=sm]:h-7 " +
  "data-[size=default]:py-0 data-[size=sm]:py-0 " +
  "data-[size=default]:px-3 data-[size=sm]:px-3 md:data-[size=default]:px-2 md:data-[size=sm]:px-2 " +
  "data-[size=default]:text-base data-[size=sm]:text-base md:data-[size=default]:text-xs md:data-[size=sm]:text-xs";

export const iconButtonH7 =
  "h-11 w-11 md:h-7 md:w-8 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card " +
  ringFocus;

export const tabButtonBase =
  "min-h-11 md:min-h-7 px-3 rounded-md border text-sm md:text-xs font-medium transition";

export const tabButtonActive =
  "border-primary/25 bg-primary/10 text-primary shadow-sm";

export const tabButtonInactive =
  "border-transparent text-bb-text-muted hover:bg-bb-table-row-hover hover:text-bb-text";

export function tabButtonClass(active: boolean) {
  return [tabButtonBase, active ? tabButtonActive : tabButtonInactive, ringFocus].join(" ");
}
