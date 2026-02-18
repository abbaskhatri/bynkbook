"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// Auth is handled by AppShell
import { useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useEntries } from "@/lib/queries/useEntries";
import { updateEntry, type Entry } from "@/lib/api/entries";
import { listCategories, type CategoryRow } from "@/lib/api/categories";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterBar } from "@/components/primitives/FilterBar";
import { AppDialog } from "@/components/primitives/AppDialog";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";

import { Tags } from "lucide-react";

function formatUsdAccountingFromCents(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";
  const neg = n < 0;
  const abs = Math.abs(n);

  const dollars = Math.floor(abs / 100);
  const cents = Math.round(abs % 100);

  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const core = `$${withCommas}.${String(cents).padStart(2, "0")}`;
  return neg ? `(${core})` : core;
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function firstOfThisMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export default function CategoryReviewPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  // Auth is handled by AppShell

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");
  const accountIdFromUrl = sp.get("accountId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const accountsQ = useAccounts(selectedBusinessId);

  const [err, setErr] = useState<string | null>(null);

  const selectedAccountId = useMemo(() => {
    const list = accountsQ.data ?? [];
    if (accountIdFromUrl) return accountIdFromUrl;
    return list.find((a) => !a.archived_at)?.id ?? "";
  }, [accountsQ.data, accountIdFromUrl]);

  useEffect(() => {
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;

    if (!sp.get("businessId")) {
      router.replace(`/category-review?businessId=${selectedBusinessId}`);
      return;
    }

    if (accountsQ.isLoading) return;

    if (selectedAccountId && !accountIdFromUrl) {
      router.replace(`/category-review?businessId=${selectedBusinessId}&accountId=${selectedAccountId}`);
    }
  }, [
    businessesQ.isLoading,
    selectedBusinessId,
    accountsQ.isLoading,
    selectedAccountId,
    accountIdFromUrl,
    router,
    sp,
  ]);

  const opts = (accountsQ.data ?? [])
    .filter((a) => !a.archived_at)
    .map((a) => ({ value: a.id, label: a.name }));

  const capsule = (
    <div className="h-6 px-1.5 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center">
      <CapsuleSelect
        variant="flat"
        loading={accountsQ.isLoading}
        value={selectedAccountId || (opts[0]?.value ?? "")}
        onValueChange={(v) => router.replace(`/category-review?businessId=${selectedBusinessId}&accountId=${v}`)}
        options={opts}
        placeholder="Select account"
      />
    </div>
  );

  const qc = useQueryClient();

  // Entries (single fetch via hook; filters only apply after Run)
  const entriesLimit = 500;
  const entriesKey = useMemo(
    () => ["entries", selectedBusinessId, selectedAccountId, entriesLimit, false] as const,
    [selectedBusinessId, selectedAccountId, entriesLimit]
  );

  const entriesQ = useEntries({
    businessId: selectedBusinessId,
    accountId: selectedAccountId,
    limit: entriesLimit,
    includeDeleted: false,
  });

  const bannerMsg =
    err ||
    appErrorMessageOrNull(businessesQ.error) ||
    appErrorMessageOrNull(accountsQ.error) ||
    null;

  // Now that entriesQ exists, include it in the banner mapping
  const bannerMsgWithEntries =
    bannerMsg || appErrorMessageOrNull(entriesQ.error) || null;

  // Categories list
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  useEffect(() => {
    (async () => {
      if (!selectedBusinessId) return;
      try {
        const res = await listCategories(selectedBusinessId, { includeArchived: false });
        setCategories(res.rows ?? []);
      } catch {
        setCategories([]);
      }
    })();
  }, [selectedBusinessId]);

  const categoryNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[String(c.id)] = c.name;
    return m;
  }, [categories]);

  // Filters (inputs)
  const [from, setFrom] = useState(firstOfThisMonth());
  const [to, setTo] = useState(todayYmd());
  const [search, setSearch] = useState("");
  const [onlyUncategorized, setOnlyUncategorized] = useState(true);

  // Applied filters (set only on Run)
  const [applied, setApplied] = useState({
    from: firstOfThisMonth(),
    to: todayYmd(),
    search: "",
    onlyUncategorized: true,
  });

  function runFilters() {
    setErr(null);
    setApplied({ from, to, search, onlyUncategorized });
    setSelectedIds(new Set());
    setFailedById({});
  }

  const allEntries = (entriesQ.data ?? []) as any[];

  const visibleRows = useMemo(() => {
    const s = applied.search.trim().toLowerCase();
    const fromYmd = applied.from;
    const toYmd = applied.to;

    const inRange = (ymd: string) => {
      if (!ymd) return false;
      if (fromYmd && ymd < fromYmd) return false;
      if (toYmd && ymd > toYmd) return false;
      return true;
    };

    return allEntries.filter((e) => {
      const ymd = String(e.date ?? "").slice(0, 10);
      if (!inRange(ymd)) return false;

      // Exclude types that don't require categories
      const t = String(e.type ?? "").toUpperCase();
      if (t === "TRANSFER" || t === "ADJUSTMENT" || t === "OPENING") return false;

      if (applied.onlyUncategorized && e.category_id) return false;
      if (s) {
        const p = String(e.payee ?? "").toLowerCase();
        const m = String(e.memo ?? "").toLowerCase();
        if (!p.includes(s) && !m.includes(s)) return false;
      }

      return true;
    });
  }, [allEntries, applied]);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedCount = selectedIds.size;

  const allVisibleSelected = useMemo(() => {
    if (visibleRows.length === 0) return false;
    for (const e of visibleRows) {
      if (!selectedIds.has(String(e.id))) return false;
    }
    return true;
  }, [visibleRows, selectedIds]);

  function toggleSelectAllVisible() {
    setFailedById({});
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldSelect = !allVisibleSelected;
      if (shouldSelect) {
        for (const e of visibleRows) next.add(String(e.id));
      } else {
        for (const e of visibleRows) next.delete(String(e.id));
      }
      return next;
    });
  }

  function toggleRow(id: string) {
    setFailedById((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkCategoryId("__NONE__");
    setFailedById({});
  }

  // Bulk apply state + confirm
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("__NONE__");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Per-row status
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [failedById, setFailedById] = useState<Record<string, string>>({});

  async function applyCategoryToEntry(entryId: string, categoryId: string | null) {
    if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");

    setPendingIds((m) => ({ ...m, [entryId]: true }));
    setFailedById((m) => {
      const next = { ...m };
      delete next[entryId];
      return next;
    });

    const prev = (qc.getQueryData(entriesKey) as any[] | undefined) ?? [];
    const idx = prev.findIndex((x: any) => String(x.id) === entryId);
    const prevEntry = idx >= 0 ? prev[idx] : null;

    // Optimistic update (remove from view if uncategorized filter is on)
    if (idx >= 0) {
      const next = prev.slice();
      next[idx] = { ...next[idx], category_id: categoryId };
      qc.setQueryData(entriesKey, next);
    }

    try {
      await updateEntry({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        entryId,
        updates: { category_id: categoryId },
      });
    } catch (e: any) {
      // Revert this entry only
      if (idx >= 0 && prevEntry) {
        const cur = (qc.getQueryData(entriesKey) as any[] | undefined) ?? [];
        const j = cur.findIndex((x: any) => String(x.id) === entryId);
        if (j >= 0) {
          const next = cur.slice();
          next[j] = prevEntry;
          qc.setQueryData(entriesKey, next);
        }
      }
      setFailedById((m) => ({ ...m, [entryId]: e?.message ?? "Update failed" }));
      throw e;
    } finally {
      setPendingIds((m) => {
        const next = { ...m };
        delete next[entryId];
        return next;
      });
    }
  }

  async function applySelectedConfirmed() {
    if (bulkCategoryId === "__NONE__") return;

    const categoryId = bulkCategoryId === "__UNCATEGORIZED__" ? null : bulkCategoryId;

    const ids = Array.from(selectedIds);
    const BATCH = 8;

    const successes = new Set<string>();

    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const results = await Promise.allSettled(chunk.map((id) => applyCategoryToEntry(id, categoryId)));
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") successes.add(chunk[idx]);
      });
    }

    setConfirmOpen(false);

    const remaining = ids.filter((id) => !successes.has(id)); // failures stay selected
    if (remaining.length === 0) {
      clearSelection();
      return;
    }

    setSelectedIds(new Set(remaining));
  }

  // Auth handled by AppShell

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Unified header container (match Ledger/Issues) */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<Tags className="h-4 w-4" />}
            title="Category Review"
            afterTitle={capsule}
            right={
              <Button variant="outline" disabled className="h-7 px-2 text-xs opacity-50 cursor-not-allowed" title="Coming soon">
                Bulk confirm (Coming soon)
              </Button>
            }
          />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        <div className="px-3 py-2">
          <FilterBar
            left={
              <>
                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">From</div>
                  <Input type="date" className="h-7 w-[160px] text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">To</div>
                  <Input type="date" className="h-7 w-[160px] text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">Search</div>
                  <Input
                    className="h-7 w-[220px] text-xs"
                    placeholder="Payee or memo"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <div className="ml-2 space-y-1">
                  <div className="text-[11px] text-slate-600">&nbsp;</div>
                  <div className="h-7 px-2 rounded-md border border-slate-200 bg-white flex items-center">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 leading-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={onlyUncategorized}
                        onChange={(e) => setOnlyUncategorized(e.target.checked)}
                      />
                      Uncategorized only
                    </label>
                  </div>
                </div>

                <div className="ml-2 text-[11px] text-slate-500 self-end">
                  Date basis: entry date • Showing up to {entriesLimit} entries
                </div>
              </>
            }
            right={
              <Button type="button" className="h-7 px-3 text-xs" onClick={runFilters} disabled={entriesQ.isLoading}>
                Run
              </Button>
            }
          />
        </div>

        <div className="px-3 pb-2">
          <InlineBanner title="Can’t load category review" message={bannerMsgWithEntries} onRetry={() => router.refresh()} />
        </div>

        {!selectedBusinessId && !businessesQ.isLoading ? (
          <div className="px-3 pb-2">
            <EmptyStateCard
              title="No business yet"
              description="Create a business to start using BynkBook."
              primary={{ label: "Create business", href: "/settings?tab=business" }}
              secondary={{ label: "Reload", onClick: () => router.refresh() }}
            />
          </div>
        ) : null}

        {selectedBusinessId && !accountsQ.isLoading && (accountsQ.data ?? []).length === 0 ? (
          <div className="px-3 pb-2">
            <EmptyStateCard
              title="No accounts yet"
              description="Add an account to start importing and categorizing transactions."
              primary={{ label: "Add account", href: "/settings?tab=accounts" }}
              secondary={{ label: "Reload", onClick: () => router.refresh() }}
            />
          </div>
        ) : null}
      </div>

      {/* Table card */}
      <Card>
        <CHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="inline-flex items-center gap-2">
              Uncategorized
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-violet-50 px-1.5 text-[11px] font-semibold text-violet-800 border border-violet-200">
                {visibleRows.filter((e: any) => !e.category_id).length}
              </span>
            </CardTitle>
          </div>
        </CHeader>

        <CardContent className="space-y-3">
          {err ? (
            <div className="text-sm text-red-600" role="alert">
              {err}
            </div>
          ) : null}

          {entriesQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : visibleRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No entries match these filters.</div>
          ) : (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="h-[calc(100vh-340px)] overflow-y-auto">
                <LedgerTableShell
                  colgroup={
                    <>
                      <col style={{ width: 44 }} />
                      <col style={{ width: 120 }} />
                      <col />
                      <col style={{ width: 160 }} />
                      <col style={{ width: 220 }} />
                      <col style={{ width: 220 }} />
                      <col style={{ width: 120 }} />
                    </>
                  }
                  header={
                    <tr className="h-8">
                      <th className="px-0 text-center align-middle">
                        <div className="flex h-8 items-center justify-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAllVisible}
                          />
                        </div>
                      </th>
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Date</th>
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Payee</th>
                      <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Amount</th>
                      <th className="px-3 text-center text-[11px] font-semibold text-slate-600">AI Suggestion</th>
                      <th className="px-3 text-center text-[11px] font-semibold text-slate-600">Category</th>
                      <th className="px-3 text-center text-[11px] font-semibold text-slate-600">Apply</th>
                    </tr>
                  }
                  addRow={null}
                  body={
                    <>
                      {visibleRows.map((e: any) => {
                        const id = String(e.id);
                        const payee = String(e.payee ?? "");
                        const dateYmd = String(e.date ?? "").slice(0, 10);
                        const failMsg = failedById[id];
                        const isSelected = selectedIds.has(id);

                        const categoryLabel = e.category_id
                          ? (categoryNameById[String(e.category_id)] ?? "Unknown category")
                          : "Uncategorized";

                        return (
                          <tr key={id} className={`h-8 border-b border-slate-100 ${isSelected ? "bg-emerald-50/40" : ""}`}>
                            <td className="px-0 text-center align-middle">
                              <div className="flex h-8 items-center justify-center">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={isSelected}
                                  onChange={() => toggleRow(id)}
                                />
                              </div>
                            </td>

                            <td className="px-3 text-sm text-slate-700 whitespace-nowrap">{dateYmd}</td>

                            <td className="px-3 text-sm text-slate-900 truncate font-medium">{payee}</td>

                            <td
                              className={`px-3 text-sm text-right tabular-nums ${Number(e.amount_cents) < 0 ? "text-red-700" : "text-slate-900"
                                }`}
                            >
                              {formatUsdAccountingFromCents(e.amount_cents)}
                            </td>

                            <td className="px-3 text-center">
                              <Button variant="outline" disabled className="h-6 px-3 text-xs opacity-50 cursor-not-allowed" title="Coming soon">
                                Coming soon
                              </Button>
                            </td>

                            <td className="px-3">
                              <div className="flex items-center justify-center gap-2">
                                <div className="h-6 w-[180px] rounded-md border border-slate-200 bg-slate-50 px-2 text-xs flex items-center">
                                  <span className="truncate">{categoryLabel}</span>
                                </div>
                                {failMsg ? <span className="text-[11px] text-red-600">Failed</span> : null}
                              </div>
                            </td>

                            <td className="px-3 text-center">
                              <Button className="h-6 px-4 text-xs min-w-[72px]" disabled title="Use bulk apply below">
                                Apply
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  }
                  footer={null}
                />
              </div>
            </div>
          )}

          {/* Reserve space so sticky bar doesn't cover last row */}
          {selectedCount > 0 ? <div className="h-12" /> : null}

          {/* Sticky bulk action bar */}
          {selectedCount > 0 ? (
            <div className="sticky bottom-0 z-10 rounded-lg border border-slate-200 bg-white shadow-sm px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-slate-700">
                  <span className="font-medium">{selectedCount}</span> selected
                  {Object.keys(failedById).length ? (
                    <span className="ml-2 text-red-600">• {Object.keys(failedById).length} failed</span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <select
                    className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs"
                    value={bulkCategoryId}
                    onChange={(e) => setBulkCategoryId(e.target.value)}
                  >
                    <option value="__NONE__">Choose category…</option>
                    <option value="__UNCATEGORIZED__">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <Button className="h-7 px-3 text-xs" disabled={bulkCategoryId === "__NONE__"} onClick={() => setConfirmOpen(true)}>
                    Apply to selected
                  </Button>

                  <Button variant="outline" className="h-7 px-3 text-xs" onClick={clearSelection}>
                    Clear
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <AppDialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            title="Confirm bulk apply"
            size="md"
            disableOverlayClose={false}
            footer={
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={applySelectedConfirmed} disabled={bulkCategoryId === "__NONE__" || Object.keys(pendingIds).length > 0}>
                  Apply
                </Button>
              </div>
            }
          >
            <div className="text-sm text-slate-700">
              Apply the selected category to <span className="font-medium">{selectedCount}</span> entries?
              <div className="mt-2 text-[11px] text-slate-500">This is explicit and will not run automatically.</div>
            </div>
          </AppDialog>
        </CardContent>
      </Card>
    </div>
  );
}
