"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";
import { UploadCloud, X, CheckCircle2, AlertTriangle, Trash2, Download } from "lucide-react";
import { useUploadController } from "./useUploadController";
import { apiFetch } from "@/lib/api/client";

import { AppDatePicker } from "@/components/primitives/AppDatePicker";

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

// Convert various date strings into YYYY-MM-DD for date pickers (YYYY-MM-DD)
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

function uploadReason(it: any) {
  const meta = it?.completedMeta && typeof it.completedMeta === "object" ? it.completedMeta : {};
  const parsed = it?.parsed && typeof it.parsed === "object" ? it.parsed : {};
  const errorCode = String(meta?.error_code || "");
  const errorMessage = String(meta?.error_message || parsed?.error || it?.error || "").trim();
  const reviewReasons = Array.isArray(parsed?.review_reasons) ? parsed.review_reasons : [];

  if (errorCode === "UNSUPPORTED_DOCUMENT_FORMAT") {
    return "Unsupported PDF format for invoice extraction. Try Print to PDF, flatten the PDF, or upload an image.";
  }

  if (errorCode === "NEEDS_REVIEW") {
    const labels: string[] = [];
    if (reviewReasons.includes("vendor")) labels.push("vendor");
    if (reviewReasons.includes("amount")) labels.push("amount");
    if (reviewReasons.includes("invoice_date")) labels.push("invoice date");

    if (labels.length > 0) {
      return `Needs review: confirm ${labels.join(", ")} before a vendor or bill can be created.`;
    }
  }

  if (errorMessage) return errorMessage;
  return "";
}

function uploadBillId(it: any) {
  return (it?.completedMeta as any)?.bill_id ?? (it?.completedMeta as any)?.meta?.bill_id ?? null;
}

function uploadLifecycleStatus(type: UploadType, it: any, parsedStatus: string, duplicateCode: string) {
  if (it.status === "FAILED") return duplicateCode === "DUPLICATE_UPLOAD" ? "Duplicate upload" : "Failed";
  if (it.status === "UPLOADING") return "Uploading";
  if (it.status === "UPLOADED") return "Uploaded - processing";
  if (parsedStatus === "PARSING") return "Uploaded - processing";

  const billId = uploadBillId(it);
  if (type === "INVOICE" && billId) return "Draft bill created for review";
  if (parsedStatus === "PARSED") {
    if (type === "INVOICE") return "Parsed - ready for AP review";
    if (type === "RECEIPT") return "Parsed - ready for review";
    return "Parsed";
  }
  if (parsedStatus === "NEEDS_REVIEW") return "Needs review";
  if (parsedStatus === "FAILED") return duplicateCode === "DUPLICATE_UPLOAD" ? "Duplicate upload" : "Failed";
  return "Uploaded";
}

function uploadLifecycleDetail(type: UploadType, it: any, parsedStatus: string, duplicateCode: string) {
  const billId = uploadBillId(it);

  if (type === "INVOICE") {
    if (billId) return "Draft bill created for review. No ledger/payment entry is created until you approve/post it.";
    if (duplicateCode === "DUPLICATE_UPLOAD") return "A matching upload already exists; no new bill or ledger entry was posted.";
    if (parsedStatus === "PARSED") return "Parsed upload saved. Open Vendor/AP review to create or approve the draft bill.";
    if (parsedStatus === "NEEDS_REVIEW") return "Review the parsed fields before creating a draft bill.";
    if (parsedStatus === "FAILED") return "Uploaded file saved; extraction needs review before any draft bill can be created.";
    return "Uploaded file saved. Processing may continue before AP review.";
  }

  if (type === "RECEIPT") {
    const entryState = it.uploadId ? it.entryCreateStatus?.[it.uploadId]?.state : null;
    if (entryState === "created") return "Ledger entry created by your action.";
    if (entryState === "already") return "A ledger entry already exists for this receipt.";
    if (parsedStatus === "PARSED") return "Parsed receipt saved for review. Select it and choose Create ledger entries when ready.";
    if (parsedStatus === "NEEDS_REVIEW") return "Review the parsed receipt before creating a ledger entry.";
    if (parsedStatus === "FAILED") return "Uploaded file saved; extraction needs review before any ledger entry can be created.";
    return "Uploaded file saved. No ledger entry has been created.";
  }

  return "";
}

