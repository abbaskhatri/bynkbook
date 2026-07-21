"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ExternalLink, FileCheck2, Loader2, MoreHorizontal, Printer, Settings2, ShieldCheck, XCircle } from "lucide-react";

import { EmptyStateCard } from "@/components/app/empty-state";
import { InlineBanner } from "@/components/app/inline-banner";
import { PageHeader } from "@/components/app/page-header";
import { AppDialog, DialogNotice, DialogSection } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listBillsByVendor, type Bill } from "@/lib/api/ap";
import { listCategories, type CategoryRow } from "@/lib/api/categories";
import {
  confirmCheckPrint,
  createCheckDraft,
  listChecks,
  saveCheckPrintSetting,
  voidCheck,
  type CheckPayment,
  type CheckPrintSetting,
} from "@/lib/api/checks";
import { listVendors, type Vendor } from "@/lib/api/vendors";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";
import { openSslt104PrintWindow, reserveSslt104PrintWindow } from "@/lib/checks/sslt104";
import { formatUsd, parseMoneyToCents, toBigIntSafe } from "@/lib/money";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useBusinesses } from "@/lib/queries/useBusinesses";

const fieldClass = "h-10 w-full rounded-md border border-bb-input-border bg-bb-input-bg px-3 text-sm text-bb-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
const labelClass = "mb-1 block text-xs font-medium text-bb-text-muted";

function todayLocal() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function statusClasses(status: CheckPayment["status"]) {
  if (status === "CLEARED") return "border-bb-status-success-border bg-bb-status-success-bg text-bb-status-success-fg";
  if (status === "VOIDED") return "border-bb-status-danger-border bg-bb-status-danger-bg text-bb-status-danger-fg";
  if (status === "DRAFT") return "border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg";
  return "border-bb-border bg-bb-surface-soft text-bb-text";
}

function outstandingCents(bill: Bill) {
  return toBigIntSafe(bill.outstanding_cents);
}

