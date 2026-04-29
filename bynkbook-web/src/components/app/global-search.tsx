"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { queryGlobalSearch } from "@/lib/api/ai";
import { Input } from "@/components/ui/input";
import { Command, Search } from "lucide-react";

type SearchItem = {
  key: string;
  link: string;
  kind: "entry" | "bank";
};

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function shortcutLabel() {
  if (typeof navigator === "undefined") return "Ctrl K";
  const platform = navigator.platform?.toLowerCase() ?? "";
  return /mac|iphone|ipad|ipod/.test(platform) ? "⌘K" : "Ctrl K";
}

export default function GlobalSearch(props: { businessId: string; accountId?: string }) {
  const { businessId, accountId } = props;
  const router = useRouter();

  const inputRef = useRef<HTMLInputElement | null>(null);

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const tRef = useRef<any>(null);
  const reqIdRef = useRef(0);

  const trimmed = q.trim();
  const canSearch = !!businessId && trimmed.length >= 3;
  const keyHint = useMemo(() => shortcutLabel(), []);

  function extractStatus(e: any): number | null {
    const msg = String(e?.message ?? "");
    const m = msg.match(/API\s+(\d+):/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }

  function onSelect(link: string) {
    setOpen(false);
    setErrMsg(null);
    setActiveIndex(-1);
    router.push(link);
  }

  function focusSearch() {
    inputRef.current?.focus();
    setOpen(true);
  }

  // Global shortcuts:
  // - "/" focuses search when not typing
  // - Cmd/Ctrl + K focuses search
  useEffect(() => {
    const onDocKeyDown = (ev: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const editable = isEditableTarget(activeEl);

      if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "k") {
        if (editable && activeEl !== inputRef.current) {
          ev.preventDefault();
          focusSearch();
          return;
        }
        ev.preventDefault();
        focusSearch();
        return;
      }

      if (ev.key === "/" && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        if (editable) return;
        ev.preventDefault();
        focusSearch();
      }
    };

    document.addEventListener("keydown", onDocKeyDown);
    return () => document.removeEventListener("keydown", onDocKeyDown);
  }, []);

  useEffect(() => {
    if (tRef.current) clearTimeout(tRef.current);

    if (!canSearch) {
      setRes(null);
      setErrMsg(null);
      setBusy(false);
      setActiveIndex(-1);
      return;
    }

    const myReqId = ++reqIdRef.current;

    tRef.current = setTimeout(async () => {
      setBusy(true);
      setErrMsg(null);

      try {
        const r: any = await queryGlobalSearch({ businessId, accountId, q: trimmed, limit: 20 });
        if (myReqId !== reqIdRef.current) return;

        setRes(r);
        setOpen(true);
      } catch (e: any) {
        if (myReqId !== reqIdRef.current) return;

        const status = extractStatus(e);
        if (status === 401) setErrMsg("Session expired. Please sign in again.");
        else if (status === 403) setErrMsg("You don’t have access to this business.");
        else setErrMsg("Search failed. Try again.");

        setRes(null);
        setOpen(true);
      } finally {
        if (myReqId === reqIdRef.current) setBusy(false);
      }
    }, 250);

    return () => {
      if (tRef.current) clearTimeout(tRef.current);
    };
  }, [trimmed, canSearch, businessId, accountId]);

  const entries = useMemo(() => (Array.isArray(res?.results?.entries) ? res.results.entries : []), [res]);
  const bankTxns = useMemo(() => (Array.isArray(res?.results?.bankTxns) ? res.results.bankTxns : []), [res]);

  const items: SearchItem[] = useMemo(() => {
    const out: SearchItem[] = [];
    for (const e of entries.slice(0, 6)) out.push({ key: `e:${String(e.id)}`, link: String(e.link), kind: "entry" });
    for (const t of bankTxns.slice(0, 6)) out.push({ key: `b:${String(t.id)}`, link: String(t.link), kind: "bank" });
    return out;
  }, [entries, bankTxns]);

  useEffect(() => {
    if (!open || !canSearch) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(items.length ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, open, canSearch]);

  const totalVisible = entries.slice(0, 6).length + bankTxns.slice(0, 6).length;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-bb-text-subtle" />
        <Input
          ref={inputRef}
          className="h-9 w-[320px] rounded-xl border-bb-input-border bg-bb-input-bg pl-9 pr-16 text-sm shadow-sm"
          placeholder="Search entries, bank txns, payees…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(ev) => {
            if (!canSearch) {
              if (ev.key === "Escape") {
                setOpen(false);
                setActiveIndex(-1);
                setQ("");
              }
              return;
            }

            if (ev.key === "ArrowDown") {
              ev.preventDefault();
              if (!open) setOpen(true);
              setActiveIndex((i) => {
                const next = i < 0 ? 0 : Math.min(items.length - 1, i + 1);
                return Number.isFinite(next) ? next : -1;
              });
            } else if (ev.key === "ArrowUp") {
              ev.preventDefault();
              if (!open) setOpen(true);
              setActiveIndex((i) => {
                const next = i < 0 ? 0 : Math.max(0, i - 1);
                return Number.isFinite(next) ? next : -1;
              });
            } else if (ev.key === "Enter") {
              if (!open) return;
              if (activeIndex < 0 || activeIndex >= items.length) return;
              ev.preventDefault();
              onSelect(items[activeIndex].link);
            } else if (ev.key === "Escape") {
              ev.preventDefault();
              setOpen(false);
              setActiveIndex(-1);
              setQ("");
            }
          }}
          onBlur={() => {
            setTimeout(() => setOpen(false), 120);
          }}
        />

        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
          <div className="inline-flex items-center gap-1 rounded-md border border-bb-border bg-bb-surface-soft px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {keyHint.includes("⌘") ? <Command className="h-3 w-3" /> : null}
            <span>{keyHint}</span>
          </div>
        </div>
      </div>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[480px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-bb-border bg-bb-surface-elevated shadow-[0_18px_60px_rgba(15,23,42,0.14)]">
          <div className="flex items-center justify-between border-b border-bb-border-muted px-4 py-3">
            <div>
              <div className="text-xs font-semibold tracking-wide text-foreground/80">Global search</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {canSearch ? "Scoped to the current business." : "Type at least 3 characters to search."}
              </div>
            </div>
            <div className="text-[11px] text-bb-text-subtle">{busy ? "Searching…" : totalVisible ? `${totalVisible} shown` : ""}</div>
          </div>

          {errMsg ? <div className="px-4 py-3 text-sm text-bb-status-danger-fg">{errMsg}</div> : null}

          {!canSearch ? (
            <div className="px-4 py-4">
              <div className="rounded-xl border border-bb-border bg-bb-surface-soft px-4 py-3 text-sm text-foreground/70">
                Search by payee, memo, amount phrasing, or transaction context. Try:
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-bb-border bg-bb-surface-card px-2.5 py-1">Uber</span>
                  <span className="rounded-full border border-bb-border bg-bb-surface-card px-2.5 py-1">Office supplies</span>
                  <span className="rounded-full border border-bb-border bg-bb-surface-card px-2.5 py-1">Expenses over 500</span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Entries</div>
                {entries.length ? (
                  <div className="flex flex-col gap-1">
                    {entries.slice(0, 6).map((e: any, idx: number) => {
                      const rowIndex = idx;
                      const isActive = rowIndex === activeIndex;

                      return (
                        <button
                          key={String(e.id)}
                          type="button"
                          aria-selected={isActive}
                          className={[
                            "rounded-xl border px-3 py-2.5 text-left transition",
                            isActive ? "border-bb-border bg-bb-surface-soft" : "border-transparent hover:border-bb-border hover:bg-bb-table-row-hover",
                          ].join(" ")}
                          onMouseEnter={() => setActiveIndex(rowIndex)}
                          onClick={() => onSelect(String(e.link))}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">
                                {String(e.payee ?? "Entry")}
                              </div>
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {e.memo ? String(e.memo).slice(0, 60) : "No memo"}
                              </div>
                            </div>
                            <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {String(e.date ?? "")}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-bb-border bg-bb-surface-soft px-3 py-3 text-sm text-muted-foreground">
                    No entry matches.
                  </div>
                )}
              </div>

              <div className="h-px bg-bb-border-muted" />

              <div className="px-4 py-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Bank transactions</div>
                {bankTxns.length ? (
                  <div className="flex flex-col gap-1">
                    {bankTxns.slice(0, 6).map((t: any, idx: number) => {
                      const rowIndex = entries.slice(0, 6).length + idx;
                      const isActive = rowIndex === activeIndex;

                      return (
                        <button
                          key={String(t.id)}
                          type="button"
                          aria-selected={isActive}
                          className={[
                            "rounded-xl border px-3 py-2.5 text-left transition",
                            isActive ? "border-bb-border bg-bb-surface-soft" : "border-transparent hover:border-bb-border hover:bg-bb-table-row-hover",
                          ].join(" ")}
                          onMouseEnter={() => setActiveIndex(rowIndex)}
                          onClick={() => onSelect(String(t.link))}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">
                                {String(t.description ?? "Bank transaction")}
                              </div>
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {t.memo ? String(t.memo).slice(0, 60) : "Bank transaction result"}
                              </div>
                            </div>
                            <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {String(t.date ?? "")}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-bb-border bg-bb-surface-soft px-3 py-3 text-sm text-muted-foreground">
                    No bank transaction matches.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
