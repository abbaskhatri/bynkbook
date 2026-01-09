"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useEntries } from "@/lib/queries/useEntries";
import { useLedgerSummary } from "@/lib/queries/useLedgerSummary";

import {
  createEntry,
  deleteEntry,
  restoreEntry,
  hardDeleteEntry,
  updateEntry,
  type Entry,
} from "@/lib/api/entries";

import {FilterBar} from "@/components/app/filter-bar";
import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";
import { TotalsFooter } from "@/components/ledger/totals-footer";

import { Button } from "@/components/ui/button";

import {
  AlertTriangle,
  Info,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";

// =====================================
// BigInt helpers
// =====================================
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

function toBigIntSafe(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch {}
  return ZERO;
}

function formatUsdFromCents(cents: bigint) {
  const neg = cents < ZERO;
  const abs = neg ? -cents : cents;
  const dollars = abs / HUNDRED;
  const pennies = abs % HUNDRED;
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const core = `${withCommas}.${pennies.toString().padStart(2, "0")}`;
  return neg ? `($${core})` : `$${core}`;
}

function todayYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthStartYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function sortEntriesDisplayDesc(a: Entry, b: Entry) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ca = a.created_at || "";
  const cb = b.created_at || "";
  if (ca === cb) return 0;
  return ca < cb ? 1 : -1;
}

function sortEntriesChronAsc(a: Entry, b: Entry) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ca = a.created_at || "";
  const cb = b.created_at || "";
  if (ca === cb) return 0;
  return ca < cb ? -1 : 1;
}

function titleCase(s: string) {
  const v = (s || "").toString().trim();
  if (!v) return "";
  return v
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

// =====================================
// Tooltip (portal) – always above chips
// =====================================
function PortalTooltip(props: { text: string; anchorEl: HTMLElement | null }) {
  const { text, anchorEl } = props;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!anchorEl) return;
    const update = () => {
      const r = anchorEl.getBoundingClientRect();
      setPos({
        top: Math.max(8, r.top - 8),
        left: Math.min(window.innerWidth - 12, r.left + r.width + 8),
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorEl]);

  if (!anchorEl || !pos) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        transform: "translateY(-100%)",
        zIndex: 9999,
      }}
      className="pointer-events-none"
    >
      <div className="rounded-md bg-slate-900 px-2 py-1 text-[11px] leading-snug text-white shadow-lg w-max max-w-[360px] whitespace-pre-wrap">
        {text}
      </div>
    </div>,
    document.body
  );
}

// =====================================
// Status tone mapping (restores colors)
// NOTE: your StatusChip implementation decides tones;
// we pass a stable token instead of raw status.
// =====================================
function statusTone(raw: string) {
  const s = (raw || "").toUpperCase();
  if (s === "EXPECTED") return "expected";
  if (s === "CLEARED") return "cleared";
  if (s === "SYSTEM") return "system";
  if (s === "DELETED") return "muted";
  return "neutral";
}

// =====================================
// Lightweight issues (current UI heuristic)
// =====================================
function buildIssues(rows: Array<{ id: string; date: string; payee: string; amountCents: string; category: string }>) {
  const map: Record<string, { dup: boolean; missing: boolean; dupTooltip: string; missingTooltip: string }> = {};

  const keyToIds = new Map<string, string[]>();
  for (const r of rows) {
    if (r.id === "opening_balance") continue;

    const payeeKey = (r.payee || "").trim().toLowerCase();
    const key = `${r.date}|${r.amountCents}|${payeeKey}`;
    if (!keyToIds.has(key)) keyToIds.set(key, []);
    keyToIds.get(key)!.push(r.id);

    const cat = (r.category || "").trim();
    if (!cat) {
      map[r.id] = {
        ...(map[r.id] || { dup: false, missing: false, dupTooltip: "", missingTooltip: "" }),
        missing: true,
        missingTooltip: "• Category missing or uncategorized",
      };
    }
  }

  for (const ids of keyToIds.values()) {
    if (ids.length <= 1) continue;
    for (const id of ids) {
      map[id] = {
        ...(map[id] || { dup: false, missing: false, dupTooltip: "", missingTooltip: "" }),
        dup: true,
        dupTooltip: "• Potential duplicate entry",
      };
    }
  }

  return map;
}

