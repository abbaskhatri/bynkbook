"use client";

import { useMemo, useRef, useState } from "react";
import { AppSidePanel } from "@/components/primitives/AppSidePanel";
import { Button } from "@/components/ui/button";
import { UploadCloud, X, CheckCircle2, AlertTriangle, Trash2, Camera } from "lucide-react";
import { useUploadController } from "./useUploadController";
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

export function UploadPanel({ open, onClose, type, ctx, allowMultiple }: UploadPanelProps) {
  const effectiveAllowMultiple = allowMultiple ?? uploadAllowMultiple[type];
  const accept = uploadAccept[type];

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [disableOverlayClose, setDisableOverlayClose] = useState(false);

  // UI-only metadata (we keep these, but do not persist in Batch 4A-1)
  const [notes, setNotes] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [createLedgerEntry, setCreateLedgerEntry] = useState(false);

  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");

  const controller = useUploadController({ type, ctx });

  const canClose = !controller.hasActiveUploads;
  const overlayCloseDisabled = disableOverlayClose || controller.hasActiveUploads;

  const title = `Upload ${uploadTypeLabel[type]}`;

  const fileHint = useMemo(() => {
    if (type === "BANK_STATEMENT") return "CSV preferred. PDF supported (parsing coming soon).";
    return "PDF or image files.";
  }, [type]);

  const showBankFields = type === "BANK_STATEMENT";
  const showVendorField = type === "INVOICE";
  const showLedgerToggle = type === "RECEIPT" || type === "INVOICE";

  function pickFiles() {
    inputRef.current?.click();
  }

  function onFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    controller.enqueueAndStart(files);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer?.files?.length) return;
    controller.enqueueAndStart(e.dataTransfer.files);
  }

  return (
    <AppSidePanel
      open={open}
      onClose={canClose ? onClose : onClose /* allow close, uploads keep running in stub */}
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
                setVendorName("");
                setCreateLedgerEntry(false);
                setStatementFrom("");
                setStatementTo("");
              }}
              disabled={controller.items.length === 0}
            >
              Clear
            </Button>

            <Button type="button" className="h-7 px-3 text-xs" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      }
    >
      {/* Top helper + controls */}
      <div className="space-y-3">
        <div className="text-sm text-slate-700">{uploadHelperText[type]}</div>

        {/* Dev-only toggle for overlay close behavior */}
        <label className="flex items-center gap-2 text-xs text-slate-700 select-none">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={disableOverlayClose}
            onChange={(e) => setDisableOverlayClose(e.target.checked)}
          />
          disableOverlayClose (for testing)
        </label>

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

                {/* Mobile camera stub */}
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 px-3 text-xs sm:hidden"
                  disabled
                  title="Coming soon"
                >
                  <Camera className="h-3.5 w-3.5 mr-1" />
                  Use camera (Coming soon)
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

        {/* Metadata (UI only) */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
          <div className="text-xs font-semibold text-slate-900">Details</div>

          {showVendorField ? (
            <div className="space-y-1">
              <div className="text-xs text-slate-600">Vendor (optional)</div>
              <input
                className="h-7 w-full px-2 text-xs border border-slate-200 rounded-md"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="Type vendor name…"
              />
            </div>
          ) : null}

          {showBankFields ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="text-xs text-slate-600">Statement from (required later)</div>
                <input
                  type="date"
                  className="h-7 w-full px-2 text-xs border border-slate-200 rounded-md"
                  value={statementFrom}
                  onChange={(e) => setStatementFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-slate-600">Statement to (required later)</div>
                <input
                  type="date"
                  className="h-7 w-full px-2 text-xs border border-slate-200 rounded-md"
                  value={statementTo}
                  onChange={(e) => setStatementTo(e.target.value)}
                />
              </div>
              <div className="col-span-2 text-xs text-slate-500">
                Import/parse is coming soon. This step stores the file + metadata only.
              </div>
            </div>
          ) : null}

          {showLedgerToggle ? (
            <label className="flex items-center gap-2 text-xs text-slate-700 select-none">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={createLedgerEntry}
                onChange={(e) => setCreateLedgerEntry(e.target.checked)}
              />
              Create ledger entry for upload (Coming soon)
            </label>
          ) : null}

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

        {/* File list */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-900">
              Files ({controller.items.length})
            </div>
{effectiveAllowMultiple ? (
  <Button
    type="button"
    variant="outline"
    className="h-7 px-2 text-xs"
    onClick={pickFiles}
  >
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
                      {it.status === "UPLOADED" ? (
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
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => controller.cancel(it.id)}
                        >
                          Cancel
                        </Button>
                      ) : it.status === "FAILED" ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => controller.retry(it.id)}
                        >
                          Retry
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 w-8 p-0"
                          onClick={() => controller.remove(it.id)}
                          title="Remove"
                        >
                          <Trash2 className="h-4 w-4 mx-auto text-slate-500" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="mt-2">
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${it.progress}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">{it.progress}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppSidePanel>
  );
}
