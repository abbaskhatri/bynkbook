"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { AppDialog } from "@/components/primitives/AppDialog";
import { AppDatePicker } from "@/components/primitives/AppDatePicker";
import { PillToggle } from "@/components/primitives/PillToggle";
import { BusyButton } from "@/components/primitives/BusyButton";
import { DialogFooter } from "@/components/primitives/DialogFooter";
import { ringFocus } from "@/components/primitives/tokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Loader2 } from "lucide-react";

import { appErrorMessageOrNull } from "@/lib/errors/app-error";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { deleteVendor, getVendor, updateVendor } from "@/lib/api/vendors";
import { listCategories, type CategoryRow } from "@/lib/api/categories";
import {
  listBillsByVendor,
  createBill,
  updateBill,
  voidBill,
  getVendorApSummary,
  applyVendorPayment,
  unapplyVendorPayment,
} from "@/lib/api/ap";

import { apiFetch } from "@/lib/api/client";

import { UploadPanel } from "@/components/uploads/UploadPanel";
import { UploadsList } from "@/components/uploads/UploadsList";

function toBigIntSafe(v: any): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch { }
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

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Week starts Monday (CPA-friendly). Adjust if you prefer Sunday.
function startOfWeekUTC(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // to Monday
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}
function endOfWeekUTC(d: Date) {
  const s = startOfWeekUTC(d);
  const e = new Date(s);
  e.setUTCDate(e.getUTCDate() + 6);
  return e;
}
function startOfMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function endOfMonthUTC(d: Date) {
  const s = startOfMonthUTC(d);
  const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
  return e;
}
function startOfYearUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}
function endOfYearUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), 11, 31));
}

function norm(s: string) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function centsFromAny(v: any): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch { }
  return 0n;
}

function absBigint(v: bigint) {
  return v < 0n ? -v : v;
}

async function apiFetchWithRetry(path: string, init: any, retries: number = 1) {
  try {
    return await apiFetch(path, init);
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    const isTransient = msg.includes("503") || msg.includes("502") || msg.includes("504") || msg.includes("Service Unavailable");
    if (!isTransient || retries <= 0) throw e;
    await new Promise((r) => setTimeout(r, 350));
    return await apiFetch(path, init);
  }
}

function parseApiPayloadFromError(e: any) {
  const raw = String(e?.message ?? "");
  const m = raw.match(/^API\s+\d{3}:\s*(.*)$/s);
  if (m?.[1]) {
    try {
      return JSON.parse(m[1]);
    } catch { }
  }
  return e?.payload ?? null;
}

function vendorDeleteMessage(e: any) {
  const payload = parseApiPayloadFromError(e);
  if (payload?.code === "VENDOR_DELETE_BLOCKED") {
    const billCount = Number(payload?.details?.bill_count ?? 0);
    const entryCount = Number(payload?.details?.entry_count ?? 0);
    const uploadCount = Number(payload?.details?.upload_count ?? 0);

    const parts: string[] = [];
    if (billCount > 0) parts.push(`${billCount} bill${billCount === 1 ? "" : "s"}`);
    if (entryCount > 0) parts.push(`${entryCount} ledger entr${entryCount === 1 ? "y" : "ies"}`);
    if (uploadCount > 0) parts.push(`${uploadCount} invoice upload${uploadCount === 1 ? "" : "s"}`);

    if (parts.length > 0) {
      return `This vendor can’t be deleted yet. Remove linked records first: ${parts.join(", ")}.`;
    }
    return "This vendor can’t be deleted yet because linked records still exist.";
  }

  return appErrorMessageOrNull(e) ?? "Failed to delete vendor.";
}

function getUploadMeta(upload: any) {
  return upload?.meta && typeof upload.meta === "object" && !Array.isArray(upload.meta) ? upload.meta : {};
}

function getInvoiceUploadStatus(upload: any) {
  const meta = getUploadMeta(upload);
  const parsedStatus = String(meta?.parsed_status ?? "").toUpperCase();
  const duplicateCode = String(meta?.error_code ?? "").toUpperCase();

  if (meta?.bill_id) return { label: "Bill created", tone: "success" as const };
  if (duplicateCode === "DUPLICATE_UPLOAD") return { label: "Duplicate upload", tone: "neutral" as const };
  if (parsedStatus === "PARSED") return { label: "Parsed", tone: "success" as const };
  if (parsedStatus === "NEEDS_REVIEW") return { label: "Needs review", tone: "warn" as const };
  if (parsedStatus === "FAILED") return { label: "Failed", tone: "danger" as const };
  if (String(upload?.status ?? "").toUpperCase() === "COMPLETED") return { label: "Completed", tone: "neutral" as const };
  return { label: String(upload?.status ?? "Uploaded"), tone: "neutral" as const };
}

function getInvoiceUploadDetail(upload: any) {
  const meta = getUploadMeta(upload);
  const parsed = meta?.parsed && typeof meta.parsed === "object" && !Array.isArray(meta.parsed) ? meta.parsed : {};
  const parsedStatus = String(meta?.parsed_status ?? "").toUpperCase();
  const duplicateCode = String(meta?.error_code ?? "").toUpperCase();

  if (meta?.bill_id) return "Bill created automatically from this invoice.";
  if (duplicateCode === "DUPLICATE_UPLOAD") return "A matching completed upload already exists, so the existing upload was reused.";
  if (parsedStatus === "FAILED") return String(parsed?.error ?? "Parsing failed. Retry parse or upload a clearer invoice file.");

  if (parsedStatus === "NEEDS_REVIEW") {
    const missing: string[] = [];
    if (!parsed?.vendor_name || Number(parsed?.vendor_conf ?? 0) < 50) missing.push("vendor");
    if (!(typeof parsed?.amount_cents === "number" && Number.isFinite(parsed.amount_cents) && parsed.amount_cents !== 0) || Number(parsed?.amount_conf ?? 0) < 70) {
      missing.push("amount");
    }
    if (!parsed?.doc_date || Number(parsed?.doc_date_conf ?? 0) < 50) missing.push("invoice date");

    if (missing.length > 0) {
      return `Needs review: confirm ${missing.join(", ")} before a bill can be created.`;
    }
    return "Needs review before a bill can be created.";
  }

  if (parsedStatus === "PARSED") return "Parsed successfully.";
  return "";
}

function invoiceStatusClass(tone: "success" | "warn" | "danger" | "neutral") {
  if (tone === "success") return "inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-primary";
  if (tone === "warn") return "inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-amber-700";
  if (tone === "danger") return "inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-red-700";
  return "inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-slate-700";
}

function uploadParsedAmountString(upload: any) {
  const meta = getUploadMeta(upload);
  const parsed = meta?.parsed && typeof meta.parsed === "object" && !Array.isArray(meta.parsed) ? meta.parsed : {};
  const cents = Number(parsed?.amount_cents ?? NaN);
  if (!Number.isFinite(cents) || cents <= 0) return "";
  return (cents / 100).toFixed(2);
}

