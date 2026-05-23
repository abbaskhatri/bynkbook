// Pure presentational components extracted from ledger/page-client.tsx.
// All four components are self-contained: they take props in, render UI,
// and either call `props.onX` callbacks or hit apiFetch directly. None
// of them close over state in the main LedgerPageClient component.
// Behavior must be identical to the previous in-file definitions.

"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Info, RefreshCw, X } from "lucide-react";

import { apiFetch } from "@/lib/api/client";
import {
  ZERO,
  filterOptions,
  normKey,
  normalizeCategoryName,
  toBigIntSafe,
} from "@/lib/ledger/helpers";

export function UpdatingOverlay({ label = "Updating…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-bb-surface-card/55 backdrop-blur-[1px]">
      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-bb-border bg-bb-surface-card px-3 py-1 text-xs font-medium text-bb-text shadow-sm">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function AutoInput(props: {
  // Controlled usage (existing)
  value?: string;
  onValueChange?: (v: string) => void;

  // Uncontrolled usage (new; for typing isolation)
  defaultValue?: string;

  options: string[];
  placeholder?: string;
  inputClassName?: string;
  onSubmit?: () => void;
  inputRef?: any;

  // Create option (new)
  allowCreate?: boolean;
  onCreate?: (name: string) => void;
}) {
  const {
    value,
    onValueChange,
    defaultValue = "",
    options,
    placeholder,
    inputClassName,
    onSubmit,
    inputRef,
  } = props;

  const isControlled = typeof value === "string" && typeof onValueChange === "function";

  const [inner, setInner] = useState(defaultValue);
  const currentValue = isControlled ? (value as string) : inner;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const filtered = useMemo(() => filterOptions(currentValue, options), [currentValue, options]);

  const canCreate =
    !!props.allowCreate &&
    !!normalizeCategoryName(currentValue) &&
    !options.some((o) => normKey(o) === normKey(currentValue)) &&
    // Extra guard: if categories already contain it (even if options lag), don't show Create
    !(typeof (globalThis as any).__BYNK_CATEGORY_NORM_MAP_HAS === "function"
      ? (globalThis as any).__BYNK_CATEGORY_NORM_MAP_HAS(normKey(currentValue))
      : false);

  const applyValue = (next: string) => {
    if (isControlled) {
      onValueChange?.(next);
    } else {
      setInner(next);
      if (inputRef?.current) inputRef.current.value = next;
    }
  };

  const onKeyDown = (e: any) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Tab") {
      if (open && filtered[active]) applyValue(filtered[active]);
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open && filtered.length > 0) setOpen(true);
      setActive((prev: number) => {
        const max = Math.max(0, filtered.length - 1);
        return e.key === "ArrowDown" ? Math.min(max, prev + 1) : Math.max(0, prev - 1);
      });
      return;
    }
    if (e.key === "Enter") {
      if (open && filtered[active]) {
        e.preventDefault();
        applyValue(filtered[active]);
        setOpen(false);
        if (onSubmit) onSubmit();
        return;
      }
      if (onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={inputClassName}
        placeholder={placeholder}
        value={currentValue}
        onChange={(e) => {
          const next = e.target.value;

          if (isControlled) {
            onValueChange?.(next);
          } else {
            setInner(next);
            if (inputRef?.current) inputRef.current.value = next;
          }

          setActive(0);
          setOpen(next.trim().length > 0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && (filtered.length > 0 || canCreate) ? (
        <div className="absolute left-0 top-full mt-1 w-full z-50 rounded-md border bg-bb-surface-card shadow-md p-0 max-h-56 overflow-auto">
          {canCreate ? (
            <button
              type="button"
              className="w-full text-left px-2 py-1 text-xs hover:bg-bb-table-row-hover"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const name = normalizeCategoryName(currentValue);
                props.onCreate?.(name);
                setOpen(false);
              }}
            >
              <span className="text-bb-text">Create</span>{" "}
              <span className="font-medium text-bb-text">“{normalizeCategoryName(currentValue)}”</span>
            </button>
          ) : null}

          {filtered.map((opt, idx) => (
            <button
              key={opt}
              type="button"
              className={
                "w-full text-left text-xs px-2 py-1.5 " +
                (idx === active ? "bg-bb-table-row-hover" : "bg-bb-surface-card") +
                " hover:bg-bb-table-row-hover"
              }
              onMouseDown={(ev) => {
                ev.preventDefault();

                if (isControlled) {
                  onValueChange?.(opt);
                } else {
                  setInner(opt);
                  if (inputRef?.current) inputRef.current.value = opt;
                }

                setOpen(false);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HoverTooltip(props: { text: string; children: any }) {
  const { text, children } = props;
  const ref = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: r.right, y: r.bottom });
  }, [open, text]);

  const body = typeof document !== "undefined" ? document.body : null;

  return (
    <span
      ref={ref}
      className="inline-flex h-5 w-5 items-center justify-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      aria-label={text}
    >
      {children}
      {open && text && body && pos
        ? createPortal(
          <div
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y + 6,
              transform: "translateX(-100%)",
              zIndex: 9999,
              pointerEvents: "none",
              maxWidth: 420,
            }}
            className="rounded-md bg-bb-text px-2 py-1 text-[11px] text-bb-text-inverse shadow-lg whitespace-pre-line break-words w-max"
          >
            {text}
          </div>,
          body
        )
        : null}
    </span>
  );
}

export function VendorSuggestPill(props: {
  businessId: string;
  accountId: string;
  entryId: string;
  payee: string;
  onLinked: (vendor: { id: string; name: string }) => void;
  onDismiss: () => void;
}) {
  const { businessId, accountId, entryId, payee, onLinked, onDismiss } = props;
  const [best, setBest] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const q = (payee || "").trim();
    if (!businessId || q.length < 2) {
      setBest(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res: any = await apiFetch(
          `/v1/businesses/${businessId}/vendors?q=${encodeURIComponent(q)}`,
          { method: "GET" }
        );
        const vendors = Array.isArray(res?.vendors) ? res.vendors : [];
        if (!vendors.length) return setBest(null);

        const norm = (s: string) => String(s || "").trim().toLowerCase();
        const exact = vendors.find((v: any) => norm(v.name) === norm(q));
        const v = exact || vendors[0];

        if (v?.id && v?.name) setBest({ id: v.id, name: v.name });
        else setBest(null);
      } catch {
        setBest(null);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [businessId, payee]);

  if (!best) return null;

  return (
    <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-bb-table-row-hover px-2 py-0.5 text-[11px] text-bb-text">
      {/* vendor icon */}
      <span className="inline-flex items-center justify-center">
        <Info className="h-3.5 w-3.5 text-bb-text-muted" />
      </span>

      {/* vendor name */}
      <span className="font-medium text-bb-text">{best.name}</span>

      {/* actions */}
      <button
        type="button"
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-primary/10"
        title="Link to vendor"
        onClick={async () => {
          try {
            const res: any = await apiFetch(
              `/v1/businesses/${businessId}/accounts/${accountId}/entries/${entryId}`,
              {
                method: "PATCH",
                body: JSON.stringify({ vendor_id: best.id, entry_kind: "VENDOR_PAYMENT" }),
              }
            );

            if (!res?.ok) {
              // keep pill visible if backend rejected
              return;
            }

            onLinked({ id: best.id, name: best.name });

            // Open apply dialog IN LEDGER (no redirect) with entry details
            const e = res?.entry ?? null;
            const amt = toBigIntSafe(e?.amount_cents ?? 0);
            const absAmt = amt < ZERO ? -amt : amt;

            window.dispatchEvent(
              new CustomEvent("bynk:ledger-open-apply", {
                detail: {
                  vendorId: best.id,
                  vendorName: best.name,
                  entryId,
                  entry: {
                    id: entryId,
                    date: String(e?.date ?? "").slice(0, 10),
                    payee: String(e?.payee ?? payee ?? ""),
                    method: String(e?.method ?? "OTHER"),
                    amountCentsAbs: absAmt.toString(),
                    memo: String(e?.memo ?? ""),
                  },
                },
              })
            );
          } catch {
            // keep pill visible on error
          }
        }}
      >
        <Check className="h-3.5 w-3.5 text-primary" />
      </button>

      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-bb-border"
        title="Dismiss"
        onClick={onDismiss}
      >
        <X className="h-3.5 w-3.5 text-bb-text-muted" />
      </button>
    </div>
  );
}
