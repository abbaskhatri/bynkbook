"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2 } from "lucide-react";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { getVendor, updateVendor } from "@/lib/api/vendors";
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

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [vendor, setVendor] = useState<any>(null);

  const [bills, setBills] = useState<any[]>([]);
  const [apSummary, setApSummary] = useState<any>(null);

  const [highlightBillId, setHighlightBillId] = useState<string | null>(null);

  const [apTab, setApTab] = useState<"bills" | "payments">("bills");
  const [vendorPayments, setVendorPayments] = useState<any[]>([]);
  const [paymentsErr, setPaymentsErr] = useState<string | null>(null);

  // Vendor credit (derived from payments-summary totals.total_unapplied_cents)
  const [vendorCreditCents, setVendorCreditCents] = useState<bigint>(0n);

  // Apply credit flow (guardrail: do not preselect payment without known account context)
  const [creditApplyCandidateEntryId, setCreditApplyCandidateEntryId] = useState<string | null>(null);
  const [creditApplyRequested, setCreditApplyRequested] = useState(false);

  const [billsLoading, setBillsLoading] = useState(false);

  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [billEditId, setBillEditId] = useState<string | null>(null);
  const [billInvoiceDate, setBillInvoiceDate] = useState(todayYmd());
  const [billDueDate, setBillDueDate] = useState(todayYmd());
  const [billAmount, setBillAmount] = useState("");
  const [billMemo, setBillMemo] = useState("");
  const [billTerms, setBillTerms] = useState("");
  const [billVoidReason, setBillVoidReason] = useState("");

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
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  const [openUpload, setOpenUpload] = useState(false);

  const [invoiceUploads, setInvoiceUploads] = useState<any[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);

  // Statement dialog
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementPreset, setStatementPreset] = useState<
    "this_week" | "last_week" | "this_month" | "last_month" | "this_year" | "last_year" | "custom"
  >("this_month");
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");


  async function refresh() {
    if (!businessId || !vendorId) return;
    setLoading(true);
    setErr(null);
    try {
      const [vRes, billsRes, sumRes, uploadsRes, payRes] = await Promise.all([
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
      ]);

      setVendor(vRes.vendor);
      setName(String(vRes.vendor?.name ?? ""));
      setNotes(String(vRes.vendor?.notes ?? ""));

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
      setErr(e?.message ?? "Failed to load vendor");
    } finally {
      setLoading(false);
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

  useEffect(() => {
    if (businessId && vendorId && !vendor && !loading && !err) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, vendorId]);

  // Prefill bill dialog when editing
  useEffect(() => {
    if (!billDialogOpen) return;

    if (!billEditId) {
      // New bill defaults
      setBillInvoiceDate(todayYmd());
      setBillDueDate(todayYmd());
      setBillAmount("");
      setBillMemo("");
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
  }, [billDialogOpen, billEditId, bills]);

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
                  className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                  onClick={() => {
                    if (!businessId) return;
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
                  disabled={!businessId}
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
                <div className="rounded-lg border border-slate-200 bg-emerald-50 px-3 py-2 flex items-center justify-between">
                  <div className="text-xs text-emerald-800">
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
                      <tr>
                        <td className="px-3 py-4 text-sm text-slate-600" colSpan={8}>
                          {billsLoading ? "Loading…" : "No bills yet."}
                        </td>
                      </tr>
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
                              (highlightBillId === String(b.id) ? "bg-emerald-50" : "")
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
                                      ? "bg-emerald-50 text-emerald-700"
                                      : "bg-amber-50 text-amber-700")
                                }
                              >
                                {st}
                              </span>
                            </td>
                            <td className="px-3 text-right">
                              <div className="inline-flex items-center gap-2">
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
                                  disabled={!canWrite || isVoid}
                                  onClick={() => voidBill({ businessId: businessId!, vendorId, billId: String(b.id) })}
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
                          {paymentsErr}
                        </td>
                      </tr>
                    ) : vendorPayments.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-sm text-slate-600" colSpan={4}>
                          No vendor-linked payments yet.
                        </td>
                      </tr>
                    ) : (
                      vendorPayments.map((p: any) => (
                        <tr key={String(p.entry_id ?? p.id ?? "")} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-3 text-sm tabular-nums">{String(p.date ?? "").slice(0, 10)}</td>
                          <td className="px-3 text-sm">{p.payee}</td>
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
                                className="text-xs text-slate-700 hover:underline"
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
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">

        <Card>

          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Invoice uploads</CardTitle>
          </CardHeader>

          <CardContent>
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                    <tr className="h-9">
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">File</th>
                      <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Date</th>
                      <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceUploads.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-sm text-slate-600" colSpan={3}>
                          No uploads yet.
                        </td>
                      </tr>
                    ) : (
                      invoiceUploads.map((u: any) => (
                        <tr key={u.id} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-3 text-sm">{u.original_filename}</td>
                          <td className="px-3 text-sm text-slate-600">{String(u.created_at ?? "").slice(0, 10)}</td>
                          <td className="px-3 text-right">
                            <div className="inline-flex items-center gap-2">
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

                              <button
                                type="button"
                                className="text-xs text-red-700 hover:underline"
                                onClick={async () => {
                                  if (!businessId) return;
                                  try {
                                    await apiFetch(`/v1/businesses/${businessId}/uploads/${u.id}/delete`, { method: "POST" });
                                    // instant removal in UI
                                    setInvoiceUploads((prev) => prev.filter((x: any) => x.id !== u.id));
                                    window.dispatchEvent(new CustomEvent("bynk:vendors-refresh"));
                                  } catch (e: any) {
                                    setErr(e?.message ?? "Delete failed");
                                  }
                                }}
                                title="Soft delete (blocked if referenced by bill/entry)"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
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
          onClose={() => { setBillDialogOpen(false); setBillEditId(null); }}
          title={billEditId ? "Edit bill" : "New bill"}
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => { setBillDialogOpen(false); setBillEditId(null); }}
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

                  const amtNum = Number(String(billAmount).trim());
                  if (!Number.isFinite(amtNum) || amtNum <= 0) {
                    setErr("Enter a valid amount.");
                    return;
                  }
                  const amount_cents = Math.round(amtNum * 100);

                  try {
                    setLoading(true);

                    if (billEditId) {
                      const res: any = await updateBill({
                        businessId,
                        vendorId,
                        billId: billEditId,
                        invoice_date: billInvoiceDate,
                        due_date: billDueDate,
                        amount_cents,
                        memo: billMemo,
                        terms: billTerms,
                      });

                      const updated = res?.bill ?? null;
                      if (updated?.id) {
                        setBills((prev) => prev.map((b: any) => (String(b.id) === String(updated.id) ? { ...b, ...updated } : b)));
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
                      });

                      const created = res?.bill ?? null;
                      if (created?.id) {
                        setBills((prev) => [created, ...prev]);
                      }
                    }

                    const sumRes: any = await getVendorApSummary({ businessId, vendorId, asOf: todayYmd() });
                    setApSummary(sumRes?.summary ?? null);

                    setBillDialogOpen(false);
                    setBillEditId(null);
                  } catch (e: any) {
                    setErr(e?.message ?? "Save bill failed");
                  } finally {
                    setLoading(false);
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
                <input
                  type="date"
                  className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                  value={billInvoiceDate}
                  onChange={(e) => setBillInvoiceDate(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">Due date</div>
                <input
                  type="date"
                  className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                  value={billDueDate}
                  onChange={(e) => setBillDueDate(e.target.value)}
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
          size="lg"
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
                  <input
                    type="date"
                    className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2"
                    value={vendorPayDate}
                    onChange={(e) => setVendorPayDate(e.target.value)}
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

                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={vendorPayAutoApply}
                    onChange={(e) => {
                      const on = e.target.checked;
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
                  Auto-apply oldest first
                </label>
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
          size="lg"
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
                  disabled={!businessId || !applyAccountId || !paymentEntryId}
                  onClick={async () => {
                    if (!businessId || !applyAccountId || !paymentEntryId) return;
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
                      setErr(e?.message ?? "Unapply failed");
                    }
                  }}
                  title="Auditable unapply of all allocations for this payment"
                >
                  Unapply all
                </Button>

                <Button
                  variant="outline"
                  className="h-7 px-3 text-xs text-red-700 border-red-200 hover:bg-red-50"
                  disabled={!businessId || !applyAccountId || !paymentEntryId}
                  onClick={async () => {
                    if (!businessId || !applyAccountId || !paymentEntryId) return;
                    try {
                      await apiFetch(
                        `/v1/businesses/${businessId}/accounts/${applyAccountId}/entries/${paymentEntryId}/ap/unapply-and-delete`,
                        { method: "POST", body: JSON.stringify({ reason: "Unapply all and delete payment" }) }
                      );
                      await refresh();
                      window.dispatchEvent(new CustomEvent("bynk:vendors-refresh"));
                      setApplyOpen(false);
                    } catch (e: any) {
                      setErr(e?.message ?? "Unapply+delete failed");
                    }
                  }}
                  title="Explicit action: unapply all allocations then soft delete the payment entry"
                >
                  Unapply+Delete payment
                </Button>

                <Button
                  className="h-7 px-3 text-xs"
                  disabled={(() => {
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

                    try {
                      await applyVendorPayment({
                        businessId,
                        accountId: applyAccountId,
                        entryId: paymentEntryId,
                        applications: apps,
                      });

                      await refresh();
                      setApplyOpen(false);
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
          size="md"
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
                <input
                  type="date"
                  className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-50"
                  value={statementFrom}
                  onChange={(e) => setStatementFrom(e.target.value)}
                  disabled={statementPreset !== "custom"}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">To</div>
                <input
                  type="date"
                  className="h-8 w-full text-xs rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-50"
                  value={statementTo}
                  onChange={(e) => setStatementTo(e.target.value)}
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
    </div>
  );
}