export default function LedgerPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();

  // Page should not scroll; only table scrolls
  const containerStyle = { height: "calc(100vh - 56px - 48px)" as const };

  // Auth
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        setAuthReady(true);
      } catch {
        router.replace("/login");
      }
    })();
  }, [router]);

  // Business/account selection
  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");
  const accountIdFromUrl = sp.get("accountId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const accountsQ = useAccounts(selectedBusinessId);
  const selectedAccountId = useMemo(() => {
    const list = accountsQ.data ?? [];
    if (accountIdFromUrl) return accountIdFromUrl;
    return list.find((a) => !a.archived_at)?.id ?? "";
  }, [accountsQ.data, accountIdFromUrl]);

  const selectedAccount = useMemo(() => {
    const list = accountsQ.data ?? [];
    return list.find((a) => a.id === selectedAccountId) ?? null;
  }, [accountsQ.data, selectedAccountId]);

  // PR-12 state
  const [showDeleted, setShowDeleted] = useState(false);
  const [searchPayee, setSearchPayee] = useState("");

  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [page, setPage] = useState(1);

  const maxFetch = 500;
  const fetchLimit = useMemo(() => Math.min(maxFetch, rowsPerPage * page), [rowsPerPage, page]);

  const entriesKey = useMemo(
    () => ["entries", selectedBusinessId, selectedAccountId, fetchLimit, showDeleted] as const,
    [selectedBusinessId, selectedAccountId, fetchLimit, showDeleted]
  );

  const entriesQ = useEntries({
    businessId: selectedBusinessId,
    accountId: selectedAccountId,
    limit: fetchLimit,
    includeDeleted: showDeleted,
  });

  const from = monthStartYmd();
  const to = todayYmd();
  const summaryKey = ["ledgerSummary", selectedBusinessId, selectedAccountId, from, to] as const;

  const summaryQ = useLedgerSummary({
    businessId: selectedBusinessId,
    accountId: selectedAccountId,
    from,
    to,
  });

  // opening balance (used for running balance display)
  const openingBalanceCents = useMemo(
    () => BigInt(Number(selectedAccount?.opening_balance_cents ?? 0)),
    [selectedAccount]
  );

  const openingEntry: Entry | null = useMemo(() => {
    if (!selectedBusinessId || !selectedAccountId || !selectedAccount) return null;
    const date = String(selectedAccount.opening_balance_date ?? "").slice(0, 10);
    if (!date || date.length !== 10) return null;

    return {
      id: "opening_balance",
      business_id: selectedBusinessId,
      account_id: selectedAccountId,
      date,
      payee: "Opening Balance",
      memo: selectedAccount.name ?? null,
      amount_cents: String(Number(selectedAccount.opening_balance_cents ?? 0)),
      type: "OPENING",
      method: null,
      status: "SYSTEM",
      deleted_at: null,
      created_at: date + "T00:00:00.000Z",
      updated_at: date + "T00:00:00.000Z",
    };
  }, [selectedBusinessId, selectedAccountId, selectedAccount]);

  const entriesSorted = useMemo(() => {
    const list = (entriesQ.data ?? []).slice();
    list.sort(sortEntriesDisplayDesc);
    return list;
  }, [entriesQ.data]);

  const entriesWithOpening = useMemo(() => {
    if (!openingEntry) return entriesSorted;
    const list = entriesSorted.slice();
    if (!list.some((e) => e.id === "opening_balance")) list.push(openingEntry);
    list.sort(sortEntriesDisplayDesc);
    return list;
  }, [entriesSorted, openingEntry]);

  // Running balance computed locally, excluding soft-deleted entries.
  const rowModels = useMemo(() => {
    const listAscAll = entriesWithOpening.slice().sort(sortEntriesChronAsc);
    const listAscBal = listAscAll.filter((e) => e.id === "opening_balance" || !e.deleted_at);

    const delta = listAscBal.map((e) =>
      e.id === "opening_balance" ? ZERO : toBigIntSafe(e.amount_cents)
    );

    const bal = new Array<bigint>(listAscBal.length).fill(ZERO);
    const idxOpen = listAscBal.findIndex((e) => e.id === "opening_balance");

    if (idxOpen >= 0) {
      bal[idxOpen] = openingBalanceCents;
      for (let i = idxOpen + 1; i < listAscBal.length; i++) bal[i] = bal[i - 1] + delta[i];
      for (let i = idxOpen - 1; i >= 0; i--) bal[i] = bal[i + 1] - delta[i + 1];
    } else {
      for (let i = 0; i < listAscBal.length; i++) {
        bal[i] = (i === 0 ? ZERO : bal[i - 1]) + delta[i];
      }
    }

    const balById = new Map<string, bigint>();
    for (let i = 0; i < listAscBal.length; i++) balById.set(listAscBal[i].id, bal[i]);

    return entriesWithOpening.map((e) => {
      const isDeleted = !!e.deleted_at;
      const amt = toBigIntSafe(e.amount_cents);
      const rowBal = balById.get(e.id);

      return {
        id: e.id,
        date: e.date,
        ref: "",
        payee: e.payee ?? "",
        typeDisplay: titleCase(e.type ?? ""),
        methodDisplay: titleCase(e.method ?? ""),
        category: (e.memo ?? "") || "",
        amountCents: amt.toString(),
        amountStr: formatUsdFromCents(amt),
        amountNeg: amt < ZERO,
        balanceStr: isDeleted || rowBal === undefined ? "—" : formatUsdFromCents(rowBal),
        rawStatus: isDeleted ? "DELETED" : (e.status ?? "").toString(),
        status: isDeleted ? "Deleted" : titleCase(e.status ?? ""),
        isDeleted,
        canDelete: e.id !== "opening_balance",
      };
    });
  }, [entriesWithOpening, openingBalanceCents]);

  // Issues UI heuristic
  const issuesById = useMemo(() => buildIssues(rowModels), [rowModels]);

  const rowsUi = useMemo(() => {
    return rowModels.map((r) => {
      const issue = issuesById[r.id];
      return {
        ...r,
        hasDup: !!issue?.dup,
        hasMissing: !!issue?.missing,
        dupTooltip: issue?.dupTooltip ?? "",
        missingTooltip: issue?.missingTooltip ?? "",
      };
    });
  }, [rowModels, issuesById]);

  // Search + paging
  const filteredRowsAll = useMemo(() => {
    const q = searchPayee.trim().toLowerCase();
    if (!q) return rowsUi;
    return rowsUi.filter((r) => r.payee.toLowerCase().includes(q));
  }, [rowsUi, searchPayee]);

  const startIdx = (page - 1) * rowsPerPage;
  const endIdx = page * rowsPerPage;
  const pageRows = filteredRowsAll.slice(startIdx, endIdx);

  const hasMoreOnServer = (entriesQ.data?.length ?? 0) === fetchLimit && fetchLimit < maxFetch;
  const canNext = endIdx < filteredRowsAll.length || hasMoreOnServer;
  const canPrev = page > 1;
  const totalPages = Math.max(1, Math.ceil(filteredRowsAll.length / rowsPerPage));

  // Selection
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const allPageSelected = useMemo(() => {
    const ids = pageRows.filter((r) => r.id !== "opening_balance").map((r) => r.id);
    if (ids.length === 0) return false;
    return ids.every((id) => !!selectedIds[id]);
  }, [pageRows, selectedIds]);

  function toggleRow(id: string) {
    setSelectedIds((m) => ({ ...m, [id]: !m[id] }));
  }
  function toggleAllPage() {
    const ids = pageRows.filter((r) => r.id !== "opening_balance").map((r) => r.id);
    const next = { ...selectedIds };
    const shouldSelect = !allPageSelected;
    for (const id of ids) next[id] = shouldSelect;
    setSelectedIds(next);
  }

  // Edited marker (keeps pencil icon)
  const [editedIds, setEditedIds] = useState<Record<string, boolean>>({});

  // Tooltip state
  const [tooltipText, setTooltipText] = useState("");
  const [tooltipAnchor, setTooltipAnchor] = useState<HTMLElement | null>(null);

  // Errors
  const [err, setErr] = useState<string | null>(null);

  // Mutations (PR-12)
  const softDeleteMut = useMutation({
    mutationFn: async (entryId: string) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
      return deleteEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId });
    },
    onMutate: async (entryId) => {
      setErr(null);
      await qc.cancelQueries({ queryKey: entriesKey });
      const previous = qc.getQueryData<Entry[]>(entriesKey) ?? [];
      const idx = previous.findIndex((e) => e.id === entryId);
      if (idx < 0) return { previous };

      const next = previous.slice();
      next[idx] = { ...next[idx], deleted_at: new Date().toISOString() };
      qc.setQueryData(entriesKey, next.sort(sortEntriesDisplayDesc));

      // auto show deleted after soft delete
      setShowDeleted(true);

      return { previous };
    },
    onError: (_e, _id, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(entriesKey, ctx.previous);
      setErr("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: entriesKey });
      qc.invalidateQueries({ queryKey: summaryKey });
    },
  });

  const restoreMut = useMutation({
    mutationFn: async (entryId: string) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
      return restoreEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId });
    },
    onMutate: async (entryId) => {
      setErr(null);
      await qc.cancelQueries({ queryKey: entriesKey });
      const previous = qc.getQueryData<Entry[]>(entriesKey) ?? [];
      const idx = previous.findIndex((e) => e.id === entryId);
      if (idx < 0) return { previous };

      const next = previous.slice();
      next[idx] = { ...next[idx], deleted_at: null };
      qc.setQueryData(entriesKey, next.sort(sortEntriesDisplayDesc));

      return { previous };
    },
    onError: (_e, _id, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(entriesKey, ctx.previous);
      setErr("Restore failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: entriesKey });
      qc.invalidateQueries({ queryKey: summaryKey });
    },
  });

  const hardDeleteMut = useMutation({
    mutationFn: async (entryId: string) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
      return hardDeleteEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId });
    },
    onMutate: async (entryId) => {
      setErr(null);
      await qc.cancelQueries({ queryKey: entriesKey });
      const previous = qc.getQueryData<Entry[]>(entriesKey) ?? [];
      qc.setQueryData(entriesKey, previous.filter((e) => e.id !== entryId));
      return { previous };
    },
    onError: (_e, _id, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(entriesKey, ctx.previous);
      setErr("Hard delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: entriesKey });
    },
  });

  // UI tokens
  const checkboxClass =
    "h-4 w-4 rounded border border-slate-300 bg-white checked:bg-slate-900 checked:border-slate-900";
  const trunc = "truncate overflow-hidden whitespace-nowrap";
  const num = "text-right tabular-nums";
  const center = "text-center";

  const th =
    "px-1.5 py-0.5 align-middle text-xs font-semibold uppercase tracking-wide text-slate-600";
  const td = "px-1.5 py-0.5 align-middle text-xs";

  // Column contract
  const cols = [
    <col key="c0" style={{ width: "28px" }} />,
    <col key="c1" style={{ width: "clamp(74px, 6.5vw, 96px)" }} />,
    <col key="c2" style={{ width: "clamp(56px, 5.5vw, 72px)" }} />,
    <col key="c3" style={{ width: "auto", minWidth: "140px" }} />,
    <col key="c4" style={{ width: "clamp(90px, 7.5vw, 110px)" }} />,
    <col key="c5" style={{ width: "clamp(96px, 8.5vw, 120px)" }} />,
    <col key="c6" style={{ width: "clamp(110px, 10vw, 140px)" }} />,
    <col key="c7" style={{ width: "clamp(104px, 9vw, 132px)" }} />,
    <col key="c8" style={{ width: "clamp(104px, 9vw, 132px)" }} />,
    <col key="c9" style={{ width: "clamp(86px, 7vw, 100px)" }} />,
    <col key="c10" style={{ width: "92px" }} />,
  ];

  if (!authReady) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4">
        <div className="text-lg font-semibold">Ledger</div>
      </div>

      {/* Filter bar with right area (account capsule + toggle + errors) */}
      <div className="px-4 pt-2">
        <FilterBar
          searchValue={searchPayee}
          onSearchChange={(v: string) => {
            setSearchPayee(v);
            setPage(1);
          }}
          right={
            <div className="flex items-center gap-3">
              {selectedAccount?.name ? (
                <div className="h-6 px-3 rounded-full border border-slate-200 bg-white text-xs flex items-center">
                  {selectedAccount.name}
                </div>
              ) : null}

              <label className="flex items-center gap-2 text-xs text-slate-600 select-none">
                <input
                  type="checkbox"
                  checked={showDeleted}
                  onChange={(e) => setShowDeleted(e.target.checked)}
                />
                <span>{showDeleted ? "Hide deleted" : "Show deleted"}</span>
              </label>

              {err ? <span className="text-xs text-red-600">{err}</span> : null}
            </div>
          }
          onReset={() => {
            setSearchPayee("");
            setPage(1);
          }}
        />
      </div>

      {/* Table region only scrolls */}
      <div className="flex-1 min-h-0 overflow-hidden px-4 pt-2" style={containerStyle}>
        <LedgerTableShell
          colgroup={cols}
          header={
            <tr className="border-b border-slate-200">
              <th className={th + " " + center}>
                <input
                  className={checkboxClass}
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleAllPage}
                  aria-label="Select page"
                />
              </th>
              <th className={th}>Date</th>
              <th className={th}>Ref</th>
              <th className={th}>Payee</th>
              <th className={th}>Type</th>
              <th className={th}>Method</th>
              <th className={th}>Category</th>
              <th className={th + " " + num}>Amount</th>
              <th className={th + " " + num}>Balance</th>
              <th className={th + " " + center}>Status</th>
              <th className={th + " " + center}>Actions</th>
            </tr>
          }
          addRow={null}
          body={pageRows.map((r: any) => {
            const dup = !!r.hasDup;
            const missing = !!r.hasMissing;

            const rowBg = dup ? "bg-yellow-50" : "";
            const rowOpacity = r.isDeleted ? "opacity-60" : "";
            const rowClass = ["border-b border-slate-200 hover:bg-slate-50", rowBg, rowOpacity]
              .filter(Boolean)
              .join(" ");

            return (
              <tr key={r.id} className={rowClass}>
                <td className={td + " " + center}>
                  {r.id === "opening_balance" ? null : (
                    <input
                      className={checkboxClass}
                      type="checkbox"
                      checked={!!selectedIds[r.id]}
                      onChange={() => toggleRow(r.id)}
                      aria-label="Select row"
                    />
                  )}
                </td>

                <td className={td}>{r.date}</td>
                <td className={td}>{r.ref}</td>

                <td className={td + " min-w-0"}>
                  <div className="flex items-center gap-1 min-w-0">
                    <span className={trunc + " font-medium"}>{r.payee}</span>
                    {editedIds[r.id] ? <Pencil className="h-3 w-3 text-slate-400 shrink-0" /> : null}
                  </div>
                </td>

                <td className={td + " " + trunc}>{r.typeDisplay}</td>
                <td className={td + " " + trunc}>{r.methodDisplay}</td>
                <td className={td + " " + trunc}>{r.category}</td>

                <td className={td + " " + num + " font-semibold" + (r.amountNeg ? " text-red-700" : "")}>
                  {r.amountStr}
                </td>

                <td className={td + " " + num}>{r.balanceStr}</td>

                {/* Status + issues (icons pinned so they don't shift) */}
                <td className={td + " " + center + " relative pr-10"}>
                  <div className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-white">
                    {r.status}
                  </div>

                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {dup ? (
                      <button
                        type="button"
                        className="h-4 w-4 text-amber-500"
                        onMouseEnter={(e) => {
                          setTooltipText(r.dupTooltip);
                          setTooltipAnchor(e.currentTarget);
                        }}
                        onMouseLeave={() => setTooltipAnchor(null)}
                        aria-label="Duplicate issue"
                      >
                        <AlertTriangle className="h-4 w-4" />
                      </button>
                    ) : null}

                    {missing ? (
                      <button
                        type="button"
                        className="h-4 w-4 text-blue-500"
                        onMouseEnter={(e) => {
                          setTooltipText(r.missingTooltip);
                          setTooltipAnchor(e.currentTarget);
                        }}
                        onMouseLeave={() => setTooltipAnchor(null)}
                        aria-label="Missing category"
                      >
                        <Info className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </td>

                {/* Actions (PR-12) */}
                <td className={td + " " + center}>
                  {r.id === "opening_balance" ? null : r.isDeleted ? (
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="outline"
                        className="h-6 w-8 p-0"
                        onClick={() => restoreMut.mutate(r.id)}
                        aria-label="Restore"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>

                      <Button
                        variant="outline"
                        className="h-6 w-8 p-0 text-red-600"
                        onClick={() => hardDeleteMut.mutate(r.id)}
                        aria-label="Delete permanently"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      className="h-6 w-8 p-0"
                      onClick={() => softDeleteMut.mutate(r.id)}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
          footer={
            <tr>
              <td colSpan={11} className="p-0">
                <TotalsFooter
                  rowsPerPage={rowsPerPage}
                  setRowsPerPage={setRowsPerPage}
                  page={page}
                  setPage={setPage}
                  totalPages={totalPages}
                  canPrev={canPrev}
                  canNext={canNext}
                  incomeText={formatUsdFromCents(BigInt(summaryQ.data?.totals?.income_cents ?? "0"))}
                  expenseText={formatUsdFromCents(BigInt(summaryQ.data?.totals?.expense_cents ?? "0"))}
                  netText={formatUsdFromCents(BigInt(summaryQ.data?.totals?.net_cents ?? "0"))}
                  balanceText={formatUsdFromCents(BigInt(summaryQ.data?.balance_cents ?? "0"))}
                />
              </td>
            </tr>
          }
        />
      </div>

      <PortalTooltip text={tooltipText} anchorEl={tooltipAnchor} />
    </div>
  );
}