function UpdatingOverlay({ label = "Updating…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center rounded-xl bg-white/55 backdrop-blur-[1px]">
      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function presetRange(preset: string) {
  const now = new Date();
  if (preset === "this_week") return { from: ymd(startOfWeekUTC(now)), to: ymd(endOfWeekUTC(now)) };
  if (preset === "last_week") {
    const s = startOfWeekUTC(now);
    s.setUTCDate(s.getUTCDate() - 7);
    const e = new Date(s);
    e.setUTCDate(e.getUTCDate() + 6);
    return { from: ymd(s), to: ymd(e) };
  }
  if (preset === "this_month") return { from: ymd(startOfMonthUTC(now)), to: ymd(endOfMonthUTC(now)) };
  if (preset === "last_month") {
    const s = startOfMonthUTC(now);
    s.setUTCMonth(s.getUTCMonth() - 1);
    const e = endOfMonthUTC(s);
    return { from: ymd(s), to: ymd(e) };
  }
  if (preset === "this_year") return { from: ymd(startOfYearUTC(now)), to: ymd(endOfYearUTC(now)) };
  if (preset === "last_year") {
    const s = startOfYearUTC(now);
    s.setUTCFullYear(s.getUTCFullYear() - 1);
    const e = endOfYearUTC(s);
    return { from: ymd(s), to: ymd(e) };
  }
  return { from: "", to: "" };
}

export default function VendorDetailPageClient() {
  const params = useParams<{ vendorId: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const businessesQ = useBusinesses();

  // Deep-link from Ledger "Apply payment" pill
  const openApplyParam = sp.get("openApply");
  const entryIdParam = sp.get("entryId");
  const accountIdParam = sp.get("accountId");

  const vendorId = String(params.vendorId ?? "");
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;
  const businessId = bizIdFromUrl ?? (businessesQ.data?.[0]?.id ?? null);
  const accountsQ = useAccounts(businessId);

  const myRole = useMemo(() => {
    if (!businessId) return "";
    const b = (businessesQ.data ?? []).find((x: any) => x?.id === businessId);
    return String(b?.role ?? "").toUpperCase();
  }, [businessId, businessesQ.data]);

  const canWrite = ["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"].includes(myRole);

  const CLOSED_PERIOD_MSG = "This period is closed. Reopen period to modify.";

  const [loading, setLoading] = useState(false);

  // Phase 1 Stabilization:
  // 1) Loading token prevents overlapping async flows from clearing each other’s busy state.
  // 2) Refresh epoch + coalescing prevents stale refresh commits and overlapping refreshes.
  const loadingTokenRef = useRef(0);
  function beginLoading() {
    const token = ++loadingTokenRef.current;
    setLoading(true);
    return token;
  }
  function endLoading(token: number) {
    if (token === loadingTokenRef.current) setLoading(false);
  }

  const refreshEpochRef = useRef(0);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [errIsClosed, setErrIsClosed] = useState(false);
  const [vendor, setVendor] = useState<any>(null);
  const [categoryRows, setCategoryRows] = useState<CategoryRow[]>([]);

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categoryRows) m.set(String(c.id), String(c.name));
    return m;
  }, [categoryRows]);

  const [bills, setBills] = useState<any[]>([]);
  const [apSummary, setApSummary] = useState<any>(null);

  const [highlightBillId, setHighlightBillId] = useState<string | null>(null);

  const [apTab, setApTab] = useState<"bills" | "payments">("bills");
  const [vendorPayments, setVendorPayments] = useState<any[]>([]);
  const [paymentsErr, setPaymentsErr] = useState<string | null>(null);
  const [paymentsErrIsClosed, setPaymentsErrIsClosed] = useState(false);

  // Row-level pending state (never feels stuck)
  const [pendingBillById, setPendingBillById] = useState<Record<string, boolean>>({});
  const [pendingPaymentByEntryId, setPendingPaymentByEntryId] = useState<Record<string, "APPLYING" | "UNAPPLYING">>({});
  const [applyActionLoading, setApplyActionLoading] = useState(false);

  function isClosedPeriodError(e: any, msg: string | null): boolean {
    if (msg === CLOSED_PERIOD_MSG) return true;
    const code = String(e?.code ?? e?.payload?.code ?? e?.data?.code ?? e?.response?.data?.code ?? "").toUpperCase();
    if (code === "CLOSED_PERIOD") return true;
    const status = Number(e?.status ?? e?.statusCode ?? e?.response?.status ?? e?.payload?.status ?? NaN);
    if (status === 409 && msg === CLOSED_PERIOD_MSG) return true;
    return false;
  }

  function markBillPending(billId: string) {
    if (!billId) return;
    setPendingBillById((m) => ({ ...m, [billId]: true }));
  }
  function clearBillPending(billId: string) {
    if (!billId) return;
    setPendingBillById((m) => {
      if (!m[billId]) return m;
      const next = { ...m };
      delete next[billId];
      return next;
    });
  }

  function markPaymentPending(entryId: string, action: "APPLYING" | "UNAPPLYING") {
    if (!entryId) return;
    setPendingPaymentByEntryId((m) => ({ ...m, [entryId]: action }));
  }
  function clearPaymentPending(entryId: string) {
    if (!entryId) return;
    setPendingPaymentByEntryId((m) => {
      if (!m[entryId]) return m;
      const next = { ...m };
      delete next[entryId];
      return next;
    });
  }

  // Vendor credit (derived from payments-summary totals.total_unapplied_cents)
  const [vendorCreditCents, setVendorCreditCents] = useState<bigint>(0n);

  // Apply credit flow (guardrail: do not preselect payment without known account context)
  const [creditApplyCandidateEntryId, setCreditApplyCandidateEntryId] = useState<string | null>(null);
  const [creditApplyRequested, setCreditApplyRequested] = useState(false);

  const [billsLoading, setBillsLoading] = useState(false);

  const summaryUpdating = loading && !!vendor;
  const apUpdating = loading && (!!apSummary || bills.length > 0 || vendorPayments.length > 0);

  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [billEditId, setBillEditId] = useState<string | null>(null);
  const [billSourceUpload, setBillSourceUpload] = useState<any | null>(null);
  const [billInvoiceDate, setBillInvoiceDate] = useState(todayYmd());
  const [billDueDate, setBillDueDate] = useState(todayYmd());
  const [billAmount, setBillAmount] = useState("");
  const [billMemo, setBillMemo] = useState("");
  const [billTerms, setBillTerms] = useState("");
  const [billVoidReason, setBillVoidReason] = useState("");
  const [voidBillOpen, setVoidBillOpen] = useState(false);
  const [voidBillId, setVoidBillId] = useState<string | null>(null);

  // Vendor-first unified payment+apply dialog
  const [vendorPayOpen, setVendorPayOpen] = useState(false);
  const [vendorPayAccountId, setVendorPayAccountId] = useState<string | null>(null);
  const [vendorPayDate, setVendorPayDate] = useState(todayYmd());
  const [vendorPayMethod, setVendorPayMethod] = useState("OTHER");
  const [vendorPayAmount, setVendorPayAmount] = useState("");
  const [vendorPayMemo, setVendorPayMemo] = useState("Vendor payment");
  const [vendorPayAutoApply, setVendorPayAutoApply] = useState(true);

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyAccountId, setApplyAccountId] = useState<string | null>(null);

  // All candidate expense entries for the selected account (linked + suggested)
  const [paymentEntries, setPaymentEntries] = useState<any[]>([]);
  const [suggestedEntries, setSuggestedEntries] = useState<any[]>([]);

  const [paymentEntryId, setPaymentEntryId] = useState<string | null>(null);
  const [applyAmounts, setApplyAmounts] = useState<Record<string, string>>({});

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [defaultCategoryId, setDefaultCategoryId] = useState("");

  const [openUpload, setOpenUpload] = useState(false);

  const [invoiceUploads, setInvoiceUploads] = useState<any[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const uploadsUpdating = loading && invoiceUploads.length > 0;

  // Statement dialog
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementPreset, setStatementPreset] = useState<
    "this_week" | "last_week" | "this_month" | "last_month" | "this_year" | "last_year" | "custom"
  >("this_month");
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");


  async function refresh() {
    if (!businessId || !vendorId) return;

    // Coalesce refreshes: 1 in-flight, 1 queued
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    const myEpoch = ++refreshEpochRef.current;
    const loadingToken = beginLoading();

    const run = (async () => {
      setErr(null);

      try {
        const [vRes, billsRes, sumRes, uploadsRes, payRes, catsRes] = await Promise.all([
          getVendor({ businessId, vendorId }),
          listBillsByVendor({ businessId, vendorId, status: "all", limit: 200 }),
          getVendorApSummary({ businessId, vendorId, asOf: todayYmd() }),

          apiFetchWithRetry(
            `/v1/businesses/${businessId}/uploads?type=INVOICE&vendorId=${encodeURIComponent(vendorId)}&limit=50`,
            { method: "GET" }
          ),

          apiFetchWithRetry(
            `/v1/businesses/${businessId}/vendors/${vendorId}/ap/payments-summary?limit=200`,
            { method: "GET" },
            1
          ).catch((e: any) => {
            // Do not break vendor page if payments endpoint is transient
            return { ok: false, error: e?.message ?? "Payments unavailable", payments: [] };
          }),
          listCategories(businessId, { includeArchived: false }),
        ]);

        // Epoch guard: do not commit stale refresh results
        if (myEpoch !== refreshEpochRef.current) return;

        setVendor(vRes.vendor);
        setName(String(vRes.vendor?.name ?? ""));
        setNotes(String(vRes.vendor?.notes ?? ""));
        setDefaultCategoryId(String(vRes.vendor?.default_category_id ?? ""));
        setCategoryRows(Array.isArray(catsRes.rows) ? catsRes.rows : []);

        setBills(Array.isArray(billsRes.bills) ? billsRes.bills : []);
        setApSummary(sumRes.summary ?? null);

        setInvoiceUploads(Array.isArray((uploadsRes as any)?.items) ? (uploadsRes as any).items : []);

        if ((payRes as any)?.ok === false) {
          setPaymentsErr(String((payRes as any)?.error ?? "Payments unavailable"));
          setVendorPayments([]);
          setVendorCreditCents(0n);
          setCreditApplyCandidateEntryId(null);
        } else {
          setPaymentsErr(null);

          const payments = Array.isArray((payRes as any)?.payments) ? (payRes as any).payments : [];
          setVendorPayments(payments);

          const totalUnapplied = toBigIntSafe((payRes as any)?.totals?.total_unapplied_cents ?? 0);
          setVendorCreditCents(totalUnapplied);

          // Candidate payment entry: first with unapplied > 0 (do not preselect until account context is known)
          const cand = payments.find((p: any) => toBigIntSafe(p?.unapplied_cents ?? 0) > 0n);
          setCreditApplyCandidateEntryId(cand ? String(cand.entry_id ?? "") : null);
        }
      } catch (e: any) {
        if (myEpoch === refreshEpochRef.current) setErr(e?.message ?? "Failed to load vendor");
      } finally {
        // Only clear loading if this refresh still owns the latest loading token
        endLoading(loadingToken);
      }
    })();

    refreshInFlightRef.current = run;

    try {
      await run;
    } finally {
      if (refreshInFlightRef.current === run) refreshInFlightRef.current = null;

      // Run one queued refresh (latest scope wins automatically due to epoch)
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        void refresh();
      }
    }
  }

  function computeAutoAllocationMap(totalCents: bigint) {
    const openBills = bills.filter((b: any) => String(b.status) === "OPEN" || String(b.status) === "PARTIAL");
    let remaining = totalCents;

    const next: Record<string, string> = {};

    for (const b of openBills) {
      if (remaining <= 0n) break;
      const out = centsFromAny(b.outstanding_cents);
      if (out <= 0n) continue;

      const use = remaining < out ? remaining : out;
      // store dollars string for the input (e.g. "1260.00")
      next[String(b.id)] = (Number(use) / 100).toFixed(2);

      remaining -= use;
    }

    return { map: next, remaining };
  }

  async function onSave() {
    if (!businessId || !vendorId) return;
    const loadingToken = beginLoading();
    setErr(null);
    try {
      const res = await updateVendor({
        businessId,
        vendorId,
        name: name.trim(),
        notes: notes.trim(),
        default_category_id: defaultCategoryId || null,
      });
      setVendor(res.vendor);
      setEditOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update vendor");
    } finally {
      endLoading(loadingToken);
    }
  }

  useEffect(() => {
    if (businessId && vendorId && !vendor && !loading && !err) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, vendorId]);

  // Prefill bill dialog when editing or when opened from an invoice upload
  useEffect(() => {
    if (!billDialogOpen) return;

    if (!billEditId) {
      const up = billSourceUpload;
      const meta = up ? getUploadMeta(up) : {};
      const parsed = meta?.parsed && typeof meta.parsed === "object" && !Array.isArray(meta.parsed) ? meta.parsed : {};

      const invoiceDate =
        String(parsed?.doc_date ?? "").trim() ||
        String(up?.created_at ?? "").slice(0, 10) ||
        todayYmd();

      const dueDate =
        String(parsed?.due_date ?? "").trim() ||
        invoiceDate ||
        todayYmd();

      const amountStr = up ? uploadParsedAmountString(up) : "";
      const docNumber = String(parsed?.doc_number ?? "").trim();
      const fallbackMemo = docNumber
        ? `Invoice ${docNumber}`
        : String(up?.original_filename ?? "").trim();

      setBillInvoiceDate(invoiceDate);
      setBillDueDate(dueDate);
      setBillAmount(amountStr);
      setBillMemo(fallbackMemo);
      setBillTerms("");
      return;
    }

    const b = bills.find((x: any) => String(x.id) === String(billEditId));
    if (!b) return;

    setBillInvoiceDate(String(b.invoice_date ?? "").slice(0, 10));
    setBillDueDate(String(b.due_date ?? "").slice(0, 10));
    setBillAmount((Number(String(b.amount_cents ?? 0)) / 100).toFixed(2));
    setBillMemo(String(b.memo ?? ""));
    setBillTerms(String(b.terms ?? ""));
  }, [billDialogOpen, billEditId, billSourceUpload, bills]);

  // Ledger deep-link: open apply dialog and preselect account + entry
  useEffect(() => {
    if (!openApplyParam) return;

    // Open immediately (even if businessesQ is still loading),
    // then hydrate account/payment once businessId is available.
    setApplyOpen(true);

    if (accountIdParam) setApplyAccountId(accountIdParam);
    if (entryIdParam) setPaymentEntryId(entryIdParam);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openApplyParam, accountIdParam, entryIdParam]);

  useEffect(() => {
    function onRefreshAny() {
      refresh();
    }

    function onRefreshDetail(e: any) {
      const vid = String(e?.detail?.vendorId ?? "");
      if (!vid || vid === vendorId) refresh();
    }

    window.addEventListener("bynk:vendors-refresh", onRefreshAny as any);
    window.addEventListener("bynk:vendor-detail-refresh", onRefreshDetail as any);

    return () => {
      window.removeEventListener("bynk:vendors-refresh", onRefreshAny as any);
      window.removeEventListener("bynk:vendor-detail-refresh", onRefreshDetail as any);
    };
  }, [vendorId, businessId]); // refresh() already checks businessId/vendorId

  useEffect(() => {
    if (!applyOpen) return;

    // default account selection on open (first account)
    // (do not override deep-linked accountIdParam)
    if (!applyAccountId && !accountIdParam) {
      const first = (accountsQ.data ?? [])[0]?.id ?? null;
      if (first) setApplyAccountId(first);
    }

    // reset amounts on open; keep preselected paymentEntryId if one was set by user click
    setApplyAmounts({});

    if (!businessId || !applyAccountId) return;

    let cancelled = false;

    (async () => {
      try {
        const qs = new URLSearchParams();
        qs.set("limit", "200");
        qs.set("type", "EXPENSE");

        const res: any = await apiFetch(
          `/v1/businesses/${businessId}/accounts/${applyAccountId}/entries?${qs.toString()}`,
          { method: "GET" }
        );

        const rows = Array.isArray(res?.entries) ? res.entries : [];

        // Split: linked payments (entry.vendor_id === vendorId) and suggested (vendor_id null + payee matches vendor name)
        const vName = norm(vendor?.name || "");
        const linked = rows.filter((e: any) => String(e.vendor_id || "") === vendorId);

        const suggested = rows
          .filter((e: any) => !e.vendor_id)
          .filter((e: any) => {
            const p = norm(e.payee || "");
            return vName && p && (p === vName || p.includes(vName) || vName.includes(p));
          })
          .slice(0, 50);

        if (!cancelled) {
          setPaymentEntries(linked);
          setSuggestedEntries(suggested);

          // Apply credit: only preselect if account context is known AND candidate exists in this account list
          if (creditApplyRequested && creditApplyCandidateEntryId) {
            const exists = linked.some((e: any) => String(e.id) === String(creditApplyCandidateEntryId));
            if (exists) {
              setPaymentEntryId(creditApplyCandidateEntryId);
              setCreditApplyRequested(false);
            }
          }
        }
      } catch {
        if (!cancelled) {
          setPaymentEntries([]);
          setSuggestedEntries([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyOpen, businessId, applyAccountId, vendorId]);

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
                  className={["h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50", ringFocus].join(" ")}
                  onClick={() => {
                    if (!businessId) return;
                    window.location.href = `/vendors?businessId=${encodeURIComponent(businessId)}`;
                  }}
                >
                  Back
                </button>

                <button
                  type="button"
                  className={["h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50", ringFocus].join(" ")}
                  onClick={() => setOpenUpload(true)}
                >
                  Upload Invoice
                </button>

                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                  disabled={!businessId || loading}
                  onClick={() => {
                    if (!businessId) return;

                    // default preset range on open
                    const r = presetRange(statementPreset);
                    if (statementPreset !== "custom") {
                      setStatementFrom(r.from);
                      setStatementTo(r.to);
                    } else {
                      if (!statementFrom) setStatementFrom(todayYmd());
                      if (!statementTo) setStatementTo(todayYmd());
                    }

                    setStatementOpen(true);
                  }}
                  title="Download vendor statement (CSV)"
                >
                  Download statement
                </button>

                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                  disabled={!businessId}
                  onClick={async () => {
                    if (!businessId) return;
                    try {
                      await apiFetch(`/v1/businesses/${businessId}/uploads/backfill-bills`, {
                        method: "POST",
                        body: JSON.stringify({ vendor_id: vendorId, limit: 200 }),
                      });
                      await refresh();
                      window.dispatchEvent(new CustomEvent("bynk:vendors-refresh"));
                    } catch (e: any) {
                      setErr(e?.message ?? "Backfill failed");
                    }
                  }}
                  title="Create bills from older invoice uploads (idempotent)"
                >
                  Backfill bills
                </button>

                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  disabled={!canWrite || loading}
                  title={!canWrite ? "Insufficient permissions" : "Delete vendor"}
                  onClick={() => {
                    setDeleteErr(null);
                    setDeleteConfirm("");
                    setDeleteOpen(true);
                  }}
                >
                  Delete
                </button>

                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                  disabled={!canWrite || loading}
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

                {err ? (
                  <div className="text-xs text-red-600 ml-1">
                    <div>{err}</div>

                    {errIsClosed ? (
                      <a
                        className="mt-1 inline-flex text-[11px] underline text-slate-700 hover:text-slate-900"
                        href={
                          businessId
                            ? `/closed-periods?businessId=${encodeURIComponent(businessId)}&focus=reopen`
                            : "/closed-periods?focus=reopen"
                        }
                      >
                        Go to Close Periods
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </>
            }
          />
        </div>
      </div>

      <Card className="relative">
        {summaryUpdating ? <UpdatingOverlay /> : null}
        <div className={summaryUpdating ? "pointer-events-none select-none blur-[1px]" : ""}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Basic info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {vendor ? (
            <>
              <div><span className="text-slate-600">Name:</span> <span className="font-medium">{vendor.name}</span></div>
              <div>
                <span className="text-slate-600">Default category:</span>{" "}
                <span className="font-medium">
                  {vendor.default_category_id ? (categoryNameById.get(String(vendor.default_category_id)) ?? "—") : "—"}
                </span>
              </div>
              <div><span className="text-slate-600">Notes:</span> <span className="font-medium">{vendor.notes ?? "—"}</span></div>
              <div className="text-slate-600 text-xs">
                Created: {String(vendor.created_at ?? "").slice(0, 10)} • Updated: {String(vendor.updated_at ?? "").slice(0, 10)}
              </div>
            </>
          ) : loading ? (
            <div className="space-y-2">
              <div className="h-3 w-44 rounded bg-slate-200 animate-pulse" />
              <div className="h-3 w-64 rounded bg-slate-200 animate-pulse" />
              <div className="h-3 w-56 rounded bg-slate-200 animate-pulse" />
            </div>
          ) : (
            <div className="text-sm text-slate-600">Vendor not loaded.</div>
          )}
        </CardContent>
        </div>
      </Card>

      <Card className="relative">
        {apUpdating ? <UpdatingOverlay /> : null}
        <div className={apUpdating ? "pointer-events-none select-none blur-[1px]" : ""}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">Accounts payable</CardTitle>
              <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
                <button
                  type="button"
                  className={"h-7 px-3 text-xs " + (apTab === "bills" ? "bg-slate-900 text-white" : "bg-white text-slate-700")}
                  onClick={() => { setApTab("bills"); setHighlightBillId(null); }}
                >
                  Bills
                </button>
                <button
                  type="button"
                  className={"h-7 px-3 text-xs " + (apTab === "payments" ? "bg-slate-900 text-white" : "bg-white text-slate-700")}
                  onClick={() => setApTab("payments")}
                >
                  Payments
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => {
                  setVendorPayOpen(true);
                  // defaults
                  const first = (accountsQ.data ?? []).find((a: any) => !a.archived_at)?.id ?? null;
                  if (first) setVendorPayAccountId(first);
                  setVendorPayDate(todayYmd());
                  setVendorPayMethod("OTHER");
                  setVendorPayAmount("");
                  setVendorPayMemo("Vendor payment");
                  setVendorPayAutoApply(true);
                  setApplyAmounts({});
                }}
                disabled={!canWrite || !businessId}
              >
                Apply Payment
              </Button>

              <Button
                className="h-7 px-3 text-xs"
                onClick={() => {
                  // deterministic reset (guardrail)
                  setBillEditId(null);
                  setBillSourceUpload(null);
                  setBillInvoiceDate(todayYmd());
                  setBillDueDate(todayYmd());
                  setBillAmount("");
                  setBillMemo("");
                  setBillTerms("");
                  setBillVoidReason("");
                  setErr(null);
                  setBillDialogOpen(true);
                }}
                disabled={!canWrite || !businessId}
              >
                New Bill
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[11px] text-slate-600">AP Balance (open)</div>
            <div className="mt-1 text-sm font-semibold tabular-nums">
              {formatUsdFromCents(toBigIntSafe(apSummary?.total_open_cents ?? 0))}
            </div>

            <div className="mt-1 text-xs text-slate-600">
              Vendor credit (unapplied):{" "}
              <span className={vendorCreditCents > 0n ? "font-semibold text-slate-900 tabular-nums" : "text-slate-500 tabular-nums"}>
                {formatUsdFromCents(vendorCreditCents)}
              </span>
            </div>

            <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
              <div className="rounded-md border border-slate-200 p-2">
                <div className="text-[11px] text-slate-600">Current</div>
                <div className="font-semibold tabular-nums">{formatUsdFromCents(toBigIntSafe(apSummary?.aging?.current ?? 0))}</div>
              </div>
              <div className="rounded-md border border-slate-200 p-2">
                <div className="text-[11px] text-slate-600">30</div>
                <div className="font-semibold tabular-nums">{formatUsdFromCents(toBigIntSafe(apSummary?.aging?.days_30 ?? 0))}</div>
              </div>
              <div className="rounded-md border border-slate-200 p-2">
                <div className="text-[11px] text-slate-600">60</div>
                <div className="font-semibold tabular-nums">{formatUsdFromCents(toBigIntSafe(apSummary?.aging?.days_60 ?? 0))}</div>
              </div>
              <div className="rounded-md border border-slate-200 p-2">
                <div className="text-[11px] text-slate-600">90+</div>
                <div className="font-semibold tabular-nums">{formatUsdFromCents(toBigIntSafe(apSummary?.aging?.days_90 ?? 0))}</div>
              </div>
            </div>
          </div>

          {apTab === "bills" ? (
            <div className="space-y-2">
              {vendorCreditCents > 0n ? (
                <div className="rounded-lg border border-slate-200 bg-primary/10 px-3 py-2 flex items-center justify-between">
                  <div className="text-xs text-primary">
                    Vendor credit available: <span className="font-semibold tabular-nums">{formatUsdFromCents(vendorCreditCents)}</span>
                  </div>

                  <Button
                    variant="outline"
                    className="h-7 px-3 text-xs"
                    onClick={() => {
                      // Guardrail: do NOT preselect a payment unless account context is known.
                      setCreditApplyRequested(true);
                      setApplyOpen(true);

                      // If the deep-link accountIdParam exists, we can set it.
                      if (accountIdParam) setApplyAccountId(accountIdParam);
                      else setApplyAccountId(null);

                      setPaymentEntryId(null);
                      setApplyAmounts({});
                    }}
                    title="Apply available vendor credit to open bills"
                  >
                    Apply credit
                  </Button>
                </div>
              ) : null}

              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                      <tr className="h-9">
                        <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Invoice</th>
                        <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Due</th>
                        <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Memo</th>
                        <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Amount</th>
                        <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Applied</th>
                        <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Outstanding</th>
                        <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Status</th>
                        <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bills.length === 0 ? (
                        loading ? (
                          <>
                            {Array.from({ length: 8 }).map((_, i) => (
                              <tr key={`bill-sk-${i}`} className="h-9 border-b border-slate-100">
                                <td className="px-3"><div className="h-3 w-20 rounded bg-slate-200 animate-pulse" /></td>
                                <td className="px-3"><div className="h-3 w-24 rounded bg-slate-200 animate-pulse" /></td>
                                <td className="px-3"><div className="h-3 w-24 rounded bg-slate-200 animate-pulse" /></td>
                                <td className="px-3"><div className="h-3 w-16 rounded bg-slate-200 animate-pulse" /></td>
                                <td className="px-3"><div className="h-3 w-24 rounded bg-slate-200 animate-pulse ml-auto" /></td>
                                <td className="px-3"><div className="h-3 w-24 rounded bg-slate-200 animate-pulse ml-auto" /></td>
                                <td className="px-3"><div className="h-3 w-20 rounded bg-slate-200 animate-pulse" /></td>
                                <td className="px-3"><div className="h-3 w-16 rounded bg-slate-200 animate-pulse ml-auto" /></td>
                              </tr>
                            ))}
                          </>
                        ) : (
                          <tr>
                            <td className="px-3 py-4 text-sm text-slate-600" colSpan={8}>
                              No bills yet.
                            </td>
                          </tr>
                        )
                      ) : (
                        bills.map((b: any) => {
                          const amount = toBigIntSafe(b.amount_cents ?? 0);
                          const applied = toBigIntSafe(b.applied_cents ?? 0);
                          const outstanding = toBigIntSafe(b.outstanding_cents ?? 0);
                          const st = String(b.status ?? "");
                          const isVoid = st === "VOID";

                          return (
                            <tr
                              key={b.id}
                              data-bill-row={String(b.id)}
                              className={
                                "h-9 border-b border-slate-100 hover:bg-slate-50 " +
                                (highlightBillId === String(b.id) ? "bg-accent" : "")
                              }
                            >
                              <td className="px-3 text-sm tabular-nums">{String(b.invoice_date ?? "").slice(0, 10)}</td>
                              <td className="px-3 text-sm tabular-nums">{String(b.due_date ?? "").slice(0, 10)}</td>
                              <td className="px-3 text-sm text-slate-700 truncate max-w-[260px]" title={String(b.memo ?? "")}>
                                {b.memo ?? "—"}
                              </td>
                              <td className="px-3 text-sm text-right tabular-nums font-semibold">{formatUsdFromCents(amount)}</td>
                              <td className="px-3 text-sm text-right tabular-nums">{formatUsdFromCents(applied)}</td>
                              <td className="px-3 text-sm text-right tabular-nums font-semibold">{formatUsdFromCents(outstanding)}</td>
                              <td className="px-3 text-xs">
                                <span
                                  className={
                                    "inline-flex h-6 items-center rounded-full px-2 " +
                                    (isVoid
                                      ? "bg-slate-100 text-slate-600"
                                      : st === "PAID"
                                        ? "bg-primary/10 text-primary"
                                        : "bg-amber-50 text-amber-700")
                                  }
                                >
                                  {st}
                                </span>
                              </td>
                              <td className="px-3 text-right">
                                <div className="inline-flex items-center gap-2">
                                  {pendingBillById[String(b.id)] ? (
                                    <span className="inline-flex items-center" title="Saving…">
                                      <Loader2 className="h-3 w-3 text-slate-400 animate-spin" />
                                    </span>
                                  ) : null}

                                  <button
                                    type="button"
                                    className="text-xs text-slate-700 hover:underline disabled:opacity-50"
                                    disabled={!canWrite || isVoid}
                                    onClick={() => {
                                      setBillEditId(String(b.id));
                                      setBillDialogOpen(true);
                                    }}
                                  >
                                    Edit
                                  </button>

                                  <button
                                    type="button"
                                    className="text-xs text-red-700 hover:underline disabled:opacity-50"
                                    disabled={!canWrite || isVoid || pendingBillById[String(b.id)]}
                                    onClick={() => {
                                      setErr(null);
                                      setErrIsClosed(false);
                                      setBillVoidReason("");
                                      setVoidBillId(String(b.id));
                                      setVoidBillOpen(true);
                                    }}
                                    title="Cannot void if applied—must unapply first"
                                  >
                                    Void
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {err ? <div className="px-3 py-2 text-xs text-red-600 border-t border-slate-200">{err}</div> : null}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                    <tr className="h-9">
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Date</th>
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Payee</th>
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Applied to</th>
                      <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Amount</th>
                      <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Applied</th>
                      <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Unapplied</th>
                      <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentsErr ? (
                      <tr>
                        <td className="px-3 py-4 text-sm text-red-700" colSpan={4}>
                          <div>{paymentsErr}</div>

                          {paymentsErrIsClosed ? (
                            <a
                              className="mt-1 inline-flex text-[11px] underline text-slate-700 hover:text-slate-900"
                              href={
                                businessId
                                  ? `/closed-periods?businessId=${encodeURIComponent(businessId)}&focus=reopen`
                                  : "/closed-periods?focus=reopen"
                              }
                            >
                              Go to Close Periods
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    ) : vendorPayments.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-sm text-slate-600" colSpan={4}>
                          No vendor-linked payments yet.
                        </td>
                      </tr>
                    ) : (
                      vendorPayments.map((p: any) => {
                        const entryId = String(p.entry_id ?? p.id ?? "");
                        const pendingAction = pendingPaymentByEntryId[entryId];
                        const isPending = !!pendingAction;

                        return (
                          <tr key={entryId} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-3 text-sm tabular-nums">{String(p.date ?? "").slice(0, 10)}</td>
                            <td className="px-3 text-sm">
                              <span className="inline-flex items-center gap-2">
                                {isPending ? <Loader2 className="h-3 w-3 text-slate-400 animate-spin" /> : null}
                                <span>{p.payee}</span>
                                {pendingAction === "APPLYING" ? (
                                  <span className="text-[11px] text-slate-500">Applying…</span>
                                ) : pendingAction === "UNAPPLYING" ? (
                                  <span className="text-[11px] text-slate-500">Unapplying…</span>
                                ) : null}
                              </span>
                            </td>
                            <td className="px-3 text-xs">
                              {Array.isArray(p.applied_bills) && p.applied_bills.length ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {p.applied_bills.slice(0, 6).map((x: any) => (
                                    <button
                                      key={String(x.bill_id)}
                                      type="button"
                                      className="inline-flex h-6 items-center rounded-full border border-slate-200 bg-white px-2 text-[11px] text-slate-700 hover:bg-slate-50"
                                      title="View invoice"
                                      onClick={() => {
                                        setApTab("bills");
                                        setHighlightBillId(String(x.bill_id));
                                        // scroll the bills table into view
                                        setTimeout(() => {
                                          const el = document.querySelector(`[data-bill-row="${String(x.bill_id)}"]`);
                                          if (el && "scrollIntoView" in el) (el as any).scrollIntoView({ block: "center" });
                                        }, 50);
                                      }}
                                    >
                                      {String(x.memo ?? "Invoice")}
                                    </button>
                                  ))}
                                  {p.applied_bills.length > 6 ? <span className="text-[11px] text-slate-500">+{p.applied_bills.length - 6}</span> : null}
                                </div>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                            <td className="px-3 text-sm text-right tabular-nums font-semibold">{formatUsdFromCents(centsFromAny(p.amount_cents))}</td>
                            <td className="px-3 text-sm text-right tabular-nums">{formatUsdFromCents(centsFromAny(p.applied_cents))}</td>
                            <td className="px-3 text-sm text-right tabular-nums font-semibold">{formatUsdFromCents(centsFromAny(p.unapplied_cents))}</td>
                            <td className="px-3 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  className="text-xs text-slate-700 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={isPending}
                                  title={isPending ? "This payment is updating…" : "Apply or unapply this payment"}
                                  onClick={() => {
                                    const first = (accountsQ.data ?? []).find((a: any) => !a.archived_at)?.id ?? null;
                                    if (first) setApplyAccountId(first);
                                    setPaymentEntryId(String(p.entry_id ?? p.id));
                                    setApplyOpen(true);
                                  }}
                                >
                                  Apply / Unapply
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
        </div>
      </Card>

      <div className="space-y-2">

      <Card className="relative">
        {uploadsUpdating ? <UpdatingOverlay /> : null}
        <div className={uploadsUpdating ? "pointer-events-none select-none blur-[1px]" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Invoices</CardTitle>
          </CardHeader>

          <CardContent>
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                    <tr className="h-9">
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">File</th>
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Date</th>
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Status</th>
                      <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceUploads.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-sm text-slate-600" colSpan={4}>
                          No uploads yet.
                        </td>
                      </tr>
                    ) : (
                      invoiceUploads.map((u: any) => {
                        const meta = getUploadMeta(u);
                        const parsed = meta?.parsed && typeof meta.parsed === "object" && !Array.isArray(meta.parsed) ? meta.parsed : {};
                        const status = getInvoiceUploadStatus(u);
                        const detail = getInvoiceUploadDetail(u);
                        const canRetryParse =
                          String(meta?.parsed_status ?? "").toUpperCase() === "FAILED" ||
                          String(meta?.parsed_status ?? "").toUpperCase() === "NEEDS_REVIEW";

                        return (
                          <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                            <td className="px-3 py-2 text-sm">
                              <div className="font-medium text-slate-900">{u.original_filename}</div>
                              <div className="mt-0.5 text-[11px] text-slate-500">
                                {String(meta?.vendor_name ?? parsed?.vendor_name ?? vendor?.name ?? "Vendor")}
                              </div>
                            </td>

                            <td className="px-3 py-2 text-sm text-slate-600">
                              {String(u.created_at ?? "").slice(0, 10)}
                            </td>

                            <td className="px-3 py-2 text-sm">
                              <div>
                                <span className={invoiceStatusClass(status.tone)}>{status.label}</span>
                              </div>
                              {detail ? (
                                <div className="mt-1 max-w-[420px] text-[11px] text-slate-500">{detail}</div>
                              ) : null}
                            </td>

                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex flex-wrap items-center justify-end gap-2">
                                <button
                                  type="button"
                                  className="text-xs text-slate-700 hover:underline"
                                  onClick={async () => {
                                    if (!businessId) return;
                                    const res: any = await apiFetch(`/v1/businesses/${businessId}/uploads/${u.id}/download`, { method: "GET" });
                                    const url = res?.download?.url;
                                    if (url) window.open(url, "_blank", "noopener,noreferrer");
                                  }}
                                >
                                  View / Download
                                </button>

                                {canRetryParse ? (
                                  <button
                                    type="button"
                                    className="text-xs text-slate-700 hover:underline"
                                    onClick={async () => {
                                      if (!businessId) return;
                                      try {
                                        setErr(null);
                                        await apiFetch(`/v1/businesses/${businessId}/uploads/complete`, {
                                          method: "POST",
                                          body: JSON.stringify({ uploadId: u.id }),
                                        });
                                        await refresh();
                                        window.dispatchEvent(new CustomEvent("bynk:vendors-refresh"));
                                      } catch (e: any) {
                                        setErr(appErrorMessageOrNull(e) ?? "Retry parse failed.");
                                      }
                                    }}
                                    title="Retry invoice parse and bill creation"
                                  >
                                    Retry parse
                                  </button>
                                ) : null}

                                {!meta?.bill_id ? (
                                  <button
                                    type="button"
                                    className="text-xs text-slate-700 hover:underline"
                                    onClick={() => {
                                      setErr(null);
                                      setErrIsClosed(false);
                                      setBillEditId(null);
                                      setBillSourceUpload(u);
                                      setBillDialogOpen(true);
                                    }}
                                    title="Create bill from this uploaded invoice"
                                  >
                                    Create bill
                                  </button>
                                ) : null}

                                <button
                                  type="button"
                                  className="text-xs text-red-700 hover:underline"
                                  onClick={async () => {
                                    if (!businessId) return;
                                    try {
                                      await apiFetch(`/v1/businesses/${businessId}/uploads/${u.id}/delete`, { method: "POST" });
                                      setInvoiceUploads((prev) => prev.filter((x: any) => x.id !== u.id));
                                      window.dispatchEvent(new CustomEvent("bynk:vendors-refresh"));
                                    } catch (e: any) {
                                      setErr(appErrorMessageOrNull(e) ?? "Delete failed.");
                                    }
                                  }}
                                  title="Soft delete (blocked if referenced by bill or entry)"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </div>
      </Card>

        <UploadPanel
          open={openUpload}
          onClose={() => setOpenUpload(false)}
          type="INVOICE"
          ctx={{ businessId: businessId ?? undefined, vendorId } as any}
          allowMultiple={true}
        />

        <AppDialog
          open={billDialogOpen}
          onClose={() => {
            setBillDialogOpen(false);
            setBillEditId(null);
            setBillSourceUpload(null);
          }}
          title={billEditId ? "Edit bill" : billSourceUpload ? "Create bill from upload" : "New bill"}
          size="sm"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => {
                  setBillDialogOpen(false);
                  setBillEditId(null);
                  setBillSourceUpload(null);
                }}
                disabled={loading}
              >
                Cancel
              </Button>

              <Button
                className="h-7 px-3 text-xs"
                disabled={
                  loading ||
                  !businessId ||
                  !vendorId ||
                  !billInvoiceDate ||
                  !billDueDate ||
                  !String(billAmount || "").trim()
                }
                onClick={async () => {
                  if (!businessId || !vendorId) return;

                  setErr(null);
                  setErrIsClosed(false);

                  const amtNum = Number(String(billAmount).trim());
                  if (!Number.isFinite(amtNum) || amtNum <= 0) {
                    setErr("Enter a valid amount.");
                    return;
                  }
                  const amount_cents = Math.round(amtNum * 100);

                  // EDIT: optimistic patch the single bill row immediately (safe) + row-snapshot rollback on error
                  const editingId = billEditId ? String(billEditId) : null;
                  const prevBill = editingId ? bills.find((x: any) => String(x.id) === editingId) ?? null : null;

                  if (editingId && prevBill) {
                    markBillPending(editingId);

                    setBills((prev) =>
                      prev.map((x: any) =>
                        String(x.id) === editingId
                          ? {
                            ...x,
                            invoice_date: billInvoiceDate,
                            due_date: billDueDate,
                            amount_cents,
                            memo: billMemo,
                            terms: billTerms,
                          }
                          : x
                      )
                    );
                  }

                  let loadingToken = 0;
                  try {
                    loadingToken = beginLoading();

                    if (editingId) {
                      const res: any = await updateBill({
                        businessId,
                        vendorId,
                        billId: editingId,
                        invoice_date: billInvoiceDate,
                        due_date: billDueDate,
                        amount_cents,
                        memo: billMemo,
                        terms: billTerms,
                      });

                      const updated = res?.bill ?? null;
                      if (updated?.id) {
                        setBills((prev) =>
                          prev.map((x: any) => (String(x.id) === String(updated.id) ? { ...x, ...updated } : x))
                        );
                      }
                    } else {
                      const res: any = await createBill({
                        businessId,
                        vendorId,
                        invoice_date: billInvoiceDate,
                        due_date: billDueDate,
                        amount_cents,
                        memo: billMemo,
                        terms: billTerms,
                        upload_id: billSourceUpload?.id ? String(billSourceUpload.id) : undefined,
                      });

                      const created = res?.bill ?? null;
                      if (created?.id) {
                        setBills((prev) => [created, ...prev]);
                      }
                    }

                    const sumRes: any = await getVendorApSummary({ businessId, vendorId, asOf: todayYmd() });
                    setApSummary(sumRes?.summary ?? null);

                    await refresh();
                    window.dispatchEvent(new CustomEvent("bynk:vendors-refresh"));

                    setBillDialogOpen(false);
                    setBillEditId(null);
                    setBillSourceUpload(null);
                  } catch (e: any) {
                    // rollback only the edited row
                    if (editingId && prevBill) {
                      setBills((prev) => prev.map((x: any) => (String(x.id) === editingId ? { ...x, ...prevBill } : x)));
                    }

                    const msg = appErrorMessageOrNull(e) ?? e?.message ?? "Save bill failed";
                    setErr(msg);
                    setErrIsClosed(isClosedPeriodError(e, msg));
                  } finally {
                    if (editingId) clearBillPending(editingId);
                    endLoading(loadingToken);
                  }
                }}
              >
                {billEditId ? "Save" : "Create"}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">Invoice date</div>
                <AppDatePicker
                  value={billInvoiceDate}
                  onChange={setBillInvoiceDate}
                  ariaLabel="Invoice date"
                />
              </div>

              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">Due date</div>
                <AppDatePicker
                  value={billDueDate}
                  onChange={setBillDueDate}
                  ariaLabel="Due date"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] text-slate-600">Amount</div>
              <input
                className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                inputMode="decimal"
                placeholder="0.00"
                value={billAmount}
                onChange={(e) => setBillAmount(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="text-[11px] text-slate-600">Memo (optional)</div>
              <input
                className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                value={billMemo}
                onChange={(e) => setBillMemo(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="text-[11px] text-slate-600">Terms (optional)</div>
              <input
                className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                value={billTerms}
                onChange={(e) => setBillTerms(e.target.value)}
              />
            </div>

            {err ? <div className="text-xs text-red-600">{err}</div> : null}
          </div>
        </AppDialog>

        <AppDialog
          open={vendorPayOpen}
          onClose={() => setVendorPayOpen(false)}
          title="Apply vendor payment"
          size="sm"
          footer={
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-600">
                Vendor: <span className="font-medium">{vendor?.name ?? "—"}</span>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" className="h-7 px-3 text-xs" onClick={() => setVendorPayOpen(false)}>
                  Close
                </Button>

                <Button
                  className="h-7 px-3 text-xs"
                  disabled={!businessId || !vendorPayAccountId || !vendorPayAmount.trim()}
                  onClick={async () => {
                    if (!businessId || !vendorPayAccountId) return;

                    setErr(null);

                    const amt = Number(vendorPayAmount);
                    if (!Number.isFinite(amt) || amt <= 0) {
                      setErr("Enter a valid amount.");
                      return;
                    }

                    const openBills = bills.filter((b: any) => String(b.status) === "OPEN" || String(b.status) === "PARTIAL");
                    const totalCents = BigInt(Math.round(amt * 100));

                    // Build apps from applyAmounts map (works for both auto and manual)
                    const apps: Array<{ bill_id: string; applied_amount_cents: number }> = [];
                    let appliedTotal = 0n;

                    for (const b of openBills) {
                      const key = String(b.id);
                      const raw = (applyAmounts[key] || "").trim();
                      if (!raw) continue;

                      const n = Number(raw);
                      if (!Number.isFinite(n) || n <= 0) continue;

                      const cents = BigInt(Math.round(n * 100));
                      if (cents <= 0n) continue;

                      const out = centsFromAny(b.outstanding_cents);
                      if (cents > out) {
                        setErr("One or more allocations exceed the bill outstanding amount.");
                        return;
                      }

                      appliedTotal += cents;
                      apps.push({ bill_id: key, applied_amount_cents: Number(cents) });
                    }

                    if (appliedTotal > totalCents) {
                      setErr("Total applied exceeds payment amount.");
                      return;
                    }

                    try {
                      // 1) Create payment entry (backend sets entry_kind=VENDOR_PAYMENT + category Purchase)
                      const created: any = await apiFetch(`/v1/businesses/${businessId}/vendors/${vendorId}/payments`, {
                        method: "POST",
                        body: JSON.stringify({
                          account_id: vendorPayAccountId,
                          date: vendorPayDate,
                          amount_cents: Number(totalCents),
                          memo: vendorPayMemo,
                          method: vendorPayMethod,
                        }),
                      });

                      const entryId = String(created?.entry_id ?? "");
                      if (!entryId) throw new Error("Payment entry not created");

                      // 2) Apply allocations if any (advance payment = remainder)
                      let applyRes: any = null;

                      if (apps.length) {
                        applyRes = await applyVendorPayment({
                          businessId,
                          accountId: vendorPayAccountId,
                          entryId,
                          applications: apps,
                        });
                      }

                      if (applyRes?.updated_bills && Array.isArray(applyRes.updated_bills)) {
                        const byId = new Map(applyRes.updated_bills.map((x: any) => [String(x.id), x]));
                        setBills((prev) =>
                          prev.map((b: any) => {
                            const hit = byId.get(String(b.id));
                            return hit ? { ...b, ...hit } : b;
                          })
                        );
                      }

                      // Minimal refresh: update payments list only
                      try {
                        const payRes: any = await apiFetchWithRetry(
                          `/v1/businesses/${businessId}/vendors/${vendorId}/ap/payments-summary?limit=200`,
                          { method: "GET" },
                          1
                        );
                        setVendorPayments(Array.isArray(payRes?.payments) ? payRes.payments : []);
                      } catch {
                        // keep existing list if transient
                      }

                      window.dispatchEvent(new CustomEvent("bynk:vendors-refresh"));

                      // reset dialog state
                      setVendorPayAmount("");
                      setApplyAmounts({});
                      setVendorPayOpen(false);
                    } catch (e: any) {
                      setErr(e?.message ?? "Apply failed");
                    }
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">From account</div>
                <select
                  className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                  value={vendorPayAccountId ?? ""}
                  onChange={(e) => setVendorPayAccountId(e.target.value || null)}
                >
                  <option value="">Select account…</option>
                  {(accountsQ.data ?? []).filter((a: any) => !a.archived_at).map((a: any) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">Date</div>
                  <AppDatePicker
                    value={vendorPayDate}
                    onChange={setVendorPayDate}
                    ariaLabel="Payment date"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">Amount</div>
                  <input
                    className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={vendorPayAmount}
                    onChange={(e) => {
                      const v = e.target.value;
                      setVendorPayAmount(v);

                      if (!vendorPayAutoApply) return;

                      const n = Number(v);
                      if (!Number.isFinite(n) || n <= 0) {
                        setApplyAmounts({});
                        return;
                      }

                      const totalCents = BigInt(Math.round(n * 100));
                      const { map } = computeAutoAllocationMap(totalCents);
                      setApplyAmounts(map);
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">Method</div>
                <select
                  className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                  value={vendorPayMethod}
                  onChange={(e) => setVendorPayMethod(e.target.value)}
                >
                  <option value="OTHER">Other</option>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="ACH">ACH</option>
                  <option value="CHECK">Check</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">Memo (optional)</div>
                <input
                  className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                  value={vendorPayMemo}
                  onChange={(e) => setVendorPayMemo(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-900">Allocate to open bills</div>
                  <div className="text-[11px] text-slate-600">Auto-apply or enter amounts per bill.</div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 whitespace-nowrap">Auto-apply oldest first</span>
                  <PillToggle
                    checked={vendorPayAutoApply}
                    onCheckedChange={(on) => {
                      setVendorPayAutoApply(on);

                      if (!on) return;

                      const n = Number(vendorPayAmount);
                      if (!Number.isFinite(n) || n <= 0) {
                        setApplyAmounts({});
                        return;
                      }

                      const totalCents = BigInt(Math.round(n * 100));
                      const { map } = computeAutoAllocationMap(totalCents);
                      setApplyAmounts(map);
                    }}
                  />
                </div>
              </div>

              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white border-b border-slate-200">
                    <tr className="h-9">
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Invoice</th>
                      <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Outstanding</th>
                      <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Apply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.filter((b: any) => String(b.status) === "OPEN" || String(b.status) === "PARTIAL").length === 0 ? (
                      <tr><td className="px-3 py-4 text-sm text-slate-600" colSpan={3}>No open bills.</td></tr>
                    ) : (
                      bills
                        .filter((b: any) => String(b.status) === "OPEN" || String(b.status) === "PARTIAL")
                        .map((b: any) => (
                          <tr key={b.id} className="h-9 border-b border-slate-100">
                            <td className="px-3 text-sm tabular-nums">
                              {String(b.invoice_date ?? "").slice(0, 10)}{" "}
                              <span className="text-xs text-slate-500">({b.memo ?? "—"})</span>
                            </td>
                            <td className="px-3 text-right text-sm tabular-nums font-semibold">
                              {formatUsdFromCents(centsFromAny(b.outstanding_cents))}
                            </td>
                            <td className="px-3 text-right">
                              <input
                                className="h-7 w-[120px] text-right text-xs rounded-md border border-slate-200 bg-white px-2 tabular-nums disabled:bg-slate-50"
                                placeholder="0.00"
                                value={applyAmounts[String(b.id)] ?? ""}
                                onChange={(e) => setApplyAmounts((m) => ({ ...m, [String(b.id)]: e.target.value }))}
                                disabled={vendorPayAutoApply}
                              />
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-3 py-2 border-t border-slate-200 bg-white text-xs">
                {(() => {
                  const amt = Number(vendorPayAmount);
                  const totalCents = Number.isFinite(amt) && amt > 0 ? BigInt(Math.round(amt * 100)) : 0n;

                  const openBills = bills.filter((b: any) => String(b.status) === "OPEN" || String(b.status) === "PARTIAL");

                  let applied = 0n;
                  for (const b of openBills) {
                    const raw = (applyAmounts[String(b.id)] || "").trim();
                    if (!raw) continue;
                    const n = Number(raw);
                    if (!Number.isFinite(n) || n <= 0) continue;
                    applied += BigInt(Math.round(n * 100));
                  }

                  const remaining = totalCents - applied;
                  const advance = remaining > 0n ? remaining : 0n;

                  return (
                    <div className="flex items-center justify-between">
                      <div className="text-slate-600">
                        Total applied: <span className="font-semibold tabular-nums">{formatUsdFromCents(applied)}</span>
                        {" "}• Payment: <span className="font-semibold tabular-nums">{formatUsdFromCents(totalCents)}</span>
                        {" "}• Advance: <span className="font-semibold tabular-nums">{formatUsdFromCents(advance)}</span>
                      </div>
                      {remaining < 0n ? <div className="text-red-700">Over-applied.</div> : null}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </AppDialog>

        <AppDialog
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          title="Apply payment"
          size="sm"
          footer={
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-600">
                Vendor: <span className="font-medium">{vendor?.name ?? "—"}</span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  onClick={() => setApplyOpen(false)}
                >
                  Close
                </Button>

                <Button
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  disabled={applyActionLoading || !businessId || !applyAccountId || !paymentEntryId}
                  onClick={async () => {
                    if (!businessId || !applyAccountId || !paymentEntryId) return;

                    setErr(null);
                    setErrIsClosed(false);

                    setApplyActionLoading(true);
                    markPaymentPending(String(paymentEntryId), "UNAPPLYING");

                    try {
                      await unapplyVendorPayment({
                        businessId,
                        accountId: applyAccountId,
                        entryId: paymentEntryId,
                        all: true,
                        reason: "User unapply all",
                      });
                      await refresh();
                    } catch (e: any) {
                      const msg = appErrorMessageOrNull(e) ?? e?.message ?? "Unapply failed";
                      setErr(msg);
                      setErrIsClosed(isClosedPeriodError(e, msg));
                    } finally {
                      clearPaymentPending(String(paymentEntryId));
                      setApplyActionLoading(false);
                    }
                  }}
                  title="Auditable unapply of all allocations for this payment"
                >
                  Unapply all
                </Button>

                <Button
                  variant="outline"
                  className="h-7 px-3 text-xs text-red-700 border-red-200 hover:bg-red-50"
                  disabled={applyActionLoading || !businessId || !applyAccountId || !paymentEntryId}
                  onClick={async () => {
                    if (!businessId || !applyAccountId || !paymentEntryId) return;

                    setErr(null);
                    setErrIsClosed(false);

                    setApplyActionLoading(true);
                    markPaymentPending(String(paymentEntryId), "UNAPPLYING");

                    try {
                      await apiFetch(
                        `/v1/businesses/${businessId}/accounts/${applyAccountId}/entries/${paymentEntryId}/ap/unapply-and-delete`,
                        { method: "POST", body: JSON.stringify({ reason: "Unapply all and delete payment" }) }
                      );
                      await refresh();
                      window.dispatchEvent(new CustomEvent("bynk:vendors-refresh"));
                      setApplyOpen(false);
                    } catch (e: any) {
                      const msg = appErrorMessageOrNull(e) ?? e?.message ?? "Unapply+delete failed";
                      setErr(msg);
                      setErrIsClosed(isClosedPeriodError(e, msg));
                    } finally {
                      clearPaymentPending(String(paymentEntryId));
                      setApplyActionLoading(false);
                    }
                  }}
                  title="Explicit action: unapply all allocations then soft delete the payment entry"
                >
                  Unapply+Delete payment
                </Button>

                <Button
                  className="h-7 px-3 text-xs"
                  disabled={(() => {
                    if (applyActionLoading) return true;
                    if (!businessId || !applyAccountId || !paymentEntryId) return true;

                    const entry = [...paymentEntries, ...suggestedEntries].find((e: any) => String(e.id) === String(paymentEntryId));
                    if (!entry) return true;

                    const entryAbs = absBigint(centsFromAny(entry.amount_cents));
                    let total = 0n;

                    for (const b of bills) {
                      const key = String(b.id);
                      const raw = (applyAmounts[key] || "").trim();
                      if (!raw) continue;

                      const n = Number(raw);
                      if (!Number.isFinite(n) || n <= 0) return true;

                      const cents = BigInt(Math.round(n * 100));
                      const outstanding = centsFromAny(b.outstanding_cents);
                      if (cents > outstanding) return true;

                      total += cents;
                    }

                    if (total <= 0n) return true;
                    if (total > entryAbs) return true;

                    return false;
                  })()}
                  onClick={async () => {
                    if (!businessId || !applyAccountId || !paymentEntryId) return;

                    const entry = [...paymentEntries, ...suggestedEntries].find((e: any) => String(e.id) === String(paymentEntryId));
                    if (!entry) return;

                    setErr(null);
                    setErrIsClosed(false);

                    const apps: Array<{ bill_id: string; applied_amount_cents: number }> = [];

                    for (const b of bills) {
                      const key = String(b.id);
                      const raw = (applyAmounts[key] || "").trim();
                      if (!raw) continue;

                      const n = Number(raw);
                      if (!Number.isFinite(n) || n <= 0) continue;

                      const cents = Math.round(n * 100);
                      if (cents <= 0) continue;

                      apps.push({ bill_id: key, applied_amount_cents: cents });
                    }

                    setApplyActionLoading(true);
                    markPaymentPending(String(paymentEntryId), "APPLYING");

                    try {
                      await applyVendorPayment({
                        businessId,
                        accountId: applyAccountId,
                        entryId: paymentEntryId,
                        applications: apps,
                      });

                      // Deterministic UI update: refresh is coalesced + epoch-guarded and does not empty-clear.
                      await refresh();
                      setApplyOpen(false);
                    } catch (e: any) {
                      const msg = appErrorMessageOrNull(e) ?? e?.message ?? "Apply failed";
                      setErr(msg);
                      setErrIsClosed(isClosedPeriodError(e, msg));
                    } finally {
                      clearPaymentPending(String(paymentEntryId));
                      setApplyActionLoading(false);
                    }
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">Account</div>
                <select
                  className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                  value={applyAccountId ?? ""}
                  onChange={(e) => setApplyAccountId(e.target.value || null)}
                >
                  {(accountsQ.data ?? []).map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">Payment</div>
                <select
                  className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                  value={paymentEntryId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    setPaymentEntryId(id);
                    setApplyAmounts({});
                  }}
                >
                  <option value="">Select payment…</option>

                  {paymentEntries.length ? (
                    <optgroup label="Linked payments">
                      {paymentEntries.map((e: any) => (
                        <option key={e.id} value={e.id}>
                          {String(e.date ?? "").slice(0, 10)} — {e.payee} — {e.amountStr ?? ""}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}

                  {suggestedEntries.length ? (
                    <optgroup label="Suggested (unlinked)">
                      {suggestedEntries.map((e: any) => (
                        <option key={e.id} value={e.id}>
                          {String(e.date ?? "").slice(0, 10)} — {e.payee} — {e.amountStr ?? ""} (suggested)
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>

                {(() => {
                  const entry = [...paymentEntries, ...suggestedEntries].find((e: any) => String(e.id) === String(paymentEntryId));
                  if (!entry) return null;

                  const linked = String(entry.vendor_id || "") === vendorId;
                  if (linked) return null;

                  return (
                    <div className="mt-1">
                      <Button
                        variant="outline"
                        className="h-7 px-3 text-xs"
                        onClick={async () => {
                          if (!businessId || !applyAccountId || !paymentEntryId) return;
                          try {
                            // Link entry to this vendor using existing entryUpdate endpoint
                            await apiFetch(`/v1/businesses/${businessId}/accounts/${applyAccountId}/entries/${paymentEntryId}`, {
                              method: "PATCH",
                              body: JSON.stringify({ vendor_id: vendorId }),
                            });

                            // refresh payment lists
                            await refresh();
                          } catch (e: any) {
                            setErr(e?.message ?? "Link vendor failed");
                          }
                        }}
                        title="Link this payment entry to this vendor (required for apply)"
                      >
                        Link entry to vendor
                      </Button>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
                <div className="text-xs font-semibold text-slate-900">Allocate to open bills</div>
                <div className="text-[11px] text-slate-600">Enter amounts to apply per bill (USD).</div>
              </div>

              <div className="max-h-[360px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white border-b border-slate-200">
                    <tr className="h-9">
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Invoice</th>
                      <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Outstanding</th>
                      <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Apply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.filter((b: any) => String(b.status) === "OPEN" || String(b.status) === "PARTIAL").length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-sm text-slate-600" colSpan={3}>No open bills.</td>
                      </tr>
                    ) : (
                      bills
                        .filter((b: any) => String(b.status) === "OPEN" || String(b.status) === "PARTIAL")
                        .map((b: any) => {
                          const outstanding = centsFromAny(b.outstanding_cents);
                          const key = String(b.id);

                          return (
                            <tr key={b.id} className="h-9 border-b border-slate-100">
                              <td className="px-3 text-sm tabular-nums">
                                {String(b.invoice_date ?? "").slice(0, 10)}{" "}
                                <span className="text-xs text-slate-500">({b.memo ?? "—"})</span>
                              </td>
                              <td className="px-3 text-right text-sm tabular-nums font-semibold">
                                {formatUsdFromCents(outstanding)}
                              </td>
                              <td className="px-3 text-right">
                                <input
                                  className="h-7 w-[120px] text-right text-xs rounded-md border border-slate-200 bg-white px-2 tabular-nums"
                                  placeholder="0.00"
                                  value={applyAmounts[key] ?? ""}
                                  onChange={(e) => setApplyAmounts((m) => ({ ...m, [key]: e.target.value }))}
                                />
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-3 py-2 border-t border-slate-200 bg-white">
                {(() => {
                  const entry = [...paymentEntries, ...suggestedEntries].find((e: any) => String(e.id) === String(paymentEntryId));
                  const entryAbs = entry ? absBigint(centsFromAny(entry.amount_cents)) : 0n;

                  let total = 0n;
                  let invalid = false;

                  for (const b of bills) {
                    const key = String(b.id);
                    const raw = (applyAmounts[key] || "").trim();
                    if (!raw) continue;
                    const n = Number(raw);
                    if (!Number.isFinite(n) || n < 0) { invalid = true; continue; }

                    const cents = BigInt(Math.round(n * 100));
                    const outstanding = centsFromAny(b.outstanding_cents);
                    if (cents > outstanding) invalid = true;
                    total += cents;
                  }

                  const remaining = entryAbs - total;

                  return (
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-slate-600">
                        Total applied: <span className="font-semibold tabular-nums">{formatUsdFromCents(total)}</span>
                        {entry ? (
                          <>
                            {" "}• Payment amount: <span className="font-semibold tabular-nums">{formatUsdFromCents(entryAbs)}</span>
                            {" "}• Remaining:{" "}
                            <span className={"font-semibold tabular-nums " + (remaining < 0n ? "text-red-700" : "text-slate-900")}>
                              {formatUsdFromCents(remaining)}
                            </span>
                          </>
                        ) : null}
                      </div>

                      {invalid || remaining < 0n ? (
                        <div className="text-xs text-red-700">Fix allocation amounts (over-applied).</div>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </AppDialog>

        <AppDialog
          open={statementOpen}
          onClose={() => setStatementOpen(false)}
          title="Download vendor statement"
          size="sm"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => setStatementOpen(false)}
              >
                Cancel
              </Button>

              <Button
                className="h-7 px-3 text-xs"
                disabled={!businessId || !statementFrom || !statementTo}
                onClick={async () => {
                  if (!businessId) return;

                  const from = statementPreset === "custom" ? statementFrom : presetRange(statementPreset).from;
                  const to = statementPreset === "custom" ? statementTo : presetRange(statementPreset).to;

                  try {
                    const qs = new URLSearchParams();
                    qs.set("from", from);
                    qs.set("to", to);

                    // Use apiFetch so Authorization is included (avoids localhost 404 + auth issues)
                    const csvText: any = await apiFetch(
                      `/v1/businesses/${businessId}/vendors/${vendorId}/ap/statement.csv?${qs.toString()}`,
                      { method: "GET" }
                    );

                    // apiFetch may return parsed JSON normally; for CSV we expect raw text.
                    // If apiFetch auto-parses JSON, it should return a string for text/csv.
                    const blob = new Blob([typeof csvText === "string" ? csvText : String(csvText)], { type: "text/csv;charset=utf-8" });

                    const a = document.createElement("a");
                    const url = URL.createObjectURL(blob);
                    a.href = url;
                    a.download = `vendor-statement-${vendorId}-${from}-to-${to}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);

                    setStatementOpen(false);
                  } catch (e: any) {
                    setErr(e?.message ?? "Download failed");
                  }
                }}
              >
                Download
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-[11px] text-slate-600">Range</div>
              <select
                className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                value={statementPreset}
                onChange={(e) => {
                  const v = e.target.value as any;
                  setStatementPreset(v);
                  const r = presetRange(v);
                  if (v !== "custom") {
                    setStatementFrom(r.from);
                    setStatementTo(r.to);
                  }
                }}
              >
                <option value="this_week">This week</option>
                <option value="last_week">Last week</option>
                <option value="this_month">This month</option>
                <option value="last_month">Last month</option>
                <option value="this_year">This year</option>
                <option value="last_year">Last year</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">From</div>
                <AppDatePicker
                  value={statementFrom}
                  onChange={setStatementFrom}
                  ariaLabel="Statement from"
                  disabled={statementPreset !== "custom"}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">To</div>
                <AppDatePicker
                  value={statementTo}
                  onChange={setStatementTo}
                  ariaLabel="Statement to"
                  disabled={statementPreset !== "custom"}
                />
              </div>
            </div>

            <div className="text-xs text-slate-500">
              CSV includes bills and applied totals for the selected range.
            </div>
          </div>
        </AppDialog>

        <AppDialog
          open={deleteOpen}
          onClose={() => {
            if (deleteBusy) return;
            setDeleteOpen(false);
            setDeleteErr(null);
            setDeleteConfirm("");
          }}
          title="Delete vendor"
          size="sm"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                className="h-7 px-3 text-xs"
                disabled={deleteBusy}
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteErr(null);
                  setDeleteConfirm("");
                }}
              >
                Cancel
              </Button>

              <Button
                className="h-7 px-3 text-xs bg-rose-600 hover:bg-rose-700"
                disabled={deleteBusy || deleteConfirm.trim().toUpperCase() !== "DELETE" || !businessId || !vendorId}
                onClick={async () => {
                  if (!businessId || !vendorId) return;
                  setDeleteBusy(true);
                  setDeleteErr(null);

                  try {
                    await deleteVendor({ businessId, vendorId });
                    window.dispatchEvent(new CustomEvent("bynk:vendors-refresh"));
                    setDeleteOpen(false);
                    setDeleteConfirm("");
                    router.push(`/vendors?businessId=${encodeURIComponent(businessId)}`);
                  } catch (e: any) {
                    setDeleteErr(vendorDeleteMessage(e));
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
              >
                {deleteBusy ? "Deleting…" : "Delete vendor"}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-sm text-slate-700">
            <div className="font-medium text-slate-900">{vendor?.name || "This vendor"}</div>
            <div className="text-xs text-slate-600">
              Delete only works when this vendor has no linked bills, ledger entries, or invoice uploads.
            </div>

            <div className="space-y-1">
              <div className="text-[11px] text-slate-600">Type DELETE to continue</div>
              <Input
                className="h-8 text-xs"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="DELETE"
                autoFocus
              />
            </div>

            {deleteErr ? <div className="text-xs text-red-600">{deleteErr}</div> : null}
          </div>
        </AppDialog>

        <AppDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          title="Edit vendor"
          size="xs"
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

            <div className="space-y-1">
              <div className="text-[11px] text-slate-600">Default category</div>
              <select
                className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
                value={defaultCategoryId}
                onChange={(e) => setDefaultCategoryId(e.target.value)}
              >
                <option value="">None</option>
                {categoryRows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </AppDialog>

              <AppDialog
        open={voidBillOpen}
        onClose={() => {
          if (applyActionLoading) return;
          setVoidBillOpen(false);
          setVoidBillId(null);
          setBillVoidReason("");
        }}
        title="Void bill"
        size="xs"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setVoidBillOpen(false);
                setVoidBillId(null);
                setBillVoidReason("");
              }}
              disabled={applyActionLoading}
            >
              Cancel
            </Button>

            <BusyButton
              variant="danger"
              size="md"
              busy={!!(voidBillId && pendingBillById[String(voidBillId)])}
              busyLabel="Voiding…"
              disabled={!voidBillId}
              onClick={async () => {
                if (!businessId || !voidBillId) return;

                setErr(null);
                setErrIsClosed(false);

                const billId = String(voidBillId);
                const prevBill = bills.find((x: any) => String(x.id) === billId);

                markBillPending(billId);

                setBills((prev) =>
                  prev.map((x: any) => (String(x.id) === billId ? { ...x, status: "VOID" } : x))
                );

                try {
                  await voidBill({ businessId, vendorId, billId, reason: billVoidReason.trim() || undefined } as any);

                  const sumRes: any = await getVendorApSummary({ businessId, vendorId, asOf: todayYmd() });
                  setApSummary(sumRes?.summary ?? null);

                  setVoidBillOpen(false);
                  setVoidBillId(null);
                  setBillVoidReason("");
                } catch (e: any) {
                  if (prevBill) {
                    setBills((prev) =>
                      prev.map((x: any) => (String(x.id) === billId ? { ...x, ...prevBill } : x))
                    );
                  }

                  const msg = appErrorMessageOrNull(e) ?? e?.message ?? "Void failed";
                  setErr(msg);
                  setErrIsClosed(isClosedPeriodError(e, msg));
                } finally {
                  clearBillPending(billId);
                }
              }}
            >
              Void bill
            </BusyButton>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="text-sm text-slate-700">
            This will void the bill and preserve its audit history.
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Reason (optional)</label>
            <Input
              value={billVoidReason}
              onChange={(e) => setBillVoidReason(e.target.value)}
              placeholder="Why are you voiding this bill?"
            />
          </div>
        </div>
      </AppDialog>

      </div>
    </div>
  );
}
