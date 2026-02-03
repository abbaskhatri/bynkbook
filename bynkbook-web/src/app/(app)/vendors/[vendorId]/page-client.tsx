"use client";

import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2 } from "lucide-react";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { getVendor, updateVendor } from "@/lib/api/vendors";

import { UploadPanel } from "@/components/uploads/UploadPanel";
import { UploadsList } from "@/components/uploads/UploadsList";

export default function VendorDetailPageClient() {
  const params = useParams<{ vendorId: string }>();
  const sp = useSearchParams();
  const businessesQ = useBusinesses();

  const vendorId = String(params.vendorId ?? "");
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;
  const businessId = bizIdFromUrl ?? (businessesQ.data?.[0]?.id ?? null);

  const myRole = useMemo(() => {
    if (!businessId) return "";
    const b = (businessesQ.data ?? []).find((x: any) => x?.id === businessId);
    return String(b?.role ?? "").toUpperCase();
  }, [businessId, businessesQ.data]);

  const canWrite = ["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"].includes(myRole);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [vendor, setVendor] = useState<any>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  const [openUpload, setOpenUpload] = useState(false);

  async function refresh() {
    if (!businessId || !vendorId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await getVendor({ businessId, vendorId });
      setVendor(res.vendor);
      setName(String(res.vendor?.name ?? ""));
      setNotes(String(res.vendor?.notes ?? ""));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load vendor");
    } finally {
      setLoading(false);
    }
  }

  async function onSave() {
    if (!businessId || !vendorId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await updateVendor({
        businessId,
        vendorId,
        name: name.trim(),
        notes: notes.trim(),
      });
      setVendor(res.vendor);
      setEditOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update vendor");
    } finally {
      setLoading(false);
    }
  }

  useState(() => {
    if (businessId && vendorId && !vendor && !loading && !err) refresh();
  });

  return (
    <div className="flex flex-col gap-2 overflow-hidden max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<Building2 className="h-4 w-4" />}
            title={vendor?.name ?? "Vendor"}
            right={
  <div className="flex items-center gap-2">
    <button
      type="button"
      className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
      onClick={() => {
        if (!businessId) return;
        // keep business context
        window.location.href = `/vendors?businessId=${encodeURIComponent(businessId)}`;
      }}
    >
      Back
    </button>

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
                  title={!canWrite ? "Insufficient permissions" : "Edit vendor"}
                  onClick={() => setEditOpen(true)}
                >
                  Edit
                </button>
              </div>
            }
          />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        <div className="px-3 py-2">
          <FilterBar
            left={<div className="text-xs text-slate-600">Invoices are filtered by this vendor.</div>}
            right={
              <>
                <Button variant="outline" className="h-7 px-3 text-xs" onClick={refresh} disabled={loading || !businessId}>
                  Refresh
                </Button>
                {err ? <div className="text-xs text-red-600 ml-1">{err}</div> : null}
              </>
            }
          />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Basic info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {vendor ? (
            <>
              <div><span className="text-slate-600">Name:</span> <span className="font-medium">{vendor.name}</span></div>
              <div><span className="text-slate-600">Notes:</span> <span className="font-medium">{vendor.notes ?? "—"}</span></div>
              <div className="text-slate-600 text-xs">
                Created: {String(vendor.created_at ?? "").slice(0, 10)} • Updated: {String(vendor.updated_at ?? "").slice(0, 10)}
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-600">{loading ? "Loading…" : "Vendor not loaded."}</div>
          )}
        </CardContent>
      </Card>

<Card>
  <CardHeader className="pb-2">
    <CardTitle className="text-sm">Invoice uploads</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="mt-1">
      <UploadsList
        title="Invoice uploads"
        businessId={businessId ?? ""}
        accountId={sp.get("accountId") ?? undefined}
        type="INVOICE"
        vendorId={vendorId}
      />
    </div>
  </CardContent>
</Card>

      <UploadPanel
        open={openUpload}
        onClose={() => setOpenUpload(false)}
        type="INVOICE"
        ctx={{ businessId: businessId ?? undefined }}
        allowMultiple={true}
      />

      <AppDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit vendor"
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" className="h-7 px-3 text-xs" onClick={() => setEditOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button className="h-7 px-3 text-xs" onClick={onSave} disabled={loading || !name.trim()}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-[11px] text-slate-600">Name</div>
            <Input className="h-7 text-xs" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1">
            <div className="text-[11px] text-slate-600">Notes</div>
            <Input className="h-7 text-xs" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </AppDialog>
    </div>
  );
}
