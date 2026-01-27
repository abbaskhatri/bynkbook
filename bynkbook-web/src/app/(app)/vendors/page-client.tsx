"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";
import { Building2 } from "lucide-react";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { listVendors, createVendor } from "@/lib/api/vendors";

// Upload invoice stays as-is (pipeline already exists)
import { UploadPanel } from "@/components/uploads/UploadPanel";

type SortKey = "name_asc" | "name_desc" | "updated_desc";

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
  const [vendors, setVendors] = useState<any[]>([]);

  const [openUpload, setOpenUpload] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  async function refresh() {
    if (!businessId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await listVendors({ businessId, q: q.trim() || undefined, sort });
      setVendors(res.vendors ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load vendors");
    } finally {
      setLoading(false);
    }
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
      setErr(e?.message ?? "Failed to create vendor");
    } finally {
      setLoading(false);
    }
  }

  // auto-load
  useState(() => {
    if (businessId && vendors.length === 0 && !loading && !err) refresh();
  });

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

      {err ? <div className="text-xs text-red-600 ml-1">{err}</div> : null}
    </div>
  }
  right={null}
/>
        </div>
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
              <col style={{ width: 220 }} />
              <col style={{ width: 220 }} />
            </>
          }
          header={
            <tr className="h-9">
              <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Vendor</th>
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
