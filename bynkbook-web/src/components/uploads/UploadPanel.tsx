"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppSidePanel } from "@/components/primitives/AppSidePanel";
import { Button } from "@/components/ui/button";
import { UploadCloud, X, CheckCircle2, AlertTriangle, Trash2, Download } from "lucide-react";
import { useUploadController } from "./useUploadController";
import { apiFetch } from "@/lib/api/client";
import {
  type UploadType,
  type UploadContext,
  uploadAccept,
  uploadAllowMultiple,
  uploadHelperText,
  uploadTypeLabel,
} from "./uploadTypes";

type UploadPanelProps = {
  open: boolean;
  onClose: () => void;
  type: UploadType;
  ctx?: UploadContext;

  // Optional: override defaults
  allowMultiple?: boolean;
};

type VendorLite = { id: string; name: string };

function norm(s: string) {
  return String(s || "").trim().toLowerCase();
}

// Convert various date strings into YYYY-MM-DD for <input type="date">
function toIsoDate(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Try Date.parse for "November 05, 2025" and similar
  const d1 = new Date(s);
  if (!isNaN(d1.getTime())) return d1.toISOString().slice(0, 10);

  // Try MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return "";
}

function VendorPicker(props: {
  businessId: string;
  value: VendorLite | null;
  query: string;
  onQueryChange: (v: string) => void;
  onChange: (v: VendorLite | null) => void;
}) {
  const { businessId, value, query, onQueryChange, onChange } = props;

  const [results, setResults] = useState<VendorLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // debounce vendor search (no storms)
  useEffect(() => {
    if (!businessId) return;

    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }

    setLoading(true);
    setErr(null);

    const t = setTimeout(async () => {
      try {
        const res: any = await apiFetch(`/v1/businesses/${businessId}/vendors?q=${encodeURIComponent(q)}`, {
          method: "GET",
        });

        setResults(Array.isArray(res?.vendors) ? res.vendors.map((v: any) => ({ id: v.id, name: v.name })) : []);
      } catch (e: any) {
        setErr(e?.message || "Vendor search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [businessId, query]);

  const canCreate =
    businessId &&
    query.trim().length > 0 &&
    !results.some((r) => norm(r.name) === norm(query));

  async function createVendor() {
    if (!businessId) return;
    const name = query.trim();
    if (!name) return;

    setLoading(true);
    setErr(null);

    try {
      const res: any = await apiFetch(`/v1/businesses/${businessId}/vendors`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });

      if (!res?.ok || !res?.vendor) throw new Error(res?.error || "Create vendor failed");

      const v: VendorLite = { id: res.vendor.id, name: res.vendor.name };
      onChange(v);
      onQueryChange(v.name);
      setResults([]);
    } catch (e: any) {
      setErr(e?.message || "Create vendor failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          className="h-8 flex-1 px-2 text-xs border border-slate-200 rounded-md"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search vendor…"
        />
        {value ? (
          <button
            type="button"
            className="h-8 px-2 text-xs border border-slate-200 rounded-md"
            onClick={() => onChange(null)}
            title="Clear vendor"
          >
            Clear
          </button>
        ) : null}
      </div>

      {value ? (
        <div className="text-xs text-slate-700">
          Selected: <span className="font-medium">{value.name}</span>
        </div>
      ) : null}

      {loading ? <div className="text-[11px] text-slate-500">Searching…</div> : null}
      {err ? <div className="text-[11px] text-red-600">{err}</div> : null}

      {!value && results.length > 0 ? (
        <div className="border border-slate-200 rounded-md overflow-hidden">
          {results.slice(0, 6).map((r) => (
            <button
              key={r.id}
              type="button"
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50"
              onClick={() => onChange(r)}
            >
              {r.name}
            </button>
          ))}
        </div>
      ) : null}

      {!value && canCreate ? (
        <button type="button" className="text-xs text-emerald-700 hover:underline" onClick={createVendor}>
          Create vendor “{query.trim()}”
        </button>
      ) : null}
    </div>
  );
}

export function UploadPanel({ open, onClose, type, ctx, allowMultiple }: UploadPanelProps) {
  const effectiveAllowMultiple = allowMultiple ?? uploadAllowMultiple[type];
  const accept = uploadAccept[type];

  const inputRef = useRef<HTMLInputElement | null>(null);

  // UX
  const [showSummary, setShowSummary] = useState(false);

  // Summary selection + per-row entry date overrides
  const [selectedForEntry, setSelectedForEntry] = useState<Record<string, boolean>>({});
  const [entryDateByUploadId, setEntryDateByUploadId] = useState<Record<string, string>>({});

  const [entryCreateStatus, setEntryCreateStatus] = useState<
    Record<string, { state: "idle" | "creating" | "created" | "already" | "failed"; entryId?: string; error?: string }>
  >({});

  // Metadata
  const [notes, setNotes] = useState("");
  const [vendorQuery, setVendorQuery] = useState("");
  const [selectedVendor, setSelectedVendor] = useState<VendorLite | null>(null);
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");

  const uploadMeta = useMemo(() => {
    if (type !== "INVOICE") return {};
    return selectedVendor ? { vendor_id: selectedVendor.id, vendor_name: selectedVendor.name } : {};
  }, [type, selectedVendor]);

  const controller = useUploadController({ type, ctx, meta: uploadMeta });

  // Reset UI state whenever the panel opens (prevents stale summary/files persisting across sessions)
  useEffect(() => {
    if (!open) return;
    setShowSummary(false);
    setNotes("");
    setVendorQuery("");
    setSelectedVendor(null);
    setStatementFrom("");
    setStatementTo("");

    // IMPORTANT: reset selection state too
    setSelectedForEntry({});
    setEntryDateByUploadId({});

    controller.clearAll();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-switch to summary once all uploads are completed (no need to press Done)
  useEffect(() => {
    if (!open) return;
    if (controller.items.length === 0) return;
    if (controller.hasActiveUploads) return;

    const allDone = controller.items.every((it) => it.status === "COMPLETED" || it.status === "UPLOADED");
    if (allDone) {
      setShowSummary(true);

      // Default selection: all items that have a parsed amount (deterministic, no stubs)
      setSelectedForEntry((prev) => {
        const next = { ...prev };
        for (const it of controller.items) {
          if (!it.uploadId) continue;

          const cents =
            (it.parsed as any)?.amount_cents ??
            (it.completedMeta as any)?.parsed?.amount_cents ??
            null;

          if (typeof cents === "number" && Number.isFinite(cents) && cents !== 0) next[it.uploadId] = true;
        }
        return next;
      });

      // Default entry date: parsed doc_date when available (ISO-ish), else blank
      setEntryDateByUploadId((prev) => {
        const next = { ...prev };
        for (const it of controller.items) {
          if (!it.uploadId) continue;
          const d = toIsoDate(String(it.parsed?.doc_date || "").trim());
          if (d && !next[it.uploadId]) next[it.uploadId] = d;

        }
        return next;
      });
    }
  }, [open, controller.items, controller.hasActiveUploads]);

  const canClose = !controller.hasActiveUploads;
  const overlayCloseDisabled = controller.hasActiveUploads;

  const title = `Upload ${uploadTypeLabel[type]}`;

  const fileHint = useMemo(() => {
    if (type === "BANK_STATEMENT") return "CSV preferred. PDF supported.";
    return "PDF or image files.";
  }, [type]);

  const showBankFields = type === "BANK_STATEMENT";
  const showVendorField = false; // vendor is extracted during parsing

  function pickFiles() {
    inputRef.current?.click();
  }

  function onFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setShowSummary(false);
    controller.enqueueAndStart(files);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer?.files?.length) return;
    setShowSummary(false);
    controller.enqueueAndStart(e.dataTransfer.files);
  }

  return (
    <AppSidePanel
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      disableOverlayClose={overlayCloseDisabled}
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-600">
            {controller.hasActiveUploads ? "Uploading…" : controller.items.length ? "Ready" : "No files selected"}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-7 px-3 text-xs"
              onClick={() => {
                controller.clearAll();
                setNotes("");
                setVendorQuery("");
                setSelectedVendor(null);
                setStatementFrom("");
                setStatementTo("");
                setShowSummary(false);

                // also clear selection state
                setSelectedForEntry({});
                setEntryDateByUploadId({});
              }}
              disabled={controller.items.length === 0 || controller.hasActiveUploads}
            >
              Clear
            </Button>

            <Button
  type="button"
  className="h-7 px-3 text-xs"
  onClick={onClose}
  disabled={controller.hasActiveUploads}
>
  Upload
</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="text-sm text-slate-700">{uploadHelperText[type]}</div>

        {/* Dev-only toggle for overlay close behavior */}

        {/* Drop zone */}
        <div
          className="rounded-lg border border-slate-200 bg-slate-50 p-4"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={onDrop}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <UploadCloud className="h-5 w-5 text-slate-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900">Drag and drop files here</div>
              <div className="text-xs text-slate-600 mt-0.5">
                {fileHint} {effectiveAllowMultiple ? "Bulk upload supported." : "Single file only."}
              </div>

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <Button type="button" className="h-7 px-3 text-xs" onClick={pickFiles}>
                  Choose file{effectiveAllowMultiple ? "s" : ""}
                </Button>

                <div className="text-xs text-slate-500">
                  Accepted: <span className="font-medium">{accept}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Hidden file input */}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={effectiveAllowMultiple}
          className="hidden"
          onChange={(e) => onFilesSelected(e.target.files)}
        />

        {/* Details (bank statement only) */}
        {showBankFields ? (
          <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
            <div className="text-xs font-semibold text-slate-900">Details</div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="text-xs text-slate-600">Statement from</div>
                <input
                  type="date"
                  className="h-7 w-full px-2 text-xs border border-slate-200 rounded-md"
                  value={statementFrom}
                  onChange={(e) => setStatementFrom(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <div className="text-xs text-slate-600">Statement to</div>
                <input
                  type="date"
                  className="h-7 w-full px-2 text-xs border border-slate-200 rounded-md"
                  value={statementTo}
                  onChange={(e) => setStatementTo(e.target.value)}
                />
              </div>

              <div className="col-span-2 text-xs text-slate-500">This stores the file + metadata.</div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-slate-600">Notes (optional)</div>
              <textarea
                className="w-full min-h-[64px] px-2 py-1 text-xs border border-slate-200 rounded-md"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add internal notes…"
              />
            </div>
          </div>
        ) : null}

        {/* Summary */}
        {showSummary && !controller.hasActiveUploads ? (
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
<div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between gap-2">
  <div>
    <div className="text-sm font-semibold text-slate-900">Upload summary</div>
    <div className="text-xs text-slate-600">
      {type === "INVOICE"
        ? "Invoices extracted from uploaded files."
        : type === "RECEIPT"
        ? "Receipts extracted from uploaded files."
        : "Uploaded files."}
    </div>
  </div>

  {/* Entry creation is controlled per-row via checkboxes below */}

</div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-700">
                  {type === "INVOICE" ? (
                    <tr className="border-b border-slate-200">
<th className="px-3 py-2 text-center font-semibold">
  <input
    type="checkbox"
    className="h-4 w-4 rounded border border-slate-300"
      checked={
        controller.items
          .filter((it) => {
            if (!it.uploadId) return false;
            const cents =
              (it.parsed as any)?.amount_cents ??
              (it.completedMeta as any)?.parsed?.amount_cents ??
              null;
            return typeof cents === "number" && Number.isFinite(cents) && cents !== 0;
          })
          .every((it) => !!selectedForEntry[it.uploadId as string]) &&
        controller.items.some((it) => {
          if (!it.uploadId) return false;
          const cents =
            (it.parsed as any)?.amount_cents ??
            (it.completedMeta as any)?.parsed?.amount_cents ??
            null;
          return typeof cents === "number" && Number.isFinite(cents) && cents !== 0;
        })
      }
    onChange={(e) => {
      const checked = e.target.checked;
      setSelectedForEntry((prev) => {
        const next = { ...prev };
        for (const it of controller.items) {
          if (!it.uploadId) continue;
          if (it.parsedStatus !== "PARSED") continue;
          next[it.uploadId] = checked;
        }
        return next;
      });

      // When selecting, auto-fill entry date with today if missing
      if (checked) {
        const today = new Date().toISOString().slice(0, 10);
        setEntryDateByUploadId((prev) => {
          const next = { ...prev };
          for (const it of controller.items) {
            if (!it.uploadId) continue;
            const cents =
              (it.parsed as any)?.amount_cents ??
              (it.completedMeta as any)?.parsed?.amount_cents ??
              null;
            const eligible = it.status === "COMPLETED" && typeof cents === "number" && Number.isFinite(cents) && cents !== 0;
            if (!eligible) continue;
            if (!next[it.uploadId]) next[it.uploadId] = today;
          }
          return next;
        });
      }
    }}
    title="Select all parsed invoices"
  />
</th>

<th className="px-3 py-2 text-left font-semibold">Vendor</th>
<th className="px-3 py-2 text-left font-semibold">Invoice #</th>
<th className="px-3 py-2 text-left font-semibold">Invoice date</th>
<th className="px-3 py-2 text-left font-semibold">Entry date</th>
<th className="px-3 py-2 text-left font-semibold">Due</th>
<th className="px-3 py-2 text-right font-semibold">Total</th>
<th className="px-3 py-2 text-left font-semibold">Status</th>
<th className="px-3 py-2 text-right font-semibold">File</th>
                    </tr>
                  ) : type === "RECEIPT" ? (
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 text-center font-semibold"></th>
                      <th className="px-3 py-2 text-left font-semibold">File</th>
                      <th className="px-3 py-2 text-left font-semibold">Vendor</th>
                      <th className="px-3 py-2 text-left font-semibold">Date</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">File</th>
                    </tr>
                  ) : (
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 text-left font-semibold">File</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">File</th>
                    </tr>
                  )}
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {controller.items.map((it) => {
                    const parsed = it.parsed || null;

                    // If upload completed but parsing hasn't returned yet, show Parsing…
                    const status =
                      it.status === "COMPLETED" && !it.parsedStatus
                        ? "PARSING"
                        : it.parsedStatus || "SKIPPED";

                    const vendor = (parsed?.vendor_name || it.completedMeta?.vendor_name || "") as string;
                    const invoiceNo = (parsed?.doc_number || "") as string;
                    const docDate = (parsed?.doc_date || "") as string;
                    const dueDate = (parsed?.due_date || "") as string;
                    const cents = parsed?.amount_cents ?? null;

                    const total =
                      typeof cents === "number"
                        ? (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })
                        : parsed?.amount_text || "—";

                    const statusLabel =
                      status === "PARSING"
                        ? "Parsing…"
                        : status === "PARSED"
                        ? "Parsed"
                        : status === "NEEDS_REVIEW"
                        ? "Needs review"
                        : status === "FAILED"
                        ? "Failed"
                        : "Uploaded";

                    return (
                      <tr key={it.id}>
                        <td className="px-3 py-2 text-center">
                          {it.uploadId ? (() => {
                            const cents =
                              (it.parsed as any)?.amount_cents ??
                              (it.completedMeta as any)?.parsed?.amount_cents ??
                              null;
                            const eligible = it.status === "COMPLETED" && typeof cents === "number" && Number.isFinite(cents) && cents !== 0;
                            const title =
                              !eligible && it.status !== "COMPLETED"
                                ? "Still retrieving…"
                                : !eligible
                                ? "Missing extracted total"
                                : "Create entry for this receipt";
                            return (
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border border-slate-300"
                                checked={!!selectedForEntry[it.uploadId!]}
                                disabled={!eligible}
                                onChange={(e) => {
                                  const id = it.uploadId!;
                                  setSelectedForEntry((m) => ({ ...m, [id]: e.target.checked }));
                                }}
                                title={title}
                              />
                            );
                          })() : null}
                        </td>

                        {type === "INVOICE" ? (
                          <>
                            <td className="px-3 py-2 text-slate-700">
                              <div className="text-slate-900 font-medium">{vendor || "—"}</div>
                              <div className="text-[11px] text-slate-500 truncate max-w-[260px]" title={it.file.name}>
                                ({it.file.name})
                              </div>
                            </td>

                            <td className="px-3 py-2 text-slate-700">{invoiceNo || "—"}</td>
                            <td className="px-3 py-2 text-slate-700">{docDate || "—"}</td>

<td className="px-3 py-2 text-slate-700">
  {it.uploadId ? (
    <input
      type="date"
      className="h-7 px-2 text-xs border border-slate-200 rounded-md"
      value={entryDateByUploadId[it.uploadId] || ""}
      onChange={(e) => {
        const id = it.uploadId!;
        setEntryDateByUploadId((m) => ({ ...m, [id]: e.target.value }));
      }}
      disabled={!selectedForEntry[it.uploadId]}
      title="Ledger entry date"
    />
  ) : (
    "—"
  )}
</td>

<td className="px-3 py-2 text-slate-700">{dueDate || "—"}</td>
                            <td className="px-3 py-2 text-right text-slate-900">{total || "—"}</td>
                            <td className="px-3 py-2">
                              <span
                                className={
                                  status === "PARSING"
                                    ? "inline-flex items-center rounded-full bg-slate-50 text-slate-700 px-2 py-0.5"
                                    : status === "PARSED"
                                    ? "inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5"
                                    : status === "NEEDS_REVIEW"
                                    ? "inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2 py-0.5"
                                    : status === "FAILED"
                                    ? "inline-flex items-center rounded-full bg-red-50 text-red-700 px-2 py-0.5"
                                    : "inline-flex items-center rounded-full bg-slate-50 text-slate-700 px-2 py-0.5"
                                }
                              >
                                {statusLabel}
                                {it.uploadId ? (
                                  entryCreateStatus[it.uploadId]?.state === "creating" ? (
                                    <span className="ml-2 text-[11px] text-slate-600">Creating…</span>
                                  ) : entryCreateStatus[it.uploadId]?.state === "created" ? (
                                    <span className="ml-2 text-[11px] text-emerald-700">Created</span>
                                  ) : entryCreateStatus[it.uploadId]?.state === "already" ? (
                                    <span className="ml-2 text-[11px] text-slate-600">Already exists</span>
                                  ) : entryCreateStatus[it.uploadId]?.state === "failed" ? (
                                    <span className="ml-2 text-[11px] text-red-700">Failed</span>
                                  ) : null
                                ) : null}
                              </span>
                            </td>
                          </>
                        ) : type === "RECEIPT" ? (
                          <>
                            <td className="px-3 py-2 text-slate-700">
                              <div className="text-slate-900 font-medium">{it.file?.name || "—"}</div>
                            </td>

                            <td className="px-3 py-2 text-slate-700">{vendor || "—"}</td>
                            <td className="px-3 py-2 text-slate-700">{docDate || "—"}</td>
                            <td className="px-3 py-2 text-right text-slate-900">{total || "—"}</td>

                            <td className="px-3 py-2">
                              <span
                                className={
                                  it.status !== "COMPLETED"
                                    ? "inline-flex items-center rounded-full bg-slate-50 text-slate-700 px-2 py-0.5"
                                    : status === "PARSED"
                                    ? "inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5"
                                    : status === "NEEDS_REVIEW"
                                    ? "inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2 py-0.5"
                                    : status === "FAILED"
                                    ? "inline-flex items-center rounded-full bg-red-50 text-red-700 px-2 py-0.5"
                                    : "inline-flex items-center rounded-full bg-slate-50 text-slate-700 px-2 py-0.5"
                                }
                              >
                                {it.status !== "COMPLETED" ? (
                                  <>
                                    <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border border-slate-400 border-t-transparent" />
                                    Still retrieving…
                                  </>
                                ) : (
                                  statusLabel
                                )}

                                {it.uploadId ? (
                                  entryCreateStatus[it.uploadId]?.state === "creating" ? (
                                    <span className="ml-2 text-[11px] text-slate-600">Creating…</span>
                                  ) : entryCreateStatus[it.uploadId]?.state === "created" ? (
                                    <span className="ml-2 text-[11px] text-emerald-700">Created</span>
                                  ) : entryCreateStatus[it.uploadId]?.state === "already" ? (
                                    <span className="ml-2 text-[11px] text-slate-600">Already exists</span>
                                  ) : entryCreateStatus[it.uploadId]?.state === "failed" ? (
                                    <span className="ml-2 text-[11px] text-red-700">Failed</span>
                                  ) : null
                                ) : null}
                              </span>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center rounded-full bg-slate-50 text-slate-700 px-2 py-0.5">
                                {it.status}
                              </span>
                            </td>
                          </>
                        )}

                        <td className="px-3 py-2 text-right">
                          {it.uploadId ? (
                            <div className="inline-flex items-center gap-2 justify-end">
  <Button
    type="button"
    variant="outline"
    className="h-7 w-8 p-0"
    title="Download"
    onClick={async () => {
      const businessId = ctx?.businessId?.trim();
      if (!businessId) return;
      const res: any = await apiFetch(`/v1/businesses/${businessId}/uploads/${it.uploadId}/download`, { method: "GET" });
      const url = res?.download?.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    }}
  >
    <Download className="h-4 w-4 mx-auto" />
  </Button>

  <Button
    type="button"
    variant="outline"
    className="h-7 w-8 p-0"
    title="Remove from list"
    onClick={() => {
  // Remove from list
  controller.remove(it.id);

  // Also clean selection state (prevents "selected" count staying high)
  if (it.uploadId) {
    const uid = it.uploadId;
    setSelectedForEntry((m) => {
      const next = { ...m };
      delete next[uid];
      return next;
    });
    setEntryDateByUploadId((m) => {
      const next = { ...m };
      delete next[uid];
      return next;
    });
  }
}}
  >
    <Trash2 className="h-4 w-4 mx-auto text-slate-500" />
  </Button>
</div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Actions (selected rows) */}
            {(type === "INVOICE" || type === "RECEIPT") && ctx?.businessId ? (
              <div className="px-3 py-2 border-t border-slate-200 flex items-center justify-between">
                <div className="text-xs text-slate-600">
                  {controller.items.filter((it) => it.uploadId && selectedForEntry[it.uploadId]).length} selected
                </div>

                {(() => {
                  const selectedIds = controller.items
                    .map((i) => i.uploadId)
                    .filter(Boolean)
                    .filter((id) => !!selectedForEntry[id as string]) as string[];

                  const selectedEligibleIds = selectedIds.filter((id) => {
                    const it = controller.items.find((x) => x.uploadId === id);
                    if (!it) return false;
                    const cents =
                      (it.parsed as any)?.amount_cents ??
                      (it.completedMeta as any)?.parsed?.amount_cents ??
                      null;
                    return it.status === "COMPLETED" && typeof cents === "number" && Number.isFinite(cents) && cents !== 0;
                  });

                  const blockedCount = selectedIds.length - selectedEligibleIds.length;
                  const disabled = selectedEligibleIds.length === 0 || blockedCount > 0;

                  return (
                    <Button
                      type="button"
                      className="h-8 px-3 text-xs"
                      disabled={disabled}
                      title={blockedCount > 0 ? "Some selected rows are still retrieving or missing a total" : undefined}
                      onClick={async () => {
                        const ids = selectedEligibleIds;
                        if (!ids.length) return;

                        // Mark as creating (non-blocking)
                        setEntryCreateStatus((m) => {
                          const next = { ...m };
                          for (const id of ids) next[id] = { state: "creating" };
                          return next;
                        });

                        const entry_dates: Record<string, string> = {};
                        for (const id of ids) {
                          const v = (entryDateByUploadId[id] || "").trim();
                          if (v) entry_dates[id] = v;
                        }

                        const res: any = await apiFetch(`/v1/businesses/${ctx.businessId}/uploads/create-entries`, {
                          method: "POST",
                          body: JSON.stringify({ upload_ids: ids, entry_dates }),
                        });

                        const results = Array.isArray(res?.results) ? res.results : [];
                        setEntryCreateStatus((m) => {
                          const next = { ...m };
                          for (const r of results) {
                            const uid = String(r.upload_id || "");
                            if (!uid) continue;
                            if (r.entry_id && r.already) next[uid] = { state: "already", entryId: r.entry_id };
                            else if (r.entry_id) next[uid] = { state: "created", entryId: r.entry_id };
                            else next[uid] = { state: "failed", error: r.error || "Failed" };
                          }
                          return next;
                        });

                        window.dispatchEvent(new CustomEvent("bynk:ledger-refresh"));
                      }}
                    >
                      Create entries
                    </Button>
                  );
                })()}
              </div>
            ) : null}

            {/* Footer close is used; no extra close button here */}

          </div>
        ) : null}

        {/* File list */}
        {!showSummary ? (
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-900">Files ({controller.items.length})</div>

              {effectiveAllowMultiple ? (
                <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={pickFiles}>
                  Add more
                </Button>
              ) : null}
            </div>

            {controller.items.length === 0 ? (
              <div className="p-4 text-xs text-slate-600">No files selected yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {controller.items.map((it) => (
                  <div key={it.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{it.file.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {Math.round(it.file.size / 1024)} KB • {it.file.type || "unknown type"}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {it.status === "UPLOADED" || it.status === "COMPLETED" ? (
                          <div className="inline-flex items-center gap-1 text-xs text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" /> Uploaded
                          </div>
                        ) : it.status === "FAILED" ? (
                          <div className="inline-flex items-center gap-1 text-xs text-red-700">
                            <AlertTriangle className="h-4 w-4" /> Failed
                          </div>
                        ) : it.status === "CANCELED" ? (
                          <div className="inline-flex items-center gap-1 text-xs text-slate-600">
                            <X className="h-4 w-4" /> Canceled
                          </div>
                        ) : it.status === "UPLOADING" ? (
                          <div className="text-xs text-slate-700">Uploading…</div>
                        ) : (
                          <div className="text-xs text-slate-700">Queued</div>
                        )}

                        {it.status === "UPLOADING" ? (
                          <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={() => controller.cancel(it.id)}>
                            Cancel
                          </Button>
                        ) : it.status === "FAILED" ? (
                          <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={() => controller.retry(it.id)}>
                            Retry
                          </Button>
                        ) : (
                          <Button type="button" variant="outline" className="h-7 w-8 p-0" onClick={() => controller.remove(it.id)} title="Remove">
                            <Trash2 className="h-4 w-4 mx-auto text-slate-500" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2">
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${it.progress}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">{it.progress}%</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </AppSidePanel>
  );
}
