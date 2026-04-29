// Canonical UI tokens (Phase 3).
// Use these instead of redefining per-page styles.
export const surfaceCard =
  "rounded-xl border border-bb-border bg-bb-surface-card shadow-sm";


export const textMuted = "text-bb-text-muted";

export const surfaceCardSoft =
  "rounded-xl border border-bb-border bg-bb-surface-card shadow-sm";

export const ringFocus =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30 focus-visible:ring-offset-0";

  // Motion: premium, non-bouncy micro-interactions (200ms ease-out)
export const motionFast =
  "transition-[color,background-color,border-color,opacity,transform,box-shadow] duration-200 ease-out";

// Canonical input height + focus style (Ledger standard)
export const inputH7 =
  "h-7 w-full px-2 py-0 text-xs leading-tight bg-bb-input-bg border border-bb-input-border rounded-md " +
  "text-bb-text placeholder:text-bb-input-placeholder " +
  ringFocus;

// IMPORTANT:
// SelectTrigger in this codebase uses data-[size=default]:h-9 (higher specificity than plain h-7).
// So we must override using the SAME specificity (data-[size=...]) to enforce h-7 everywhere.
export const selectTriggerClass =
  inputH7 +
  " justify-between data-[placeholder]:text-bb-input-placeholder " +
  "data-[size=default]:h-7 data-[size=sm]:h-7 " +
  "data-[size=default]:py-0 data-[size=sm]:py-0 " +
  "data-[size=default]:px-2 data-[size=sm]:px-2 " +
  "data-[size=default]:text-xs data-[size=sm]:text-xs";

export const iconButtonH7 =
  "h-7 w-8 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card " +
  ringFocus;
