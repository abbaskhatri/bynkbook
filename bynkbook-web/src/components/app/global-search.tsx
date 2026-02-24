"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { queryGlobalSearch } from "@/lib/api/ai";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

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

  // Global "/" shortcut to focus search (except when typing in editable controls)
  useEffect(() => {
    const onDocKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "/") return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      const activeEl = document.activeElement;
      if (isEditableTarget(activeEl)) return;

      ev.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
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
    for (const e of entries.slice(0, 6)) {
      out.push({ key: `e:${String(e.id)}`, link: String(e.link), kind: "entry" });
    }
    for (const t of bankTxns.slice(0, 6)) {
      out.push({ key: `b:${String(t.id)}`, link: String(t.link), kind: "bank" });
    }
    return out;
  }, [entries, bankTxns]);

  // Keep selection sane as results change
  useEffect(() => {
    if (!open || !canSearch) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(items.length ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, open, canSearch]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          ref={inputRef}
          className="h-7 w-[260px] pl-8 pr-2 text-xs"
          placeholder="Search: “Expenses over $500 last month”…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(ev) => {
            if (!canSearch) {
              if (ev.key === "Escape") {
                setOpen(false);
                setActiveIndex(-1);
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
            }
          }}
          onBlur={() => {
            // Delay close so clicks work
            setTimeout(() => setOpen(false), 120);
          }}
        />
      </div>

      {open && canSearch ? (
        <div className="absolute z-50 mt-1 w-[420px] max-w-[70vw] rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="px-3 py-2 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Results (scoped)</span>
            {busy ? <span>Searching…</span> : null}
          </div>

          {errMsg ? <div className="px-3 pb-2 text-xs text-rose-600">{errMsg}</div> : null}

          <div className="h-px bg-slate-100" />

          <div className="px-3 py-2">
            <div className="text-[11px] font-semibold text-slate-700 mb-1">Entries</div>
            {entries.length ? (
              <div className="flex flex-col">
                {entries.slice(0, 6).map((e: any, idx: number) => {
                  const rowIndex = idx; // entries first
                  const isActive = rowIndex === activeIndex;

                  return (
                    <button
                      key={String(e.id)}
                      type="button"
                      aria-selected={isActive}
                      className={[
                        "py-2 text-left text-xs rounded-md px-2 border border-transparent",
                        "hover:bg-slate-50",
                        isActive ? "bg-accent text-accent-foreground ring-1 ring-ring/20" : "",
                      ].join(" ")}
                      onMouseEnter={() => setActiveIndex(rowIndex)}
                      onClick={() => onSelect(String(e.link))}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate">
                          <span className="font-medium text-slate-900">{String(e.payee ?? "Entry")}</span>
                          {e.memo ? <span className="text-slate-500"> · {String(e.memo).slice(0, 40)}</span> : null}
                        </div>
                        <div className="text-slate-500 tabular-nums">{String(e.date ?? "")}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-500">No entry matches</div>
            )}
          </div>

          <div className="h-px bg-slate-100" />

          <div className="px-3 py-2">
            <div className="text-[11px] font-semibold text-slate-700 mb-1">Bank transactions</div>
            {bankTxns.length ? (
              <div className="flex flex-col">
                {bankTxns.slice(0, 6).map((t: any, idx: number) => {
                  const rowIndex = entries.slice(0, 6).length + idx; // after entries
                  const isActive = rowIndex === activeIndex;

                  return (
                    <button
                      key={String(t.id)}
                      type="button"
                      aria-selected={isActive}
                      className={[
                        "py-2 text-left text-xs rounded-md px-2 border border-transparent",
                        "hover:bg-slate-50",
                        isActive ? "bg-accent text-accent-foreground ring-1 ring-ring/20" : "",
                      ].join(" ")}
                      onMouseEnter={() => setActiveIndex(rowIndex)}
                      onClick={() => onSelect(String(t.link))}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate">
                          <span className="font-medium text-slate-900">{String(t.name ?? "Bank txn")}</span>
                        </div>
                        <div className="text-slate-500 tabular-nums">{String(t.posted_date ?? "").slice(0, 10)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-500">No bank txn matches</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}