function uploadFileLifecycleText(type: UploadType, it: any) {
  const duplicateCode =
    (it?.completedMeta as any)?.error_code ??
    (it?.completedMeta as any)?.meta?.error_code ??
    "";
  const parsedStatus =
    it.status === "COMPLETED" && !it.parsedStatus
      ? "PARSING"
      : it.parsedStatus || "SKIPPED";

  return uploadLifecycleStatus(type, it, parsedStatus, String(duplicateCode));
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
  const [selectedVendor, setSelectedVendor] = useState<VendorLite | null>(null);
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");

  const forcedVendorId = useMemo(
    () => ((ctx as any)?.vendorId ? String((ctx as any).vendorId).trim() : ""),
    [ctx]
  );

  const uploadMeta = useMemo(() => {
    if (type !== "INVOICE") return {};

    // If this upload panel is opened from a vendor detail page, we force vendor_id.
    if (forcedVendorId) return { vendor_id: forcedVendorId };

    // Otherwise, keep existing behavior (vendor can be created by parsing)
    return selectedVendor ? { vendor_id: selectedVendor.id, vendor_name: selectedVendor.name } : {};
  }, [type, selectedVendor, forcedVendorId]);

  const controller = useUploadController({ type, ctx, meta: uploadMeta });
  const clearUploads = controller.clearAll;

  // Reset UI state whenever the panel opens (prevents stale summary/files persisting across sessions)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setShowSummary(false);
      setNotes("");
      setSelectedVendor(null);
      setStatementFrom("");
      setStatementTo("");

      // IMPORTANT: reset selection state too
      setSelectedForEntry({});
      setEntryDateByUploadId({});

      clearUploads();
    });

    return () => {
      cancelled = true;
    };
  }, [open, clearUploads]);

  // Auto-switch to summary once all uploads are completed (no need to press Done)
  useEffect(() => {
    if (!open) return;
    if (controller.items.length === 0) return;
    if (controller.hasActiveUploads) return;

    const allDone = controller.items.every((it) => it.status === "COMPLETED" || it.status === "UPLOADED");
    if (allDone) {
      const completedItems = controller.items;
      queueMicrotask(() => {
        setShowSummary(true);

        // Default selection: all items that have a parsed amount (deterministic, no stubs)
        setSelectedForEntry((prev) => {
          const next = { ...prev };
          for (const it of completedItems) {
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
          for (const it of completedItems) {
            if (!it.uploadId) continue;
            const d = toIsoDate(String(it.parsed?.doc_date || "").trim());
            if (d && !next[it.uploadId]) next[it.uploadId] = d;
          }
          return next;
        });
      });

      // Notify vendors pages to refresh (AP + vendor list) after invoice uploads complete
      if (type === "INVOICE") {
        window.dispatchEvent(new CustomEvent("bynk:vendors-refresh"));

        if (forcedVendorId) {
          window.dispatchEvent(new CustomEvent("bynk:vendor-detail-refresh", { detail: { vendorId: forcedVendorId } }));
        }
      }
    }
  }, [open, controller.items, controller.hasActiveUploads, type, forcedVendorId]);

  const title = `Upload ${uploadTypeLabel[type]}`;

  const fileHint = useMemo(() => {
    if (type === "BANK_STATEMENT") return "CSV preferred. PDF supported.";
    return "PDF or image files.";
  }, [type]);

  const showBankFields = type === "BANK_STATEMENT";
  const summaryTableMinWidth =
    type === "INVOICE" ? "min-w-[1260px]" : type === "RECEIPT" ? "min-w-[980px]" : "min-w-[560px]";

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
    <AppDialog
      open={open}
      onClose={onClose}
      title={title}
      size="xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-bb-text-muted">
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
              {controller.items.length ? "Done" : "Close"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="text-sm text-bb-text">{uploadHelperText[type]}</div>

        {/* Dev-only toggle for overlay close behavior */}

        {/* Drop zone */}
        <div
          className="rounded-lg border border-bb-border bg-bb-surface-soft p-4"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={onDrop}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <UploadCloud className="h-5 w-5 text-bb-text-muted" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-bb-text">Drag and drop files here</div>
              <div className="text-xs text-bb-text-muted mt-0.5">
                {fileHint} {effectiveAllowMultiple ? "Bulk upload supported." : "Single file only."}
              </div>

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <Button type="button" className="h-7 px-3 text-xs" onClick={pickFiles}>
                  Choose file{effectiveAllowMultiple ? "s" : ""}
                </Button>

                <div className="text-xs text-bb-text-muted">
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
          <div className="rounded-lg border border-bb-border bg-bb-surface-card p-3 space-y-3">
            <div className="text-xs font-semibold text-bb-text">Details</div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="text-xs text-bb-text-muted">Statement from</div>
                <AppDatePicker value={statementFrom} onChange={(next) => setStatementFrom(next)} allowClear />
              </div>

              <div className="space-y-1">
                <div className="text-xs text-bb-text-muted">Statement to</div>
                <AppDatePicker value={statementTo} onChange={(next) => setStatementTo(next)} allowClear />
              </div>

              <div className="col-span-2 text-xs text-bb-text-muted">This stores the file + metadata.</div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-bb-text-muted">Notes (optional)</div>
              <textarea
                className="w-full min-h-[64px] px-2 py-1 text-xs border border-bb-input-border bg-bb-input-bg text-bb-text placeholder:text-bb-input-placeholder rounded-md"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add internal notes…"
              />
            </div>
          </div>
        ) : null}

        {/* Summary */}
        {showSummary && !controller.hasActiveUploads ? (
          <div className="rounded-lg border border-bb-border bg-bb-surface-card overflow-hidden">
            <div className="px-3 py-2 border-b border-bb-border flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-bb-text">Upload summary</div>
                <div className="text-xs text-bb-text-muted">
                  {type === "INVOICE"
                    ? "Invoices are saved for review first. No ledger/payment entry is created until you approve/post it."
                    : type === "RECEIPT"
                      ? "Receipts are saved as uploaded files first. Create ledger entries only after review."
                      : "Uploaded files."}
                </div>
              </div>

              {/* Entry creation is controlled per-row via checkboxes below */}

            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className={`w-full ${summaryTableMinWidth} table-fixed text-xs`}>
                {type === "INVOICE" ? (
                  <colgroup>
                    <col style={{ width: 44 }} />
                    <col style={{ width: 220 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 190 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 266 }} />
                    <col style={{ width: 80 }} />
                  </colgroup>
                ) : type === "RECEIPT" ? (
                  <colgroup>
                    <col style={{ width: 44 }} />
                    <col style={{ width: 260 }} />
                    <col style={{ width: 170 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 196 }} />
                    <col style={{ width: 80 }} />
                  </colgroup>
                ) : (
                  <colgroup>
                    <col style={{ width: 280 }} />
                    <col style={{ width: 200 }} />
                    <col style={{ width: 80 }} />
                  </colgroup>
                )}
                <thead className="bg-bb-surface-soft text-bb-text">
                  {type === "INVOICE" ? (
                    <tr className="border-b border-bb-border">
                      <th className="px-3 py-2 text-center font-semibold"></th>

                      <th className="px-3 py-2 text-left font-semibold">Vendor</th>
                      <th className="px-3 py-2 text-left font-semibold">Invoice #</th>
                      <th className="px-3 py-2 text-left font-semibold">Invoice date</th>
                      <th className="px-3 py-2 text-left font-semibold">Next action</th>
                      <th className="px-3 py-2 text-left font-semibold">Due</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">File</th>
                    </tr>
                  ) : type === "RECEIPT" ? (
                    <tr className="border-b border-bb-border">
                      <th className="px-3 py-2 text-center font-semibold"></th>
                      <th className="px-3 py-2 text-left font-semibold">File</th>
                      <th className="px-3 py-2 text-left font-semibold">Vendor</th>
                      <th className="px-3 py-2 text-left font-semibold">Date</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">File</th>
                    </tr>
                  ) : (
                    <tr className="border-b border-bb-border">
                      <th className="px-3 py-2 text-left font-semibold">File</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">File</th>
                    </tr>
                  )}
                </thead>

                <tbody className="divide-y divide-bb-border-muted">
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

                    const duplicateCode =
                      (it.completedMeta as any)?.error_code ??
                      (it.completedMeta as any)?.meta?.error_code ??
                      "";

                    const duplicateMeta =
                      (it.completedMeta as any)?.duplicate ??
                      (it.completedMeta as any)?.meta?.duplicate ??
                      null;

                    const billId = uploadBillId(it);
                    const statusLabel = uploadLifecycleStatus(type, it, status, duplicateCode);
                    const lifecycleDetail = uploadLifecycleDetail(
                      type,
                      {
                        ...it,
                        entryCreateStatus,
                      },
                      status,
                      duplicateCode,
                    );

                    return (
                      <tr key={it.id}>
                        <td className="px-3 py-2 text-center">
                          {type === "RECEIPT" && it.uploadId ? (() => {
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
                                  : "Create ledger entry for this receipt";
                            return (
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border border-bb-input-border"
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
                            <td className="px-3 py-2 text-bb-text">
                              <div className="truncate font-medium text-bb-text" title={String(vendor || "")}>{vendor || "—"}</div>
                              <div className="truncate text-[11px] text-bb-text-muted" title={it.file.name}>
                                ({it.file.name})
                              </div>
                            </td>

                            <td className="px-3 py-2 text-bb-text">
                              <div className="truncate" title={String(invoiceNo || "")}>{invoiceNo || "—"}</div>
                            </td>
                            <td className="px-3 py-2 text-bb-text">{docDate || "—"}</td>

                            <td className="px-3 py-2 text-bb-text">
                              {billId
                                ? "Review draft bill"
                                : status === "PARSED"
                                  ? "Open Vendor/AP review"
                                  : status === "NEEDS_REVIEW"
                                    ? "Review parsed fields"
                                    : status === "FAILED"
                                      ? "Fix upload or retry"
                                      : "Wait for processing"}
                            </td>

                            <td className="px-3 py-2 text-bb-text">{dueDate || "—"}</td>
                            <td className="px-3 py-2 text-right text-bb-text">
                              <div>{total || "—"}</div>
                              {duplicateCode === "DUPLICATE_UPLOAD" && duplicateMeta ? (
                                <div className="mt-1 text-[11px] text-bb-text-muted">
                                  Duplicate of {String(duplicateMeta.original_filename || "existing upload")}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <div>
                                <span
                                  className={
                                    status === "PARSING"
                                      ? "inline-flex items-center rounded-full bg-bb-surface-soft text-bb-text px-2 py-0.5"
                                      : status === "PARSED"
                                        ? "inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5"
                                        : status === "NEEDS_REVIEW"
                                          ? "inline-flex items-center rounded-full bg-bb-status-warning-bg text-bb-status-warning-fg px-2 py-0.5"
                                          : status === "FAILED"
                                            ? (
                                                ((it.completedMeta as any)?.error_code ??
                                                  (it.completedMeta as any)?.meta?.error_code ??
                                                  "") === "DUPLICATE_UPLOAD"
                                                  ? "inline-flex items-center rounded-full bg-bb-surface-soft text-bb-text px-2 py-0.5"
                                                  : "inline-flex items-center rounded-full bg-bb-status-danger-bg text-bb-status-danger-fg px-2 py-0.5"
                                              )
                                            : "inline-flex items-center rounded-full bg-bb-surface-soft text-bb-text px-2 py-0.5"
                                  }
                                >
                                  {statusLabel}
                                  {(() => {
                                    if (billId) {
                                      return <span className="ml-2 text-[11px] text-primary">Ready for approval</span>;
                                    }

                                    if (duplicateCode === "DUPLICATE_UPLOAD") {
                                      return (
                                        <span className="ml-2 text-[11px] text-bb-text-muted">
                                          Existing upload reused
                                        </span>
                                      );
                                    }

                                    if (!it.uploadId) return null;

                                    return entryCreateStatus[it.uploadId]?.state === "creating" ? (
                                      <span className="ml-2 text-[11px] text-bb-text-muted">Creating…</span>
                                    ) : entryCreateStatus[it.uploadId]?.state === "created" ? (
                                      <span className="ml-2 text-[11px] text-primary">Created</span>
                                    ) : entryCreateStatus[it.uploadId]?.state === "already" ? (
                                      <span className="ml-2 text-[11px] text-bb-text-muted">Already exists</span>
                                    ) : entryCreateStatus[it.uploadId]?.state === "failed" ? (
                                      <span className="ml-2 text-[11px] text-bb-status-danger-fg">Failed</span>
                                    ) : null;
                                  })()}
                                </span>

                                {uploadReason(it) ? (
                                  <div className="mt-1 truncate text-[11px] leading-4 text-bb-text-muted" title={uploadReason(it)}>
                                    {uploadReason(it)}
                                  </div>
                                ) : lifecycleDetail ? (
                                  <div className="mt-1 truncate text-[11px] leading-4 text-bb-text-muted" title={lifecycleDetail}>
                                    {lifecycleDetail}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </>
                        ) : type === "RECEIPT" ? (
                          <>
                            <td className="px-3 py-2 text-bb-text">
                              <div className="truncate font-medium text-bb-text" title={String(it.file?.name || "")}>{it.file?.name || "—"}</div>
                            </td>

                            <td className="px-3 py-2 text-bb-text">
                              <div className="truncate" title={String(vendor || "")}>{vendor || "—"}</div>
                            </td>
                            <td className="px-3 py-2 text-bb-text">{docDate || "—"}</td>
                            <td className="px-3 py-2 text-right text-bb-text">{total || "—"}</td>

                            <td className="px-3 py-2">
                              <span
                                className={
                                  it.status !== "COMPLETED"
                                    ? "inline-flex items-center rounded-full bg-bb-surface-soft text-bb-text px-2 py-0.5"
                                    : status === "PARSED"
                                      ? "inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5"
                                      : status === "NEEDS_REVIEW"
                                        ? "inline-flex items-center rounded-full bg-bb-status-warning-bg text-bb-status-warning-fg px-2 py-0.5"
                                        : status === "FAILED"
                                          ? "inline-flex items-center rounded-full bg-bb-status-danger-bg text-bb-status-danger-fg px-2 py-0.5"
                                          : "inline-flex items-center rounded-full bg-bb-surface-soft text-bb-text px-2 py-0.5"
                                }
                              >
                                {it.status !== "COMPLETED" ? (
                                  <>
                                    <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border border-bb-text-muted border-t-transparent" />
                                    Still retrieving…
                                  </>
                                ) : (
                                  statusLabel
                                )}

                                {it.uploadId ? (
                                  entryCreateStatus[it.uploadId]?.state === "creating" ? (
                                    <span className="ml-2 text-[11px] text-bb-text-muted">Creating ledger entry…</span>
                                  ) : entryCreateStatus[it.uploadId]?.state === "created" ? (
                                    <span className="ml-2 text-[11px] text-primary">Ledger entry created</span>
                                  ) : entryCreateStatus[it.uploadId]?.state === "already" ? (
                                    <span className="ml-2 text-[11px] text-bb-text-muted">Ledger entry already exists</span>
                                  ) : entryCreateStatus[it.uploadId]?.state === "failed" ? (
                                    <span className="ml-2 text-[11px] text-bb-status-danger-fg">Failed</span>
                                  ) : null
                                ) : null}
                              </span>
                              {uploadReason(it) ? (
                                <div className="mt-1 truncate text-[11px] leading-4 text-bb-text-muted" title={uploadReason(it)}>
                                  {uploadReason(it)}
                                </div>
                              ) : lifecycleDetail ? (
                                <div className="mt-1 truncate text-[11px] leading-4 text-bb-text-muted" title={lifecycleDetail}>
                                  {lifecycleDetail}
                                </div>
                              ) : null}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center rounded-full bg-bb-surface-soft text-bb-text px-2 py-0.5">
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
                                title="Open or download this uploaded file"
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
                                title="Remove this upload from the current list"
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
                                <Trash2 className="h-4 w-4 mx-auto text-bb-text-muted" />
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
            {type === "RECEIPT" && ctx?.businessId ? (
              <div className="px-3 py-2 border-t border-bb-border flex items-center justify-between">
                <div className="text-xs text-bb-text-muted">
                  {controller.items.filter((it) => it.uploadId && selectedForEntry[it.uploadId]).length} selected.
                  {" "}Next: review parsed receipts, then create ledger entries when ready.
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
                      Create ledger entries
                    </Button>
                  );
                })()}
              </div>
            ) : null}

            {type === "INVOICE" && ctx?.businessId ? (
              <div className="px-3 py-2 border-t border-bb-border flex items-center justify-between gap-3">
                <div className="text-xs text-bb-text-muted">
                  Next: open Vendor/AP review to review draft bills or create a bill from a parsed upload.
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => {
                    const businessId = ctx.businessId?.trim();
                    if (!businessId) return;
                    const vendorId = (ctx as any)?.vendorId ? String((ctx as any).vendorId).trim() : "";
                    window.location.href = vendorId
                      ? `/vendors/${encodeURIComponent(vendorId)}?businessId=${encodeURIComponent(businessId)}`
                      : `/vendors?businessId=${encodeURIComponent(businessId)}`;
                  }}
                >
                  Open Vendor/AP review
                </Button>
              </div>
            ) : null}

            {/* Footer close is used; no extra close button here */}

          </div>
        ) : null}

        {/* File list */}
        {!showSummary ? (
          <div className="rounded-lg border border-bb-border bg-bb-surface-card overflow-hidden">
            <div className="px-3 py-2 border-b border-bb-border flex items-center justify-between">
              <div className="text-xs font-semibold text-bb-text">Files ({controller.items.length})</div>

              {effectiveAllowMultiple ? (
                <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={pickFiles}>
                  Add more
                </Button>
              ) : null}
            </div>

            {controller.items.length === 0 ? (
              <div className="p-4 text-xs text-bb-text-muted">No files selected yet.</div>
            ) : (
              <div className="divide-y divide-bb-border-muted">
                {controller.items.map((it) => (
                  <div key={it.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-bb-text truncate">{it.file.name}</div>
                        <div className="text-[11px] text-bb-text-muted">
                          {Math.round(it.file.size / 1024)} KB • {it.file.type || "unknown type"}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {it.status === "UPLOADED" || it.status === "COMPLETED" ? (
                          <div className="inline-flex items-center gap-1 text-xs text-primary">
                            <CheckCircle2 className="h-4 w-4" />
                            {uploadFileLifecycleText(type, it)}
                          </div>
                        ) : it.status === "FAILED" ? (
                          <div className="inline-flex items-center gap-1 text-xs text-bb-status-danger-fg">
                            <AlertTriangle className="h-4 w-4" /> Failed
                          </div>
                        ) : it.status === "CANCELED" ? (
                          <div className="inline-flex items-center gap-1 text-xs text-bb-text-muted">
                            <X className="h-4 w-4" /> Canceled
                          </div>
                        ) : it.status === "UPLOADING" ? (
                          <div className="text-xs text-bb-text">Uploading…</div>
                        ) : (
                          <div className="text-xs text-bb-text">Queued</div>
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
                          <Button type="button" variant="outline" className="h-7 w-8 p-0" onClick={() => controller.remove(it.id)} title="Remove this file from the upload list">
                            <Trash2 className="h-4 w-4 mx-auto text-bb-text-muted" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2">
                      <div className="h-2 rounded-full bg-bb-surface-elevated overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${it.progress}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] text-bb-text-muted">{it.progress}%</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
