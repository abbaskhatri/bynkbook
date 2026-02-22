// Canonical UI tokens (Phase 3).
// Use these instead of redefining per-page styles.
export const surfaceCard =
  "rounded-xl border border-slate-200 bg-white shadow-sm";


export const textMuted = "text-slate-500";

export const surfaceCardSoft =
  "rounded-xl border border-slate-200 bg-white shadow-sm";

export const ringFocus =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500 focus-visible:ring-offset-0";

// Canonical input height + focus style (Ledger standard)
export const inputH7 =
  "h-7 w-full px-2 py-0 text-xs leading-tight bg-white border border-slate-200 rounded-md " +
  ringFocus;

// IMPORTANT:
// SelectTrigger in this codebase uses data-[size=default]:h-9 (higher specificity than plain h-7).
// So we must override using the SAME specificity (data-[size=...]) to enforce h-7 everywhere.
export const selectTriggerClass =
  inputH7 +
  " justify-between data-[placeholder]:text-slate-400 " +
  "data-[size=default]:h-7 data-[size=sm]:h-7 " +
  "data-[size=default]:py-0 data-[size=sm]:py-0 " +
  "data-[size=default]:px-2 data-[size=sm]:px-2 " +
  "data-[size=default]:text-xs data-[size=sm]:text-xs";

export const iconButtonH7 =
  "h-7 w-8 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white " +
  ringFocus;