export default function ChecksPageClient() {
  const searchParams = useSearchParams();
  const businessesQ = useBusinesses();
  const urlBusinessId = searchParams.get("businessId") ?? searchParams.get("businessesId");
  const businessId = urlBusinessId ?? businessesQ.data?.[0]?.id ?? null;
  const business = useMemo(() => (businessesQ.data ?? []).find((item: any) => item.id === businessId), [businessId, businessesQ.data]);
  const role = String(business?.role ?? "").toUpperCase();
  const canWrite = ["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"].includes(role);
  const accountsQ = useAccounts(businessId);
  const checkingAccounts = useMemo(
    () => (accountsQ.data ?? []).filter((account) => account.type === "CHECKING" && !account.archived_at),
    [accountsQ.data]
  );

  const [checks, setChecks] = useState<CheckPayment[]>([]);
  const [settings, setSettings] = useState<CheckPrintSetting[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [setupOpen, setSetupOpen] = useState(false);
  const [setupAccountId, setSetupAccountId] = useState("");
  const [setupNumber, setSetupNumber] = useState("");
  const [setupX, setSetupX] = useState("0");
  const [setupY, setSetupY] = useState("0");

  const [composerOpen, setComposerOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [issuedDate, setIssuedDate] = useState(todayLocal());
  const [vendorId, setVendorId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [payeeAddress, setPayeeAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [bills, setBills] = useState<Bill[]>([]);
  const [billsLoading, setBillsLoading] = useState(false);
  const [allocationByBill, setAllocationByBill] = useState<Record<string, string>>({});

  const [printConfirmOpen, setPrintConfirmOpen] = useState(false);
  const [pendingPrintedCheck, setPendingPrintedCheck] = useState<CheckPayment | null>(null);
  const [voidTarget, setVoidTarget] = useState<CheckPayment | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const settingByAccount = useMemo(() => new Map(settings.map((setting) => [setting.account_id, setting])), [settings]);
  const selectedSetting = accountId ? settingByAccount.get(accountId) : undefined;
  const allocationsTotal = useMemo(
    () => Object.values(allocationByBill).reduce((sum, value) => sum + BigInt(Math.max(0, parseMoneyToCents(value))), 0n),
    [allocationByBill]
  );

  const refresh = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const [checkResult, vendorResult, categoryResult] = await Promise.all([
        listChecks(businessId),
        listVendors({ businessId, sort: "name_asc" }),
        listCategories(businessId, { includeArchived: false }),
      ]);
      setChecks(checkResult.checks ?? []);
      setSettings(checkResult.settings ?? []);
      setVendors(vendorResult.vendors ?? []);
      setCategories(categoryResult.rows ?? []);
    } catch (err) {
      setError(appErrorMessageOrNull(err) ?? "Checks could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function loadBills(nextVendorId: string) {
    if (!businessId || !nextVendorId) {
      setBills([]);
      setAllocationByBill({});
      return;
    }
    setBillsLoading(true);
    try {
      const result = await listBillsByVendor({ businessId, vendorId: nextVendorId, status: "open", limit: 100 });
      setBills((result.bills ?? []).filter((bill) => outstandingCents(bill) > 0n));
      setAllocationByBill({});
    } catch (err) {
      setError(appErrorMessageOrNull(err) ?? "Open bills could not be loaded.");
      setBills([]);
    } finally {
      setBillsLoading(false);
    }
  }

  function openSetup(targetAccountId?: string) {
    const target = targetAccountId || checkingAccounts[0]?.id || "";
    const existing = settingByAccount.get(target);
    setSetupAccountId(target);
    setSetupNumber(existing?.next_check_number ?? "");
    setSetupX(String(existing?.offset_x_mils ?? 0));
    setSetupY(String(existing?.offset_y_mils ?? 0));
    setSetupOpen(true);
  }

  function resetComposer(targetAccountId: string) {
    const setting = settingByAccount.get(targetAccountId);
    setAccountId(targetAccountId);
    setCheckNumber(setting?.next_check_number ?? "");
    setIssuedDate(todayLocal());
    setVendorId("");
    setPayeeName("");
    setPayeeAddress("");
    setAmount("");
    setMemo("");
    setCategoryId("");
    setBills([]);
    setAllocationByBill({});
  }

  function openComposer() {
    const target = checkingAccounts.find((account) => settingByAccount.has(account.id))?.id ?? checkingAccounts[0]?.id;
    if (!target) {
      setError("Add a checking account before creating checks.");
      return;
    }
    if (!settingByAccount.has(target)) {
      openSetup(target);
      return;
    }
    resetComposer(target);
    setComposerOpen(true);
  }

  async function saveSetup() {
    if (!businessId || !setupAccountId) return;
    setBusy(true);
    setError(null);
    try {
      await saveCheckPrintSetting({
        businessId,
        accountId: setupAccountId,
        next_check_number: setupNumber,
        offset_x_mils: Number(setupX || 0),
        offset_y_mils: Number(setupY || 0),
      });
      await refresh();
      setSetupOpen(false);
      resetComposer(setupAccountId);
      setComposerOpen(true);
    } catch (err) {
      setError(appErrorMessageOrNull(err) ?? "Check printing setup could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function printAlignmentTest() {
    const selectedAccount = checkingAccounts.find((item) => item.id === setupAccountId);
    if (!setupAccountId || !setupNumber) {
      setError("Choose an account and enter the first physical check number.");
      return;
    }
    const sample: CheckPayment = {
      id: "alignment-test",
      business_id: businessId ?? "",
      account_id: setupAccountId,
      account_name: selectedAccount?.name ?? "Checking account",
      check_number: setupNumber,
      issued_date: todayLocal(),
      payee_name: "SAMPLE PAYEE — ALIGNMENT TEST",
      payee_address: "123 Sample Street\nYour City, ST 00000",
      amount_cents: "123456",
      memo: "Alignment test — not a real check",
      purpose: "GENERAL",
      bill_allocations: [],
      template_code: "SSLT104",
      status: "DRAFT",
      stored_status: "DRAFT",
      print_count: 0,
      created_at: "",
      updated_at: "",
    };
    try {
      openSslt104PrintWindow({
        check: sample,
        businessName: business?.name ?? "Bynkbook business",
        setting: {
          account_id: setupAccountId,
          template_code: "SSLT104",
          next_check_number: setupNumber,
          offset_x_mils: Number(setupX || 0),
          offset_y_mils: Number(setupY || 0),
        },
        calibration: true,
      });
    } catch (err) {
      setError(appErrorMessageOrNull(err) ?? "The alignment test could not be opened.");
    }
  }

  function handleVendorChange(nextVendorId: string) {
    setVendorId(nextVendorId);
    const vendor = vendors.find((item) => item.id === nextVendorId);
    if (vendor) {
      setPayeeName(vendor.name);
      setPayeeAddress(vendor.address ?? "");
      setCategoryId(vendor.default_category_id ?? "");
    }
    void loadBills(nextVendorId);
  }

  function setBillSelected(bill: Bill, selected: boolean) {
    setAllocationByBill((current) => {
      const next = { ...current };
      if (selected) next[bill.id] = (Number(outstandingCents(bill)) / 100).toFixed(2);
      else delete next[bill.id];
      return next;
    });
  }

  async function createAndPrint() {
    if (!businessId || !selectedSetting) return;
    const cents = parseMoneyToCents(amount);
    if (!payeeName.trim() || cents <= 0) {
      setError("Enter a payee and a valid check amount.");
      return;
    }
    let previewWindow: Window | null = null;
    try {
      previewWindow = reserveSslt104PrintWindow();
    } catch (err) {
      setError(appErrorMessageOrNull(err) ?? "Allow pop-ups to open the check preview.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const allocations = Object.entries(allocationByBill)
        .map(([bill_id, value]) => ({ bill_id, applied_amount_cents: parseMoneyToCents(value) }))
        .filter((item) => item.applied_amount_cents > 0);
      const result = await createCheckDraft({
        businessId,
        account_id: accountId,
        vendor_id: vendorId || null,
        category_id: categoryId || null,
        check_number: checkNumber,
        issued_date: issuedDate,
        payee_name: payeeName.trim(),
        payee_address: payeeAddress.trim() || null,
        amount_cents: cents,
        memo: memo.trim() || null,
        bill_allocations: allocations,
      });
      setComposerOpen(false);
      openSslt104PrintWindow({ check: result.check, businessName: business?.name ?? "Bynkbook business", setting: selectedSetting }, previewWindow);
      setPendingPrintedCheck(result.check);
      setPrintConfirmOpen(true);
    } catch (err) {
      previewWindow?.close();
      setError(appErrorMessageOrNull(err) ?? "The check could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  function printExisting(check: CheckPayment) {
    const setting = settingByAccount.get(check.account_id);
    if (!setting) {
      openSetup(check.account_id);
      return;
    }
    try {
      openSslt104PrintWindow({ check, businessName: business?.name ?? "Bynkbook business", setting });
      setPendingPrintedCheck(check);
      setPrintConfirmOpen(true);
    } catch (err) {
      setError(appErrorMessageOrNull(err) ?? "The print preview could not be opened.");
    }
  }

  async function confirmPrinted() {
    if (!businessId || !pendingPrintedCheck) return;
    setBusy(true);
    try {
      await confirmCheckPrint(businessId, pendingPrintedCheck.id);
      setPrintConfirmOpen(false);
      setPendingPrintedCheck(null);
      await refresh();
    } catch (err) {
      setError(appErrorMessageOrNull(err) ?? "The printed check could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitVoid() {
    if (!businessId || !voidTarget) return;
    setBusy(true);
    try {
      await voidCheck(businessId, voidTarget.id, voidReason);
      setVoidTarget(null);
      setVoidReason("");
      setPrintConfirmOpen(false);
      setPendingPrintedCheck(null);
      await refresh();
    } catch (err) {
      setError(appErrorMessageOrNull(err) ?? "The check could not be voided.");
    } finally {
      setBusy(false);
    }
  }

  const inputAmountCents = BigInt(Math.max(0, parseMoneyToCents(amount)));

  return (
    <div className="flex max-w-6xl flex-col gap-3 pb-6">
      <section className="overflow-hidden rounded-xl border border-bb-border bg-bb-surface-card shadow-sm">
        <div className="px-4 py-3">
          <PageHeader
            icon={<FileCheck2 className="h-4 w-4" />}
            title="Checks"
            subtitle="Prepare, print, and track checks without requiring a vendor or invoice."
            right={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => openSetup()} disabled={!canWrite || !checkingAccounts.length}><Settings2 className="h-4 w-4" /> Setup</Button><Button size="sm" onClick={openComposer} disabled={!canWrite || loading}><Printer className="h-4 w-4" /> New check</Button></div>}
          />
        </div>
        <div className="border-t border-bb-border bg-bb-surface-soft px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md border border-primary/20 bg-primary/10 p-2 text-primary"><ShieldCheck className="h-4 w-4" /></div>
              <div><div className="text-sm font-semibold text-bb-text">Compatible with Deluxe SSLT104 only</div><div className="mt-0.5 text-xs leading-5 text-bb-text-muted">8½ × 11-inch, unlined, top check with two voucher sections. Use preprinted personalized stock.</div></div>
            </div>
            <a className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" href="https://www.deluxe.com/shopdeluxe/pd/high-security-laser-top-check-compatible-with-quickbooks/_/A-SSLT104" target="_blank" rel="noreferrer">View compatible checks <ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
        </div>
      </section>

      {error ? <InlineBanner title="Check printing needs attention" message={error} onRetry={() => void refresh()} /> : null}

      {loading && checks.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center rounded-xl border border-bb-border bg-bb-surface-card"><Loader2 className="h-5 w-5 animate-spin text-bb-text-muted" /></div>
      ) : checks.length === 0 ? (
        <EmptyStateCard title="No checks yet" description="Create a check for any payee, or link it to a vendor and open bills when useful." primary={{ label: "Create your first check", onClick: openComposer }} secondary={checkingAccounts.length ? { label: "Configure check stock", onClick: () => openSetup() } : null} />
      ) : (
        <section className="overflow-hidden rounded-xl border border-bb-border bg-bb-surface-card shadow-sm">
          <div className="flex items-center justify-between border-b border-bb-border px-4 py-3"><div><h2 className="text-sm font-semibold text-bb-text">Check register</h2><p className="mt-0.5 text-xs text-bb-text-muted">Outstanding checks reconcile through the normal bank workflow.</p></div><Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}</Button></div>
          <div className="divide-y divide-bb-border md:hidden">
            {checks.map((check) => <div key={check.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-bb-text">#{check.check_number} · {check.payee_name}</div><div className="mt-1 text-xs text-bb-text-muted">{check.issued_date} · {check.account_name}</div></div><div className="text-right"><div className="text-sm font-semibold text-bb-text">{formatUsd(toBigIntSafe(check.amount_cents))}</div><span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(check.status)}`}>{check.status.toLowerCase()}</span></div></div><div className="mt-3 flex gap-2"><Button variant="outline" size="sm" onClick={() => printExisting(check)} disabled={check.status === "VOIDED" || check.status === "CLEARED"}><Printer className="h-3.5 w-3.5" /> {check.status === "DRAFT" ? "Print" : "Reprint"}</Button>{check.status !== "VOIDED" && check.status !== "CLEARED" ? <Button variant="ghost" size="sm" onClick={() => { setVoidTarget(check); setVoidReason(check.status === "DRAFT" ? "Physical check not used" : "Void requested"); }}>Void</Button> : null}</div></div>)}
          </div>
          <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="bg-bb-table-header text-xs text-bb-text-muted"><tr><th className="px-4 py-2.5 font-medium">Check</th><th className="px-4 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 font-medium">Payee</th><th className="px-4 py-2.5 font-medium">Account</th><th className="px-4 py-2.5 text-right font-medium">Amount</th><th className="px-4 py-2.5 font-medium">Status</th><th className="w-32 px-4 py-2.5"><span className="sr-only">Actions</span></th></tr></thead><tbody className="divide-y divide-bb-border">{checks.map((check) => <tr key={check.id} className="hover:bg-bb-table-row-hover"><td className="px-4 py-3 font-medium text-bb-text">#{check.check_number}</td><td className="px-4 py-3 text-bb-text-muted">{check.issued_date}</td><td className="max-w-64 truncate px-4 py-3 text-bb-text"><div className="font-medium">{check.payee_name}</div><div className="truncate text-xs text-bb-text-muted">{check.memo || check.purpose.replaceAll("_", " ").toLowerCase()}</div></td><td className="px-4 py-3 text-bb-text-muted">{check.account_name}</td><td className="px-4 py-3 text-right font-semibold text-bb-text">{formatUsd(toBigIntSafe(check.amount_cents))}</td><td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(check.status)}`}>{check.status.toLowerCase()}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => printExisting(check)} disabled={check.status === "VOIDED" || check.status === "CLEARED"} title={check.status === "DRAFT" ? "Print check" : "Reprint check"}><Printer className="h-4 w-4" /></Button>{check.status !== "VOIDED" && check.status !== "CLEARED" ? <Button variant="ghost" size="sm" onClick={() => { setVoidTarget(check); setVoidReason(check.status === "DRAFT" ? "Physical check not used" : "Void requested"); }} title="Void check"><XCircle className="h-4 w-4" /></Button> : <Button variant="ghost" size="sm" disabled><MoreHorizontal className="h-4 w-4" /></Button>}</div></td></tr>)}</tbody></table></div>
        </section>
      )}

      <AppDialog open={setupOpen} onClose={() => !busy && setSetupOpen(false)} title="Set up check printing" description="Bynkbook currently supports Deluxe SSLT104 preprinted check stock." size="md" footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={() => setSetupOpen(false)} disabled={busy}>Cancel</Button><Button onClick={() => void saveSetup()} disabled={busy || !setupAccountId || !setupNumber}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save setup</Button></div>}>
        <div className="space-y-4">
          <DialogNotice tone="warning">Look at the number printed on the first physical check loaded in your printer. Bynkbook records that number; it does not replace it.</DialogNotice>
          <div><label className={labelClass}>Checking account</label><select className={fieldClass} value={setupAccountId} onChange={(event) => { const next = event.target.value; const current = settingByAccount.get(next); setSetupAccountId(next); setSetupNumber(current?.next_check_number ?? ""); setSetupX(String(current?.offset_x_mils ?? 0)); setSetupY(String(current?.offset_y_mils ?? 0)); }}>{checkingAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>
          <div><label className={labelClass}>Next physical check number</label><Input className={fieldClass} inputMode="numeric" value={setupNumber} onChange={(event) => setSetupNumber(event.target.value.replace(/\D/g, ""))} placeholder="For example, 1001" /></div>
          <Button type="button" variant="outline" className="w-full" onClick={printAlignmentTest}><Printer className="h-4 w-4" /> Print plain-paper alignment test</Button>
          <DialogSection title="Fine-tune alignment (optional)"><div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>Move right / left</label><Input className={fieldClass} type="number" min={-500} max={500} value={setupX} onChange={(event) => setSetupX(event.target.value)} /><p className="mt-1 text-[11px] text-bb-text-muted">Positive moves right</p></div><div><label className={labelClass}>Move down / up</label><Input className={fieldClass} type="number" min={-500} max={500} value={setupY} onChange={(event) => setSetupY(event.target.value)} /><p className="mt-1 text-[11px] text-bb-text-muted">Positive moves down</p></div></div><p className="mt-2 text-xs text-bb-text-muted">Values are thousandths of an inch. Start at 0 and adjust only after a plain-paper test.</p></DialogSection>
        </div>
      </AppDialog>

      <AppDialog open={composerOpen} onClose={() => !busy && setComposerOpen(false)} title="Create check" description="Pay anyone. Vendor and bill links are optional." size="xl" footer={<div className="flex w-full items-center justify-between"><div className="text-xs text-bb-text-muted">Print at 100% / Actual Size</div><div className="flex gap-2"><Button variant="outline" onClick={() => setComposerOpen(false)} disabled={busy}>Cancel</Button><Button onClick={() => void createAndPrint()} disabled={busy || !selectedSetting || !payeeName.trim() || parseMoneyToCents(amount) <= 0}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Preview & print</Button></div></div>}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3"><div className="sm:col-span-2"><label className={labelClass}>Checking account</label><select className={fieldClass} value={accountId} onChange={(event) => { const next = event.target.value; setAccountId(next); const setting = settingByAccount.get(next); if (!setting) { setComposerOpen(false); openSetup(next); } else setCheckNumber(setting.next_check_number); }}>{checkingAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div><div><label className={labelClass}>Physical check number</label><Input className={fieldClass} inputMode="numeric" value={checkNumber} onChange={(event) => setCheckNumber(event.target.value.replace(/\D/g, ""))} /></div></div>
          <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>Link to vendor (optional)</label><select className={fieldClass} value={vendorId} onChange={(event) => handleVendorChange(event.target.value)}><option value="">No vendor — pay anyone</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></div><div><label className={labelClass}>Check date</label><Input className={fieldClass} type="date" value={issuedDate} onChange={(event) => setIssuedDate(event.target.value)} /></div></div>
          <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>Pay to the order of</label><Input className={fieldClass} value={payeeName} onChange={(event) => setPayeeName(event.target.value)} placeholder="Person or business name" /></div><div><label className={labelClass}>Amount</label><Input className={fieldClass} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></div>
          <div><label className={labelClass}>Payee address (optional)</label><textarea className={`${fieldClass} h-20 resize-none py-2`} value={payeeAddress} onChange={(event) => setPayeeAddress(event.target.value)} placeholder="Printed beneath the payee name" /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>Category (optional)</label><select className={fieldClass} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Categorize later</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div><div><label className={labelClass}>Memo (optional)</label><Input className={fieldClass} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="Reason for payment" /></div></div>
          {vendorId ? <DialogSection title="Apply to open bills (optional)" action={allocationsTotal > 0n ? <Button variant="ghost" size="sm" onClick={() => setAmount((Number(allocationsTotal) / 100).toFixed(2))}>Use selected total</Button> : null}>{billsLoading ? <div className="flex items-center gap-2 py-3 text-sm text-bb-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading open bills…</div> : bills.length === 0 ? <p className="py-2 text-sm text-bb-text-muted">No open bills. The check can still be recorded as a payment on account.</p> : <div className="space-y-2">{bills.map((bill) => { const selected = allocationByBill[bill.id] !== undefined; return <div key={bill.id} className="flex flex-col gap-2 rounded-md border border-bb-border p-3 sm:flex-row sm:items-center"><label className="flex min-w-0 flex-1 items-start gap-3"><input className="mt-1 h-4 w-4" type="checkbox" checked={selected} onChange={(event) => setBillSelected(bill, event.target.checked)} /><span className="min-w-0"><span className="block truncate text-sm font-medium text-bb-text">{bill.memo || "Invoice"}</span><span className="block text-xs text-bb-text-muted">Due {bill.due_date} · {formatUsd(outstandingCents(bill))} outstanding</span></span></label>{selected ? <Input className="h-9 w-full sm:w-32" inputMode="decimal" value={allocationByBill[bill.id]} onChange={(event) => setAllocationByBill((current) => ({ ...current, [bill.id]: event.target.value }))} aria-label={`Amount applied to ${bill.memo || "invoice"}`} /> : null}</div>; })}<div className="flex justify-between border-t border-bb-border pt-2 text-xs"><span className="text-bb-text-muted">Selected bill total</span><strong className={allocationsTotal > inputAmountCents ? "text-bb-status-danger-fg" : "text-bb-text"}>{formatUsd(allocationsTotal)}</strong></div>{allocationsTotal > inputAmountCents ? <p className="text-xs text-bb-status-danger-fg">Selected bill amounts exceed the check amount.</p> : null}</div>}</DialogSection> : null}
        </div>
      </AppDialog>

      <AppDialog open={printConfirmOpen} onClose={() => !busy && setPrintConfirmOpen(false)} title="Did the check print correctly?" description={`Check #${pendingPrintedCheck?.check_number ?? ""} is not finalized until you confirm.`} size="sm" disableOverlayClose footer={<div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => { setPrintConfirmOpen(false); setPendingPrintedCheck(null); }} disabled={busy}>Decide later</Button><Button variant="outline" onClick={() => { if (pendingPrintedCheck) { setVoidTarget(pendingPrintedCheck); setVoidReason("Physical check misprinted"); } }} disabled={busy}>Misprinted — void it</Button><Button onClick={() => void confirmPrinted()} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Printed correctly</Button></div>}>
        <DialogNotice tone="warning">Confirm only after checking the physical page. Confirmation records the ledger payment; this physical check number is already reserved and will not be reused.</DialogNotice>
      </AppDialog>

      <AppDialog open={!!voidTarget} onClose={() => !busy && setVoidTarget(null)} title={`Void check #${voidTarget?.check_number ?? ""}?`} description="The number remains in the register and will never be reused." size="sm" tone="danger" footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={() => setVoidTarget(null)} disabled={busy}>Cancel</Button><Button variant="destructive" onClick={() => void submitVoid()} disabled={busy || voidReason.trim().length < 3}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Void check</Button></div>}>
        <div><label className={labelClass}>Reason</label><Input className={fieldClass} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} autoFocus /></div>
      </AppDialog>
    </div>
  );
}
