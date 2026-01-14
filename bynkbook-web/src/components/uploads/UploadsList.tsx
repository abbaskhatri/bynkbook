"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/primitives/StatusChip";
import { useUploadsList } from "./useUploadsList";
import { apiFetch } from "@/lib/api/client";
import { importBankStatementUpload } from "@/lib/api/uploads";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function UploadsList(props: {
  title: string;
  businessId: string;
  accountId?: string;
  type?: string; // supports comma-separated, e.g. "RECEIPT,INVOICE"
  limit?: number;
  showStatementPeriod?: boolean;
}) {
  const { title, businessId, accountId, type, limit = 10, showStatementPeriod } = props;
  const { items, loading, error } = useUploadsList({ businessId, accountId, type, limit });

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  async function runImport(uploadId: string) {
    try {
      setImportingId(uploadId);
      await importBankStatementUpload(businessId, uploadId);
      // simplest refresh to show updated meta.importStatus + counts
      window.location.reload();
    } finally {
      setImportingId(null);
    }
  }

  async function download(uploadId: string) {
    try {
      setDownloadingId(uploadId);
      const res = await apiFetch(`/v1/businesses/${businessId}/uploads/${uploadId}/download`, { method: "GET" });
      if (!res?.ok) throw new Error(res?.error || "Failed to get download URL");
      const url = res.download?.url;
      if (!url) throw new Error("Missing download url");
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
      </div>

      {loading ? (
        <div className="p-3 text-xs text-slate-600">Loading…</div>
      ) : error ? (
        <div className="p-3 text-xs text-red-700">{error}</div>
      ) : items.length === 0 ? (
        <div className="p-3 text-xs text-slate-600">No uploads yet.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {items.map((u) => {
            const meta = (u.meta || {}) as Record<string, any>;

            const period =
              showStatementPeriod && (meta.statementFrom || meta.statementTo)
                ? `${meta.statementFrom || "—"} → ${meta.statementTo || "—"}`
                : null;

            const downloadable = u.status === "COMPLETED" || u.status === "UPLOADED";

            // Phase 4C import lifecycle lives in meta, not status
            const importStatus = meta.importStatus as string | undefined;
            const importSummary =
              importStatus === "IMPORTED"
                ? `Imported ${meta.importImportedCount ?? 0} • Duplicates ${meta.importDuplicateCount ?? 0} • Skipped ${meta.importSkippedByRetentionCount ?? 0}`
                : importStatus === "IMPORTING"
                ? "Importing…"
                : importStatus === "NEEDS_REVIEW"
                ? "Needs review (unsupported format)"
                : importStatus === "FAILED"
                ? `Failed: ${meta.importError ?? "Import failed"}`
                : null;

            // Only allow import for completed bank statements (manual import only)
            const canImport =
              u.upload_type === "BANK_STATEMENT" &&
              u.status === "COMPLETED" &&
              importStatus !== "IMPORTING";

            const statusLabel = importStatus ? `${u.status} • ${importStatus}` : u.status;
            const statusTone =
              u.status === "FAILED" || importStatus === "FAILED"
                ? "danger"
                : importStatus === "NEEDS_REVIEW"
                ? "warning"
                : "default";

            return (
              <div key={u.id} className="px-3 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">{u.original_filename}</div>
                  <div className="text-[11px] text-slate-500">
                    {u.upload_type} • {fmtDate(u.created_at)}
                    {period ? ` • ${period}` : ""}
                    {meta.importFinishedAt ? ` • Imported: ${fmtDateTime(meta.importFinishedAt)}` : ""}
                  </div>
                  {importSummary ? <div className="mt-0.5 text-[11px] text-slate-600 truncate">{importSummary}</div> : null}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <StatusChip label={statusLabel} tone={statusTone} />

                  {u.upload_type === "BANK_STATEMENT" ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={!canImport || importingId === u.id}
                      title={!canImport ? "Not ready to import" : undefined}
                      onClick={() => runImport(u.id)}
                    >
                      {importingId === u.id ? "Importing…" : importStatus === "IMPORTED" ? "Re-import" : "Import"}
                    </Button>
                  ) : null}

                  <Button
                    type="button"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={!downloadable || downloadingId === u.id}
                    title={!downloadable ? "Not available yet" : undefined}
                    onClick={() => download(u.id)}
                  >
                    {downloadingId === u.id ? "Loading…" : "View / Download"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
