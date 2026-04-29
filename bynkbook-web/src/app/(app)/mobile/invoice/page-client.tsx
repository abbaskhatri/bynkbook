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

const MAX_INVOICE_BYTES = 25 * 1024 * 1024;
const INVOICE_ACCEPT = "image/*,application/pdf";

type SelectedInvoiceFile = {
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

function isAllowedInvoiceFile(file: File) {
  const type = file.type || "";
  const name = file.name.toLowerCase();
  return type.startsWith("image/") || type === "application/pdf" || name.endsWith(".pdf");
}

function fileKind(file: File) {
  if ((file.type || "").startsWith("image/")) return "Image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "PDF";
  return "File";
}

function moneyFromCents(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.abs(value) / 100);
}

function parsedSummary(parsed: Record<string, unknown> | null | undefined) {
  if (!parsed) return null;

  const parts = [
    typeof parsed.vendor_name === "string" && parsed.vendor_name.trim()
      ? parsed.vendor_name.trim()
      : null,
    typeof parsed.doc_number === "string" && parsed.doc_number.trim()
      ? `Invoice ${parsed.doc_number.trim()}`
      : null,
    typeof parsed.doc_date === "string" && parsed.doc_date.trim()
      ? parsed.doc_date.trim()
      : null,
    moneyFromCents(parsed.amount_cents),
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : null;
}

function statusLabel(item: {
  status: string;
  progress: number;
  parsedStatus?: string | null;
  error?: string;
}) {
  if (item.status === "FAILED") return item.error ?? "Upload failed";
  if (item.status === "UPLOADING") return `Uploading · ${item.progress}%`;
  if (item.status === "UPLOADED") return "Completing review upload";
  if (item.status === "COMPLETED") {
    if (item.parsedStatus === "FAILED") return "Saved for review · extraction failed";
    return "Saved for review";
  }
  return item.status;
}

export default function MobileInvoicePageClient() {
  const sp = useSearchParams();
  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;
  const accountIdFromUrl = sp.get("accountId") ?? null;
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<SelectedInvoiceFile[]>([]);
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

  const completeOptions = useMemo(
    () => ({ reviewOnly: true, mode: "REVIEW_ONLY" as const }),
    []
  );

  const uploader = useUploadController({
    type: "INVOICE",
    ctx: {
      businessId: businessId ?? undefined,
      accountId: accountId ?? undefined,
    },
    completeOptions,
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

    const accepted: SelectedInvoiceFile[] = [];
    const errors: string[] = [];

    for (const file of incoming) {
      if (!isAllowedInvoiceFile(file)) {
        errors.push(`${file.name} is not supported. Use an image or PDF invoice file.`);
        continue;
      }

      if (file.size > MAX_INVOICE_BYTES) {
        errors.push(`${file.name} is ${formatBytes(file.size)}. Invoice files must be 25 MB or smaller.`);
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
      ? "Invoice capture could not load workspace context."
      : null;

  return (
    <MobileShell businessId={businessId} accountId={accountId}>
      <div className="space-y-4">
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                Mobile capture
              </div>
              <h1 className="mt-2 truncate text-2xl font-semibold leading-tight text-slate-950">
                Invoice Upload
              </h1>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{business?.name ?? "Business"}</span>
                </span>
                <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                  <Landmark className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{account?.name ?? "No active account"}</span>
                </span>
              </div>
            </div>
            <Link
              href={reviewHref}
              prefetch
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Queue
            </Link>
          </div>
        </section>

        {bannerMessage ? (
          <InlineBanner title="Invoice capture is unavailable" message={bannerMessage} />
        ) : null}

        <section className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm">
          <div className="flex gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div className="space-y-2 text-sm leading-5 text-emerald-950">
              <p>Invoices are uploaded for review only. This will not create a vendor or AP bill automatically.</p>
              <p>For multiple-page invoices, upload a PDF or add images as separate review files for now.</p>
            </div>
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={!businessId}
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Camera className="h-5 w-5" />
              Take invoice photo
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!businessId}
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
            accept={INVOICE_ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.currentTarget.files) addFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />

          <div className="mt-4 text-xs leading-5 text-slate-500">
            Images and PDFs only. Maximum 25 MB per file.
          </div>
        </section>

        {validationErrors.length ? (
          <section className="space-y-2 rounded-md border border-rose-200 bg-rose-50/70 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-rose-950">
              <AlertTriangle className="h-4 w-4" />
              Some files were not added
            </div>
            {validationErrors.map((error, index) => (
              <div key={`${error}-${index}`} className="text-sm leading-5 text-rose-900">
                {error}
              </div>
            ))}
          </section>
        ) : null}

        <section className="space-y-3">
          <div className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Review before upload
          </div>

          {selectedFiles.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-white p-4 text-sm leading-5 text-slate-600 shadow-sm">
              No invoice files selected yet.
            </div>
          ) : (
            <>
              {hasMultipleImages ? (
                <div className="rounded-md border border-amber-200 bg-amber-50/70 p-4 text-sm leading-5 text-amber-950 shadow-sm">
                  Multiple images will upload as separate invoice review files for now. Use a PDF for a single multi-page invoice.
                </div>
              ) : null}

              {selectedFiles.map((item) => (
                <article
                  key={item.id}
                  className="rounded-md border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex gap-3">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                      {item.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.previewUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <FileText className="h-8 w-8 text-slate-500" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-slate-950">
                            {item.file.name}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
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
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
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
                className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-5 w-5" />
                Upload for review
              </button>
            </>
          )}
        </section>

        <section className="space-y-3">
          <div className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Upload status
          </div>

          {uploader.items.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-white p-4 text-sm leading-5 text-slate-600 shadow-sm">
              Uploaded invoices will appear here during this session. Desktop invoice behavior is unchanged.
            </div>
          ) : (
            uploader.items.map((item) => {
              const summary = parsedSummary(item.parsed);
              const isActive = item.status === "QUEUED" || item.status === "UPLOADING" || item.status === "UPLOADED";
              const failed = item.status === "FAILED";

              return (
                <article
                  key={item.id}
                  className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600">
                      {isActive ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : failed ? (
                        <AlertTriangle className="h-5 w-5 text-rose-600" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-950">
                        {item.file.name}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {statusLabel(item)}
                      </div>
                      {summary ? (
                        <div className="mt-2 text-sm leading-5 text-slate-600">{summary}</div>
                      ) : null}
                      {item.status === "COMPLETED" ? (
                        <div className="mt-2 text-sm leading-5 text-emerald-700">
                          Review needed. No vendor or AP bill was created.
                        </div>
                      ) : null}
                    </div>
                    {failed ? (
                      <button
                        type="button"
                        onClick={() => uploader.retry(item.id)}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
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

        <section className="rounded-md border border-slate-200 bg-white p-4 text-sm leading-5 text-slate-600 shadow-sm">
          Need the full AP workflow?{" "}
          <Link href={ledgerHref} prefetch className="font-medium text-slate-950 underline underline-offset-4">
            Open desktop ledger
          </Link>
          .
        </section>
      </div>
    </MobileShell>
  );
}
