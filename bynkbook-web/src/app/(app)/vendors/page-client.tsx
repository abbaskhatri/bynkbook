"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";
import { Building2 } from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { listVendors, createVendor } from "@/lib/api/vendors";
import { getVendorsApSummary } from "@/lib/api/ap";

// Upload invoice stays as-is (pipeline already exists)
import { UploadPanel } from "@/components/uploads/UploadPanel";

type SortKey = "name_asc" | "name_desc" | "updated_desc";

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

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const bannerMsg = err || appErrorMessageOrNull(businessesQ.error) || null;

  const [vendors, setVendors] = useState<any[]>([]);
  const [apByVendorId, setApByVendorId] = useState<Record<string, any>>({});

  const [openUpload, setOpenUpload] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  async function refresh() {
    if (!businessId) return;

    let mounted = true;
    const cancel = () => { mounted = false; };

    // If this refresh was triggered while unmounting, guard state updates
    setLoading(true);
    setErr(null);

    try {
      const res = await listVendors({ businessId, q: q.trim() || undefined, sort });
      if (!mounted) return;

      const list = res.vendors ?? [];
      setVendors(list);

      const ids = list.map((v: any) => String(v.id)).slice(0, 200);
      const sumRes = await getVendorsApSummary({ businessId, vendorIds: ids, limit: 200 });
      if (!mounted) return;

      const m: Record<string, any> = {};
      for (const row of (sumRes.vendors ?? [])) m[String(row.vendor_id)] = row;
      setApByVendorId(m);
    } catch (e: any) {
      if (!mounted) return;
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      if (!mounted) return;
      setLoading(false);
    }

    // Attach cancel to window lifecycle for safety
    window.addEventListener("beforeunload", cancel, { once: true });
  }

  async function onCreate() {
    if (!businessId) return;
    if (!name.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await createVendor({ businessId, name: name.trim(), notes: notes.trim() || undefined });
      setCreateOpen(false);
      setName("");
      setNotes("");
      await refresh();
      router.push(`/vendors/${res.vendor.id}?businessId=${encodeURIComponent(businessId)}`);
    } catch (e: any) {
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // auto-load
  useEffect(() => {
    if (businessId && vendors.length === 0 && !loading && !err) refresh();
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
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<Building2 className="h-4 w-4" />}
            title="Vendors"
            right={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                  onClick={() => setOpenUpload(true)}
                >
                  Upload Invoice
                </button>

                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                  disabled={!canWrite}
                  title={!canWrite ? "Insufficient permissions" : "Add vendor"}
                  onClick={() => setCreateOpen(true)}
                >
                  Add Vendor
                </button>
              </div>
            }
          />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        <div className="px-3 py-2">
          <FilterBar
  left={
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <div className="text-[11px] text-slate-600">Search</div>
        <Input
          className="h-7 w-[260px] text-xs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search vendors…"
        />
      </div>

      <div className="space-y-1">
        <div className="text-[11px] text-slate-600">Sort</div>
        <select
          className="h-7 w-[180px] text-xs rounded-md border border-slate-200 bg-white px-2"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          <option value="name_asc">Name A→Z</option>
          <option value="name_desc">Name Z→A</option>
          <option value="updated_desc">Recently updated</option>
        </select>
      </div>

      <Button variant="outline" className="h-7 px-3 text-xs" onClick={refresh} disabled={!businessId || loading}>
        {loading ? "Loading…" : "Refresh"}
      </Button>

    </div>
  }
  right={null}
/>
        </div>

        <div className="px-3 pb-2">
          <InlineBanner title="Can’t load vendors" message={bannerMsg} onRetry={() => router.refresh()} />
        </div>

        {!businessId && !businessesQ.isLoading ? (
          <div className="px-3 pb-2">
            <EmptyStateCard
              title="No business yet"
              description="Create a business to start using BynkBook."
              primary={{ label: "Create business", href: "/settings?tab=business" }}
              secondary={{ label: "Reload", onClick: () => router.refresh() }}
            />
          </div>
        ) : null}
      </div>

      {vendors.length === 0 && !loading ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
          <div className="text-sm font-semibold text-slate-900">No vendors yet</div>
          <div className="text-sm text-slate-600 mt-1">Create a vendor to track invoices and activity.</div>
          <div className="mt-3">
            <Button className="h-7 px-3 text-xs" onClick={() => setCreateOpen(true)} disabled={!canWrite}>
              Add Vendor
            </Button>
          </div>
        </div>
      ) : (
        <LedgerTableShell
          colgroup={
            <>
              <col />
              <col style={{ width: 160 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 220 }} />
            </>
          }
          header={
            <tr className="h-9">
              <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Vendor</th>
              <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Open AP</th>
              <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Aging</th>
              <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Updated</th>
              <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Created</th>
            </tr>
          }
          addRow={null}
          body={
            <>
              {vendors.map((v: any) => (
                <tr
                  key={v.id}
                  className="h-9 border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => {
                    if (!businessId) return;
                    router.push(`/vendors/${v.id}?businessId=${encodeURIComponent(businessId)}`);
                  }}
                >
                  <td className="px-3 text-sm">{v.name}</td>

                  <td className="px-3 text-sm tabular-nums font-semibold">
                    {(() => {
                      const row = apByVendorId[String(v.id)];
                      const cents = toBigIntSafe(row?.total_open_cents ?? 0);
                      const txt = formatUsdFromCents(cents);
                      return <span className={cents > 0n ? "text-slate-900" : "text-slate-400"}>{txt}</span>;
                    })()}
                  </td>

                  <td className="px-3 text-xs text-slate-600 tabular-nums">
                    {(() => {
                      const row = apByVendorId[String(v.id)];
                      const a = row?.aging;
                      if (!a) return "—";
                      const c = toBigIntSafe(a.current ?? 0);
                      const d30 = toBigIntSafe(a.days_30 ?? 0);
                      const d60 = toBigIntSafe(a.days_60 ?? 0);
                      const d90 = toBigIntSafe(a.days_90 ?? 0);
                      return `C ${formatUsdFromCents(c)} • 30 ${formatUsdFromCents(d30)} • 60 ${formatUsdFromCents(d60)} • 90+ ${formatUsdFromCents(d90)}`;
                    })()}
                  </td>

                  <td className="px-3 text-sm text-slate-600">{String(v.updated_at ?? "").slice(0, 10)}</td>
                  <td className="px-3 text-sm text-slate-600">{String(v.created_at ?? "").slice(0, 10)}</td>
                </tr>
              ))}
            </>
          }
          footer={null}
        />
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
        onClose={() => setCreateOpen(false)}
        title="Add vendor"
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" className="h-7 px-3 text-xs" onClick={() => setCreateOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button className="h-7 px-3 text-xs" onClick={onCreate} disabled={loading || !name.trim()}>
              Create
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-[11px] text-slate-600">Name</div>
            <Input className="h-7 text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" />
          </div>

          <div className="space-y-1">
            <div className="text-[11px] text-slate-600">Notes (optional)</div>
            <Input className="h-7 text-xs" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" />
          </div>
        </div>
      </AppDialog>
    </div>
  );
}
