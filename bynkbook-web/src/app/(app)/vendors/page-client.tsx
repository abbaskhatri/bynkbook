"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";
import { Building2, Loader2 } from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { listVendors, createVendor } from "@/lib/api/vendors";
import { listCategories, type CategoryRow } from "@/lib/api/categories";
import { getVendorsApSummary } from "@/lib/api/ap";

// Upload invoice stays as-is (pipeline already exists)
import { UploadPanel } from "@/components/uploads/UploadPanel";

type SortKey = "name_asc" | "name_desc" | "updated_desc";

const VENDOR_AP_SUMMARY_BATCH_SIZE = 100;

function toBigIntSafe(v: any): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch {}
  return 0n;
}

function formatUsdFromCents(cents: bigint) {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const dollars = abs / 100n;
  const pennies = abs % 100n;
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const core = `${withCommas}.${pennies.toString().padStart(2, "0")}`;
  return neg ? `($${core})` : `$${core}`;
}

function formatOptionalUsdFromCents(cents: any) {
  if (cents === null || cents === undefined) return null;
  return formatUsdFromCents(toBigIntSafe(cents));
}

function UpdatingOverlay({ label = "Updating…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-bb-surface-card/55 backdrop-blur-[1px]">
      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-bb-border bg-bb-surface-card px-3 py-1 text-xs font-medium text-bb-text shadow-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export default function VendorsPageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const businessesQ = useBusinesses();

  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;
  const businessId = bizIdFromUrl ?? (businessesQ.data?.[0]?.id ?? null);

  const myRole = useMemo(() => {
    if (!businessId) return "";
    const b = (businessesQ.data ?? []).find((x: any) => x?.id === businessId);
    return String(b?.role ?? "").toUpperCase();
  }, [businessId, businessesQ.data]);

  const canWrite = ["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"].includes(myRole);

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("name_asc");

  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [apSummaryLoading, setApSummaryLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);

  const refreshEpochRef = useRef(0);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);
  const apSummaryEpochRef = useRef(0);
  const categoriesLoadEpochRef = useRef(0);
  const categoriesBusinessIdRef = useRef<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const bannerMsg = err || appErrorMessageOrNull(businessesQ.error) || null;

  const [vendors, setVendors] = useState<any[]>([]);
  const [apByVendorId, setApByVendorId] = useState<Record<string, any>>({});

  const [openUpload, setOpenUpload] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [categoryRows, setCategoryRows] = useState<CategoryRow[]>([]);

  async function hydrateApSummary(list: any[], sourceRefreshEpoch: number, sourceBusinessId: string) {
    const myApEpoch = ++apSummaryEpochRef.current;
    const ids = list.map((v: any) => String(v.id));
    if (ids.length === 0) {
      setApByVendorId({});
      setApSummaryLoading(false);
      return;
    }

    setApSummaryLoading(true);
    try {
      const chunks = Array.from({ length: Math.ceil(ids.length / VENDOR_AP_SUMMARY_BATCH_SIZE) }, (_, i) =>
        ids.slice(i * VENDOR_AP_SUMMARY_BATCH_SIZE, (i + 1) * VENDOR_AP_SUMMARY_BATCH_SIZE)
      );
      const summaryResponses = await Promise.all(
        chunks.map((chunk) => getVendorsApSummary({ businessId: sourceBusinessId, vendorIds: chunk, limit: chunk.length }))
      );
      if (sourceRefreshEpoch !== refreshEpochRef.current || myApEpoch !== apSummaryEpochRef.current) return;

      const m: Record<string, any> = {};
      for (const res of summaryResponses) {
        for (const row of (res.vendors ?? [])) m[String(row.vendor_id)] = row;
      }
      setApByVendorId(m);
    } catch (e: any) {
      if (sourceRefreshEpoch !== refreshEpochRef.current || myApEpoch !== apSummaryEpochRef.current) return;
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      if (sourceRefreshEpoch === refreshEpochRef.current && myApEpoch === apSummaryEpochRef.current) {
        setApSummaryLoading(false);
      }
    }
  }

  async function ensureCategoriesLoaded() {
    if (!businessId) return;
    if (categoriesLoading) return;
    if (categoriesLoaded && categoriesBusinessIdRef.current === businessId) return;

    const myEpoch = ++categoriesLoadEpochRef.current;
    if (categoriesBusinessIdRef.current !== businessId) {
      setCategoryRows([]);
      setDefaultCategoryId("");
      setCategoriesLoaded(false);
    }
    setCategoriesLoading(true);
    setErr(null);

    try {
      const catsRes = await listCategories(businessId, { includeArchived: false });
      if (myEpoch !== categoriesLoadEpochRef.current) return;

      setCategoryRows(Array.isArray(catsRes.rows) ? catsRes.rows : []);
      setCategoriesLoaded(true);
      categoriesBusinessIdRef.current = businessId;
    } catch (e: any) {
      if (myEpoch !== categoriesLoadEpochRef.current) return;
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      if (myEpoch === categoriesLoadEpochRef.current) setCategoriesLoading(false);
    }
  }

  function openCreateVendorDialog() {
    setCreateOpen(true);
    void ensureCategoriesLoaded();
  }

  async function refresh() {
    if (!businessId) return;

    // Coalesce refresh calls: 1 in-flight, 1 queued
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    const myEpoch = ++refreshEpochRef.current;
    ++apSummaryEpochRef.current;
    setVendorsLoading(true);
    setApSummaryLoading(false);
    setErr(null);

    const run = (async () => {
      try {
        const res = await listVendors({ businessId, q: q.trim() || undefined, sort });
        if (myEpoch !== refreshEpochRef.current) return;

        const list = res.vendors ?? [];
        setVendors(list);
        setApByVendorId({});
        void hydrateApSummary(list, myEpoch, businessId);
      } catch (e: any) {
        if (myEpoch !== refreshEpochRef.current) return;
        setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
      } finally {
        if (myEpoch === refreshEpochRef.current) setVendorsLoading(false);
      }
    })();

    refreshInFlightRef.current = run;

    try {
      await run;
    } finally {
      if (refreshInFlightRef.current === run) refreshInFlightRef.current = null;

      // Run one queued refresh (latest scope wins due to epoch)
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        void refresh();
      }
    }
  }

  async function onCreate() {
    if (!businessId) return;
    if (!name.trim()) return;
    setCreateLoading(true);
    setErr(null);
    try {
      const res = await createVendor({
        businessId,
        name: name.trim(),
        notes: notes.trim() || undefined,
        default_category_id: defaultCategoryId || null,
      });
      setCreateOpen(false);
      setName("");
      setNotes("");
      setDefaultCategoryId("");
      await refresh();
      router.push(`/vendors/${res.vendor.id}?businessId=${encodeURIComponent(businessId)}`);
    } catch (e: any) {
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      setCreateLoading(false);
    }
  }

  // auto-load
  useEffect(() => {
    if (businessId && vendors.length === 0 && !vendorsLoading && !err) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  // refresh vendors list after invoice uploads (no manual refresh required)
  useEffect(() => {
    function onRefresh() {
      refresh();
    }
    window.addEventListener("bynk:vendors-refresh", onRefresh as any);
    return () => window.removeEventListener("bynk:vendors-refresh", onRefresh as any);
  }, [businessId, q, sort]);

  return (
    <div className="flex flex-col gap-2 overflow-hidden max-w-6xl">
      <div className="rounded-xl border border-bb-border bg-bb-surface-card shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<Building2 className="h-4 w-4" />}
            title="Vendors"
            right={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"
                  onClick={() => setOpenUpload(true)}
                >
                  Upload Invoice
                </button>

                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover disabled:opacity-50"
                  disabled={!canWrite}
                  title={!canWrite ? "Insufficient permissions" : "Add vendor"}
                  onClick={openCreateVendorDialog}
                >
                  Add Vendor
                </button>
              </div>
            }
          />
        </div>

        <div className="mt-2 h-px bg-bb-border" />

        <div className="px-3 py-2">
          <FilterBar
  left={
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <div className="text-[11px] text-bb-text-muted">Search</div>
        <Input
          className="h-7 w-[260px] text-xs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search vendors…"
        />
      </div>

      <div className="space-y-1">
        <div className="text-[11px] text-bb-text-muted">Sort</div>
        <select
          className="h-7 w-[180px] text-xs rounded-md border border-bb-input-border bg-bb-input-bg px-2"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          <option value="name_asc">Name A→Z</option>
          <option value="name_desc">Name Z→A</option>
          <option value="updated_desc">Recently updated</option>
        </select>
      </div>

      <Button variant="outline" className="h-7 px-3 text-xs" onClick={refresh} disabled={!businessId || vendorsLoading}>
        <span className="inline-flex items-center gap-2">
          {vendorsLoading ? <Loader2 className="h-3 w-3 text-bb-text-subtle animate-spin" /> : null}
          <span>Refresh</span>
        </span>
      </Button>

    </div>
  }
  right={null}
/>
        </div>

        <div className="px-3 pb-2">
        {bannerMsg ? (
          <InlineBanner title="Can’t load vendors" message={bannerMsg} onRetry={() => void refresh()} />
        ) : null}
        </div>

        {!businessId && !businessesQ.isLoading ? (
          <div className="px-3 pb-2">
            <EmptyStateCard
              title="No business yet"
              description="Create a business to start using BynkBook."
              primary={{ label: "Create business", href: "/settings?tab=business" }}
              secondary={{ label: "Reload", onClick: () => void refresh() }}
            />
          </div>
        ) : null}
      </div>

      {vendors.length === 0 && !vendorsLoading ? (
        <div className="rounded-xl border border-bb-border bg-bb-surface-card shadow-sm p-6">
          <div className="text-sm font-semibold text-bb-text">No vendors yet</div>
          <div className="text-sm text-bb-text-muted mt-1">Create a vendor to track invoices and activity.</div>
          <div className="mt-3">
            <Button className="h-7 px-3 text-xs" onClick={openCreateVendorDialog} disabled={!canWrite}>
              Add Vendor
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative">
          {vendorsLoading && vendors.length > 0 ? <UpdatingOverlay /> : null}
          <div className={vendorsLoading && vendors.length > 0 ? "pointer-events-none select-none blur-[1px]" : ""}>
            <LedgerTableShell
          colgroup={
            <>
              <col style={{ width: 260 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 360 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
            </>
          }
          header={
            <tr className="h-9">
              <th className="px-3 text-left text-[11px] font-semibold text-bb-text-muted">Vendor</th>
              <th className="px-3 text-left text-[11px] font-semibold text-bb-text-muted">Open AP</th>
              <th className="px-3 text-left text-[11px] font-semibold text-bb-text-muted">Aging</th>
              <th className="px-3 text-left text-[11px] font-semibold text-bb-text-muted">Updated</th>
              <th className="px-3 text-left text-[11px] font-semibold text-bb-text-muted">Created</th>
            </tr>
          }
          addRow={null}
          body={
            vendorsLoading && vendors.length === 0 ? (
              <>
                {Array.from({ length: 10 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="h-9 border-b border-bb-border-muted">
                    <td className="px-3">
                      <div className="h-3 w-40 rounded bg-bb-border animate-pulse" />
                    </td>
                    <td className="px-3">
                      <div className="h-3 w-24 rounded bg-bb-border animate-pulse ml-auto" />
                    </td>
                    <td className="px-3">
                      <div className="h-3 w-56 rounded bg-bb-border animate-pulse" />
                    </td>
                    <td className="px-3">
                      <div className="h-3 w-20 rounded bg-bb-border animate-pulse" />
                    </td>
                    <td className="px-3">
                      <div className="h-3 w-20 rounded bg-bb-border animate-pulse" />
                    </td>
                  </tr>
                ))}
              </>
            ) : (
              <>
                {vendors.map((v: any) => (
                  <tr
                    key={v.id}
                    className="h-9 border-b border-bb-border-muted hover:bg-bb-table-row-hover cursor-pointer"
                    onClick={() => {
                      if (!businessId) return;
                      router.push(`/vendors/${v.id}?businessId=${encodeURIComponent(businessId)}`);
                    }}
                  >
                    <td className="px-3 text-sm">
                      <div className="truncate" title={String(v.name ?? "")}>{v.name}</div>
                    </td>

                    <td className="px-3 text-sm tabular-nums font-semibold">
                      {(() => {
                        const row = apByVendorId[String(v.id)];
                        if (!row) {
                          return apSummaryLoading ? (
                            <span className="inline-flex items-center text-bb-text-subtle" title="Loading AP summary">
                              <Loader2 className="h-3 w-3 animate-spin" />
                            </span>
                          ) : (
                            <span className="text-bb-text-subtle">—</span>
                          );
                        }
                        const txt = formatOptionalUsdFromCents(row?.total_open_cents);
                        if (!txt) return <span className="text-bb-text-subtle">—</span>;
                        const cents = toBigIntSafe(row.total_open_cents);
                        return <span className={cents > 0n ? "text-bb-text" : "text-bb-text-subtle"}>{txt}</span>;
                      })()}
                    </td>

                    <td className="px-3 text-xs text-bb-text-muted tabular-nums">
                      {(() => {
                        const row = apByVendorId[String(v.id)];
                        const a = row?.aging;
                        if (!a) return apSummaryLoading ? <span className="text-bb-text-subtle">Loading…</span> : "—";
                        const current = formatOptionalUsdFromCents(a.current);
                        const days30 = formatOptionalUsdFromCents(a.days_30);
                        const days60 = formatOptionalUsdFromCents(a.days_60);
                        const days90 = formatOptionalUsdFromCents(a.days_90);
                        if (!current || !days30 || !days60 || !days90) return "—";
                        const text = `C ${current} • 30 ${days30} • 60 ${days60} • 90+ ${days90}`;
                        return <div className="truncate" title={text}>{text}</div>;
                      })()}
                    </td>

                    <td className="px-3 text-sm text-bb-text-muted">{String(v.updated_at ?? "").slice(0, 10)}</td>
                    <td className="px-3 text-sm text-bb-text-muted">{String(v.created_at ?? "").slice(0, 10)}</td>
                  </tr>
                ))}
              </>
            )
          }
          footer={null}
        />
          </div>
        </div>
      )}

      <UploadPanel
        open={openUpload}
        onClose={() => setOpenUpload(false)}
        type="INVOICE"
        ctx={{ businessId: businessId ?? undefined }}
        allowMultiple={true}
      />

      <AppDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setDefaultCategoryId("");
        }}
        title="Add vendor"
        size="xs"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" className="h-7 px-3 text-xs" onClick={() => setCreateOpen(false)} disabled={createLoading}>
              Cancel
            </Button>
            <Button className="h-7 px-3 text-xs" onClick={onCreate} disabled={createLoading || !name.trim()}>
              {createLoading ? "Creating…" : "Create"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-[11px] text-bb-text-muted">Name</div>
            <Input className="h-7 text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" />
          </div>

          <div className="space-y-1">
            <div className="text-[11px] text-bb-text-muted">Notes (optional)</div>
            <Input className="h-7 text-xs" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" />
          </div>

          <div className="space-y-1">
            <div className="text-[11px] text-bb-text-muted">Default category (optional)</div>
            <select
              className="h-7 w-full rounded-md border border-bb-input-border bg-bb-input-bg px-2 text-xs"
              value={defaultCategoryId}
              onChange={(e) => setDefaultCategoryId(e.target.value)}
              disabled={categoriesLoading && categoryRows.length === 0}
            >
              <option value="">{categoriesLoading ? "Loading categories…" : "None"}</option>
              {categoryRows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {categoriesLoading ? (
              <div className="inline-flex items-center gap-1 text-[11px] text-bb-text-muted">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading categories</span>
              </div>
            ) : null}
          </div>
        </div>
      </AppDialog>
    </div>
  );
}
