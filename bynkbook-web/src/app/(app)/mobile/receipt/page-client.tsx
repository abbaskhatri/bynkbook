"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Camera,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Landmark,
  Loader2,
  Paperclip,
  RefreshCcw,
  Trash2,
  Upload,
} from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { useUploadController } from "@/components/uploads/useUploadController";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useBusinesses } from "@/lib/queries/useBusinesses";

const MAX_RECEIPT_BYTES = 25 * 1024 * 1024;
const RECEIPT_ACCEPT = "image/*,application/pdf";

type SelectedReceiptFile = {
  id: string;
  file: File;
  previewUrl: string | null;
};

function localId() {
  return Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function hrefWith(params: {
  path: string;
  businessId?: string | null;
  accountId?: string | null;
}) {
  const q = new URLSearchParams();
  if (params.businessId) q.set("businessId", params.businessId);
  if (params.accountId) q.set("accountId", params.accountId);
  const qs = q.toString();
  return qs ? `${params.path}?${qs}` : params.path;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function isAllowedReceiptFile(file: File) {
  const type = file.type || "";
  const name = file.name.toLowerCase();
  return type.startsWith("image/") || type === "application/pdf" || name.endsWith(".pdf");
}

function fileKind(file: File) {
  if ((file.type || "").startsWith("image/")) return "Image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "PDF";
  return "File";
}

function parsedSummary(parsed: Record<string, unknown> | null | undefined) {
  if (!parsed) return null;

  const parts = [
    typeof parsed.vendor_name === "string" && parsed.vendor_name.trim()
      ? parsed.vendor_name.trim()
      : null,
    typeof parsed.date === "string" && parsed.date.trim() ? parsed.date.trim() : null,
    typeof parsed.total_cents === "string" || typeof parsed.total_cents === "number"
      ? "Parsed amount saved"
      : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : null;
}

export default function MobileReceiptPageClient() {
  const sp = useSearchParams();
  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;
  const accountIdFromUrl = sp.get("accountId") ?? null;
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<SelectedReceiptFile[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const business = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return list.find((item) => item.id === bizIdFromUrl) ?? list[0] ?? null;
    return list[0] ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const businessId = business?.id ?? bizIdFromUrl ?? null;
  const accountsQ = useAccounts(businessId);

  const activeAccounts = useMemo(
    () => (accountsQ.data ?? []).filter((account) => !account.archived_at),
    [accountsQ.data]
  );

  const accountId = useMemo(() => {
    if (accountIdFromUrl && accountIdFromUrl !== "all") return accountIdFromUrl;
    return activeAccounts[0]?.id ?? null;
  }, [accountIdFromUrl, activeAccounts]);

  const account = useMemo(() => {
    if (!accountId) return activeAccounts[0] ?? null;
    return activeAccounts.find((item) => item.id === accountId) ?? activeAccounts[0] ?? null;
  }, [accountId, activeAccounts]);

  const uploader = useUploadController({
    type: "RECEIPT",
    ctx: {
      businessId: businessId ?? undefined,
      accountId: accountId ?? undefined,
    },
  });

  useEffect(() => {
    return () => {
      for (const previewUrl of previewUrlsRef.current) {
        URL.revokeObjectURL(previewUrl);
      }
      previewUrlsRef.current.clear();
    };
  }, []);

  const reviewHref = hrefWith({ path: "/mobile/review", businessId, accountId });
  const ledgerHref = hrefWith({ path: "/ledger", businessId, accountId });

  const imageCount = selectedFiles.filter((item) => item.file.type.startsWith("image/")).length;
  const hasMultipleImages = imageCount > 1;

  function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;

    const accepted: SelectedReceiptFile[] = [];
    const errors: string[] = [];

    for (const file of incoming) {
      if (!isAllowedReceiptFile(file)) {
        errors.push(`${file.name} is not supported. Use an image or PDF receipt file.`);
        continue;
      }

      if (file.size > MAX_RECEIPT_BYTES) {
        errors.push(`${file.name} is ${formatBytes(file.size)}. Receipt files must be 25 MB or smaller.`);
        continue;
      }

      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (previewUrl) previewUrlsRef.current.add(previewUrl);

      accepted.push({
        id: localId(),
        file,
        previewUrl,
      });
    }

    setValidationErrors(errors);
    if (accepted.length) setSelectedFiles((prev) => [...prev, ...accepted]);
  }

  function removeSelected(id: string) {
    setSelectedFiles((prev) => {
      const item = prev.find((row) => row.id === id);
      if (item?.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current.delete(item.previewUrl);
      }
      return prev.filter((row) => row.id !== id);
    });
  }

  function clearSelection() {
    setSelectedFiles((prev) => {
      for (const item of prev) {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
          previewUrlsRef.current.delete(item.previewUrl);
        }
      }
      return [];
    });
    setValidationErrors([]);
  }

  function uploadSelected() {
    if (!businessId || selectedFiles.length === 0) return;
    uploader.enqueueAndStart(selectedFiles.map((item) => item.file));
    clearSelection();
  }

  const bannerMessage =
    businessesQ.error || accountsQ.error
      ? "Receipt capture could not load workspace context."
      : null;

  return (
    <MobileShell businessId={businessId} accountId={accountId}>
      <div className="space-y-4">
        <section className="rounded-md border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Mobile capture
              </div>
              <h1 className="mt-2 truncate text-2xl font-semibold leading-tight text-foreground">
                Receipt Upload
              </h1>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{business?.name ?? "Business"}</span>
                </span>
                <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1">
                  <Landmark className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{account?.name ?? "No active account"}</span>
                </span>
              </div>
            </div>
            <Link
              href={reviewHref}
              prefetch
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted/50"
            >
              Queue
            </Link>
          </div>
        </section>

        {bannerMessage ? (
          <InlineBanner title="Receipt capture is unavailable" message={bannerMessage} />
        ) : null}

        <section className="space-y-3 rounded-md border border-bb-status-success-border bg-bb-status-success-bg p-4 shadow-sm">
          <div className="flex gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-bb-status-success-fg" />
            <div className="space-y-2 text-sm leading-5 text-bb-status-success-fg">
              <p>Receipts are uploaded for review. This will not create a ledger entry automatically.</p>
              <p>For multiple-page receipts, upload a PDF or add images as separate receipt files for now.</p>
            </div>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card p-4 shadow-sm">
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={!businessId}
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Camera className="h-5 w-5" />
              Take receipt photo
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!businessId}
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Paperclip className="h-5 w-5" />
              Choose image or PDF
            </button>
          </div>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              if (event.currentTarget.files) addFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={RECEIPT_ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.currentTarget.files) addFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />

          <div className="mt-4 text-xs leading-5 text-muted-foreground">
            Images and PDFs only. Maximum 25 MB per file.
          </div>
        </section>

        {validationErrors.length ? (
          <section className="space-y-2 rounded-md border border-bb-status-danger-border bg-bb-status-danger-bg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-bb-status-danger-fg">
              <AlertTriangle className="h-4 w-4" />
              Some files were not added
            </div>
            {validationErrors.map((error, index) => (
              <div key={`${error}-${index}`} className="text-sm leading-5 text-bb-status-danger-fg">
                {error}
              </div>
            ))}
          </section>
        ) : null}

        <section className="space-y-3">
          <div className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Review before upload
          </div>

          {selectedFiles.length === 0 ? (
            <div className="rounded-md border border-border bg-card p-4 text-sm leading-5 text-muted-foreground shadow-sm">
              No receipt files selected yet.
            </div>
          ) : (
            <>
              {hasMultipleImages ? (
                <div className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg p-4 text-sm leading-5 text-bb-status-warning-fg shadow-sm">
                  Multiple images will upload as separate receipt files for now. Use a PDF for a single multi-page receipt.
                </div>
              ) : null}

              {selectedFiles.map((item) => (
                <article
                  key={item.id}
                  className="rounded-md border border-border bg-card p-3 shadow-sm"
                >
                  <div className="flex gap-3">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/50">
                      {item.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.previewUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <FileText className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {item.file.name}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              {fileKind(item.file) === "Image" ? (
                                <ImageIcon className="h-3.5 w-3.5" />
                              ) : (
                                <FileText className="h-3.5 w-3.5" />
                              )}
                              {fileKind(item.file)}
                            </span>
                            <span>{formatBytes(item.file.size)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSelected(item.id)}
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted/50"
                          aria-label={`Remove ${item.file.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}

              <button
                type="button"
                onClick={uploadSelected}
                disabled={!businessId || selectedFiles.length === 0 || uploader.hasActiveUploads}
                className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 text-sm font-semibold text-background shadow-sm hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-5 w-5" />
                Upload for review
              </button>
            </>
          )}
        </section>

        <section className="space-y-3">
          <div className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Upload status
          </div>

          {uploader.items.length === 0 ? (
            <div className="rounded-md border border-border bg-card p-4 text-sm leading-5 text-muted-foreground shadow-sm">
              Uploaded receipts will appear here during this session. The desktop ledger upload history is unchanged.
            </div>
          ) : (
            uploader.items.map((item) => {
              const summary = parsedSummary(item.parsed);
              const isActive = item.status === "QUEUED" || item.status === "UPLOADING" || item.status === "UPLOADED";
              const failed = item.status === "FAILED";

              return (
                <article
                  key={item.id}
                  className="rounded-md border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
                      {isActive ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : failed ? (
                        <AlertTriangle className="h-5 w-5 text-bb-status-danger-fg" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5 text-bb-status-success-fg" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {item.file.name}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {failed ? item.error ?? "Upload failed" : item.status}
                        {item.status === "UPLOADING" ? ` · ${item.progress}%` : ""}
                      </div>
                      {summary ? (
                        <div className="mt-2 text-sm leading-5 text-muted-foreground">{summary}</div>
                      ) : null}
                      {item.status === "COMPLETED" ? (
                        <div className="mt-2 text-sm leading-5 text-bb-status-success-fg">
                          Saved for review only. No ledger entry was created.
                        </div>
                      ) : null}
                    </div>
                    {failed ? (
                      <button
                        type="button"
                        onClick={() => uploader.retry(item.id)}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted/50"
                        aria-label={`Retry ${item.file.name}`}
                      >
                        <RefreshCcw className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </section>

        <section className="rounded-md border border-border bg-card p-4 text-sm leading-5 text-muted-foreground shadow-sm">
          Need the full ledger workflow?{" "}
          <Link href={ledgerHref} prefetch className="font-medium text-foreground underline underline-offset-4">
            Open desktop ledger
          </Link>
          .
        </section>
      </div>
    </MobileShell>
  );
}
