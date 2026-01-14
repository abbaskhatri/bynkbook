"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import { useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { createAccount, type Account, type AccountType } from "@/lib/api/accounts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader as THead, TableRow } from "@/components/ui/table";
import { Settings, Pencil, Archive, Trash2 } from "lucide-react";

function todayYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ymdToIso(ymd: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return `${ymd}T00:00:00Z`;
  return ymd;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAccountType(t: AccountType) {
  switch (t) {
    case "CHECKING": return "Checking";
    case "SAVINGS": return "Savings";
    case "CREDIT_CARD": return "Credit card";
    case "CASH": return "Cash";
    case "OTHER": return "Other";
    default: return t;
  }
}

function formatShortDate(input?: string | null) {
  if (!input) return "";
  // Accept YYYY-MM-DD, ISO, or Date-parsable strings.
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    // Fallback for plain YYYY-MM-DD that some browsers may parse inconsistently
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      const [y, m, day] = input.split("-").map(Number);
      const dd = new Date(Date.UTC(y, m - 1, day));
      const mm2 = String(dd.getUTCMonth() + 1).padStart(2, "0");
      const dd2 = String(dd.getUTCDate()).padStart(2, "0");
      const yy2 = String(dd.getUTCFullYear()).slice(-2);
      return `${mm2}/${dd2}/${yy2}`;
    }
    return input;
  }
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

export default function SettingsPageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();

  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        setAuthReady(true);
      } catch {
        router.replace("/login");
      }
    })();
  }, [router]);

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const accountsQ = useAccounts(selectedBusinessId);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("CHECKING");
  const [openingBalance, setOpeningBalance] = useState("0.00");
  const [openingDate, setOpeningDate] = useState(todayYmd());

  // Bookkeeping settings (UI-only for Phase 3)
  const [bkAmountTolerance, setBkAmountTolerance] = useState("0.01");
  const [bkDaysTolerance, setBkDaysTolerance] = useState("3");
  const [bkDuplicateWindowDays, setBkDuplicateWindowDays] = useState("7");
  const [bkStaleCheckDays, setBkStaleCheckDays] = useState("90");
  const [bkAutoSuggestCategories, setBkAutoSuggestCategories] = useState(true);

  // AI & Automation (UI-only for Phase 3)
  const [aiAutoCategorize, setAiAutoCategorize] = useState(true);
  const [aiSmartDuplicateHints, setAiSmartDuplicateHints] = useState(true);
  const [aiAutoRules, setAiAutoRules] = useState(false);

  // Categories list (Phase 3: UI-only, managed under Bookkeeping)
  const [bkCategories, setBkCategories] = useState<string[]>([
    "Advertising",
    "Bank Fees",
    "Fuel",
    "Insurance",
    "Loan Payment",
    "Maintenance",
    "Misc",
    "Marketing",
    "Office Supplies",
    "Payroll",
    "Purchase",
    "Rent",
    "Sale",
    "Service Charges",
    "Supplies",
    "Tax",
    "Travel",
    "Utilities",
  ]);
  const [bkNewCategory, setBkNewCategory] = useState("");

  // Categories (UI-only for Phase 3)
  const prefilledCategories = useMemo(
    () => [
      "Advertising",
      "Bank Fees",
      "Cash Withdrawal",
      "Contractors",
      "Fuel",
      "Insurance",
      "Interest",
      "Meals & Entertainment",
      "Office Supplies",
      "Payroll",
      "Rent",
      "Repairs & Maintenance",
      "Shipping",
      "Software Subscriptions",
      "Taxes",
      "Travel",
      "Utilities",
    ],
    []
  );

  const customCategories = useMemo(() => ["Owner Draw", "Owner Contribution"], []);

  async function onCreateAccount() {
    if (!selectedBusinessId) return;

    setSaving(true);
    setErr(null);

    const cents = Math.round(Number(openingBalance || "0") * 100);

    const tempId = `temp_${Date.now()}`;
    const key = ["accounts", selectedBusinessId] as const;

    const optimistic: Account = {
      id: tempId,
      business_id: selectedBusinessId,
      name: name.trim() || "Untitled",
      type,
      opening_balance_cents: cents,
      opening_balance_date: openingDate,
      archived_at: null,
    };

    try {
      // Optimistic insert
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Account[]>(key) ?? [];
      qc.setQueryData<Account[]>(key, [optimistic, ...prev]);

      // Close dialog immediately (instant UX)
      setOpen(false);

      const created = await createAccount(selectedBusinessId, {
        name: name.trim(),
        type,
        opening_balance_cents: cents,
        opening_balance_date: ymdToIso(openingDate),
      });

      // Replace temp row with server row
      qc.setQueryData<Account[]>(key, (cur) => {
        const list = cur ?? [];
        return list.map((a) => (a.id === tempId ? created : a));
      });

      // Reset form
      setName("");
      setType("CHECKING");
      setOpeningBalance("0.00");
      setOpeningDate(todayYmd());

      // Coalesced background refresh (one)
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: key });
      }, 250);
    } catch (e: any) {
      // Rollback optimistic insert on error
      qc.invalidateQueries({ queryKey: key });
      setErr(e?.message || "Failed to create account");
      setOpen(true);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!authReady) return;
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;

    if (!sp.get("businessId")) {
      router.replace(`/settings?businessId=${selectedBusinessId}`);
    }
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  const currentUserName = "Muhammad Abbas Khatri";
  const currentUserEmail = "m.abbaskhatri@gmail.com";
  const currentUserRole = "Super Admin";

  if (!authReady) {
    return <div><Skeleton className="h-10 w-64" /></div>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<Settings className="h-4 w-4" />} title="Settings" />
        </div>

        {/* Divider */}
        <div className="mt-2 h-px bg-slate-200" />

        {/* Tabs (inside header box) */}
        <div className="px-3 py-3">
          <div className="flex gap-2 text-sm">
            {[
              { key: "business", label: "Business Profile" },
              { key: "bookkeeping", label: "Bookkeeping" },
              { key: "accounts", label: "Accounts" },
              { key: "ai", label: "AI & Automation" },
              { key: "billing", label: "Billing" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  const params = new URLSearchParams(sp.toString());
                  params.set("tab", t.key);
                  router.replace(`?${params.toString()}`);
                }}
                className={`h-7 px-3 rounded-md text-xs font-medium transition
                  ${
                    sp.get("tab") === t.key || (!sp.get("tab") && t.key === "business")
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs are rendered inside the PageHeader container above */}

      {/* Settings Tab Content */}
      {(() => {
        const rawTab = sp.get("tab") || "business";
        const tab = rawTab === "categories" ? "bookkeeping" : rawTab;

        if (tab === "accounts") {
          return (
            <Card>
              <CardHeader className="space-y-0 pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle>Accounts</CardTitle>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Manage bank accounts, cash accounts, and credit cards.
                    </div>
                  </div>

<div>
  <Button size="sm" onClick={() => setOpen(true)}>
    Add account
  </Button>

  <AppDialog
    open={open}
    onClose={() => setOpen(false)}
    title="Create account"
    size="md"
    footer={
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={onCreateAccount} disabled={saving || !selectedBusinessId || !name.trim()}>
          {saving ? "Creating…" : "Create"}
        </Button>
      </div>
    }
  >
    <div className="space-y-3">
      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="space-y-1">
        <Label>Name</Label>
        <Input className="h-7" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-1">
        <Label>Type</Label>
        <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
          <SelectTrigger className="h-7">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CHECKING">Checking</SelectItem>
            <SelectItem value="SAVINGS">Savings</SelectItem>
            <SelectItem value="CREDIT_CARD">Credit card</SelectItem>
            <SelectItem value="CASH">Cash</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Opening balance</Label>
          <Input className="h-7" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Opening date</Label>
          <Input className="h-7" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
        </div>
      </div>
    </div>
  </AppDialog>
</div>
                </div>
              </CardHeader>

              <CardContent>
                {accountsQ.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : (accountsQ.data?.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground">No accounts yet.</div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <Table>
                      <THead className="bg-slate-50">
                        <TableRow className="hover:bg-slate-50">
                          <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Name</TableHead>
                          <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Type</TableHead>
                          <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Opening balance</TableHead>
                          <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Status</TableHead>
                          <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Actions</TableHead>
                        </TableRow>
                      </THead>

                      <TableBody>
                        {(accountsQ.data ?? []).map((a) => {
                          const amount = currency.format(a.opening_balance_cents / 100);
                          const date = formatShortDate(a.opening_balance_date);
                          const isArchived = !!a.archived_at;

                          return (
                            <TableRow key={a.id} className="hover:bg-slate-50">
                              <TableCell className="py-2 font-medium text-slate-900">{a.name}</TableCell>
                              <TableCell className="py-2 text-slate-700">{formatAccountType(a.type)}</TableCell>

                              <TableCell className="py-2 text-right">
                                <div className="font-medium text-slate-900 leading-none">{amount}</div>
                                {date ? <div className="text-[11px] text-slate-500 leading-none mt-1">{date}</div> : null}
                              </TableCell>

                              <TableCell className="py-2 text-right">
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium
                                    ${isArchived ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700"}`}
                                >
                                  {isArchived ? "Archived" : "Active"}
                                </span>
                              </TableCell>

                              <TableCell className="py-2 text-right">
                                <div className="flex justify-end gap-1">
                                  <button
                                    type="button"
                                    className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                                    disabled
                                    title="Edit (coming soon)"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                                    disabled
                                    title="Archive (coming soon)"
                                  >
                                    <Archive className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-slate-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                    disabled
                                    title="Delete (coming soon)"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        }

        if (tab === "business") {
          return (
            <div className="space-y-4">
              {/* Profile */}
              <Card>
                <CardHeader className="space-y-0 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle>Profile</CardTitle>
                      <div className="mt-1 text-xs text-muted-foreground">Your account information</div>
                    </div>

                    <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-medium">
                      {currentUserRole}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="text-sm">
                  <div className="font-medium text-slate-900">{currentUserName}</div>
                  <div className="text-xs text-muted-foreground">{currentUserEmail}</div>
                </CardContent>
              </Card>

              {/* Current Usage */}
              <Card>
                <CardHeader className="space-y-0 pb-2">
                  <CardTitle>Current Usage</CardTitle>
                  <div className="mt-1 text-xs text-muted-foreground">Track your monthly usage against plan limits</div>
                </CardHeader>

                <CardContent className="pt-0">
                  <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                    <div className="flex items-stretch">
                      <div className="flex-1 px-4 py-3 text-center">
                        <div className="text-lg font-semibold text-slate-900 leading-none">0</div>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Entries/mo</div>
                      </div>

                      <div className="w-px bg-slate-200" />

                      <div className="flex-1 px-4 py-3 text-center">
                        <div className="text-lg font-semibold text-slate-900 leading-none">{accountsQ.data?.length ?? 0}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Accounts</div>
                      </div>

                      <div className="w-px bg-slate-200" />

                      <div className="flex-1 px-4 py-3 text-center">
                        <div className="text-lg font-semibold text-slate-900 leading-none">1</div>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Users</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Business Management (UI shell) */}
              <Card>
                <CardHeader className="space-y-0 pb-3">
                  <CardTitle>Business Profile</CardTitle>
                  <div className="mt-1 text-xs text-muted-foreground">Business details and regional settings</div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Logo + upload (UI-only) */}
                  <div>
                    <div className="text-xs font-medium text-slate-700">Business Logo</div>
                    <div className="mt-2 flex items-start gap-3">
                      <div className="h-16 w-16 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-slate-400">
                        <div className="text-xs">Logo</div>
                      </div>
                      <div className="space-y-1">
                        <Button variant="outline" size="sm" disabled>
                          Upload logo
                        </Button>
                        <div className="text-[11px] text-muted-foreground">PNG, JPG, SVG or WebP. Max 2MB.</div>
                      </div>
                    </div>
                  </div>

                  {/* Business fields (UI-only) */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Business Name</Label>
                      <Input className="h-7" disabled value="Snaxle Inc" />
                    </div>
                    <div className="space-y-1">
                      <Label>Legal Name</Label>
                      <Input className="h-7" disabled value="My Business LLC" />
                    </div>
                    <div className="space-y-1">
                      <Label>Industry</Label>
                      <Input className="h-7" disabled value="retail" />
                    </div>
                    <div className="space-y-1">
                      <Label>Phone</Label>
                      <Input className="h-7" disabled value="(469) 781-9171" />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label>Address</Label>
                      <Input className="h-7" disabled value="123 Main St, City, State 12345" />
                    </div>
                  </div>

                  {/* Regional settings (UI-only) */}
                  <div className="pt-2 border-t border-slate-200">
                    <div className="text-xs font-medium text-slate-700 mb-2">Regional Settings</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label>Currency</Label>
                        <Input className="h-7" disabled value="USD - US Dollar" />
                      </div>
                      <div className="space-y-1">
                        <Label>Timezone</Label>
                        <Input className="h-7" disabled value="Central Time (CT)" />
                      </div>
                      <div className="space-y-1">
                        <Label>Fiscal Year Start</Label>
                        <Input className="h-7" disabled value="January" />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 disabled:opacity-50"
                        disabled
                        title="Delete business (coming soon)"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Business
                      </button>

                      <Button size="sm" disabled>
                        Save changes
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Preferences (UI-only) */}
              <Card>
                <CardHeader className="space-y-0 pb-3">
                  <CardTitle>Preferences</CardTitle>
                  <div className="mt-1 text-xs text-muted-foreground">Customize your personal settings</div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium text-slate-700">Timezone</div>
                    </div>
                    <Input className="h-7 w-48" disabled value="Central Time (CT)" />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium text-slate-700">Color-blind mode</div>
                      <div className="text-[11px] text-muted-foreground">High-contrast chart colors</div>
                    </div>
                    <div className="h-5 w-9 rounded-full bg-slate-200 relative opacity-60" title="Coming soon" />
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        }

        if (tab === "bookkeeping") {
          return (
            <div className="space-y-4">
              <Card>
                <CardHeader className="space-y-0 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle>Bookkeeping Preferences</CardTitle>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Configure tolerances and issue detection settings
                      </div>
                    </div>

                    <Button size="sm" disabled title="Save preferences (coming soon)">
                      Save preferences
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  {/* Reconciliation tolerances */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-700">Reconciliation Tolerances</div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Amount tolerance ($)</Label>
                        <Input
                          className="h-7"
                          value={bkAmountTolerance}
                          onChange={(e) => setBkAmountTolerance(e.target.value)}
                        />
                        <div className="text-[11px] text-muted-foreground">
                          Maximum difference allowed when matching ledger entries to bank transactions
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label>Days tolerance</Label>
                        <Input
                          className="h-7"
                          value={bkDaysTolerance}
                          onChange={(e) => setBkDaysTolerance(e.target.value)}
                        />
                        <div className="text-[11px] text-muted-foreground">
                          Maximum days difference between ledger and bank transaction dates
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="h-px bg-slate-200" />

                  {/* Issue detection */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-700">Issue Detection</div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Duplicate detection window (days)</Label>
                        <Input
                          className="h-7"
                          value={bkDuplicateWindowDays}
                          onChange={(e) => setBkDuplicateWindowDays(e.target.value)}
                        />
                        <div className="text-[11px] text-muted-foreground">
                          Time window to check for potential duplicate entries
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label>Stale check threshold (days)</Label>
                        <Input
                          className="h-7"
                          value={bkStaleCheckDays}
                          onChange={(e) => setBkStaleCheckDays(e.target.value)}
                        />
                        <div className="text-[11px] text-muted-foreground">
                          Days before an uncleared check is flagged as stale
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="h-px bg-slate-200" />

                  {/* Category suggestions */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-700">Category Suggestions</div>

                    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-800">Auto-suggest categories</div>
                        <div className="text-[11px] text-muted-foreground">
                          Automatically suggest categories based on payee history and rules
                        </div>
                      </div>

                      <button
                        type="button"
                        className={`h-5 w-9 rounded-full relative transition ${
                          bkAutoSuggestCategories ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                        onClick={() => setBkAutoSuggestCategories((v) => !v)}
                        aria-label="Toggle auto-suggest categories"
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                            bkAutoSuggestCategories ? "left-4.5" : "left-0.5"
                          }`}
                          style={{ left: bkAutoSuggestCategories ? 18 : 2 }}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="h-px bg-slate-200" />

                  {/* Categories (single compact list) */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-medium text-slate-700">Categories</div>
                        <div className="text-[11px] text-muted-foreground">
                          Keep this list short and clean. Delete categories you don’t use.
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Input
                          className="h-7 w-52"
                          placeholder="Add category…"
                          value={bkNewCategory}
                          onChange={(e) => setBkNewCategory(e.target.value)}
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            const v = bkNewCategory.trim();
                            if (!v) return;
                            setBkCategories((cur) => (cur.includes(v) ? cur : [v, ...cur]));
                            setBkNewCategory("");
                          }}
                          disabled={!bkNewCategory.trim()}
                        >
                          Add
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap gap-2">
                        {bkCategories.map((c) => (
                          <span
                            key={c}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                          >
                            {c}
                            <button
                              type="button"
                              className="inline-flex items-center justify-center rounded-full hover:bg-slate-200/60 text-rose-600"
                              title={`Delete "${c}"`}
                              onClick={() => setBkCategories((cur) => cur.filter((x) => x !== c))}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        ))}
                      </div>

                      {bkCategories.length === 0 ? (
                        <div className="text-xs text-muted-foreground">No categories yet.</div>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        }

        if (tab === "categories") {
          return (
            <div className="space-y-4">
              <Card>
                <CardHeader className="space-y-0 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle>Categories</CardTitle>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Manage default and custom categories used across your ledger
                      </div>
                    </div>

                    <Button size="sm" disabled title="Add category (coming soon)">
                      Add category
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  {/* Prefilled */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-slate-700">Prefilled categories</div>
                      <div className="text-[11px] text-muted-foreground">Read-only in Phase 3</div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <Table>
                        <THead className="bg-slate-50">
                          <TableRow className="hover:bg-slate-50">
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Name</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Actions</TableHead>
                          </TableRow>
                        </THead>
                        <TableBody>
                          {prefilledCategories.map((c) => (
                            <TableRow key={c} className="hover:bg-slate-50">
                              <TableCell className="py-2 font-medium text-slate-900">{c}</TableCell>
                              <TableCell className="py-2 text-right">
                                <button
                                  type="button"
                                  className="h-6 px-2 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 bg-slate-50 cursor-not-allowed"
                                  disabled
                                  title="Prefilled categories cannot be deleted in Phase 3"
                                >
                                  Locked
                                </button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  <div className="h-px bg-slate-200" />

                  {/* Custom */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-slate-700">Custom categories</div>
                      <div className="text-[11px] text-muted-foreground">Coming soon</div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <Table>
                        <THead className="bg-slate-50">
                          <TableRow className="hover:bg-slate-50">
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Name</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Actions</TableHead>
                          </TableRow>
                        </THead>
                        <TableBody>
                          {customCategories.map((c) => (
                            <TableRow key={c} className="hover:bg-slate-50">
                              <TableCell className="py-2 font-medium text-slate-900">{c}</TableCell>
                              <TableCell className="py-2 text-right">
                                <div className="flex justify-end gap-1">
                                  <button
                                    type="button"
                                    className="h-6 px-2 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                                    disabled
                                    title="Edit (coming soon)"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="h-6 px-2 inline-flex items-center justify-center rounded-md border border-slate-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                    disabled
                                    title="Delete (coming soon)"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                      Category CRUD will be enabled once backend endpoints are finalized.
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        }

        if (tab === "ai") {
          return (
            <div className="space-y-4">
              <Card>
                <CardHeader className="space-y-0 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle>AI & Automation</CardTitle>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Control AI-assisted suggestions and automation behavior
                      </div>
                    </div>

                    <Button size="sm" disabled title="Save preferences (coming soon)">
                      Save preferences
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Toggle rows (UI-only) */}
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-800">Auto-categorize suggestions</div>
                      <div className="text-[11px] text-muted-foreground">
                        Suggest categories based on payee history and existing patterns
                      </div>
                    </div>

                    <button
                      type="button"
                      className={`h-5 w-9 rounded-full relative transition ${
                        aiAutoCategorize ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                      onClick={() => setAiAutoCategorize((v) => !v)}
                      aria-label="Toggle auto-categorize suggestions"
                    >
                      <span
                        className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition"
                        style={{ left: aiAutoCategorize ? 18 : 2 }}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-800">Smart duplicate hints</div>
                      <div className="text-[11px] text-muted-foreground">
                        Highlight probable duplicates and provide merge suggestions
                      </div>
                    </div>

                    <button
                      type="button"
                      className={`h-5 w-9 rounded-full relative transition ${
                        aiSmartDuplicateHints ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                      onClick={() => setAiSmartDuplicateHints((v) => !v)}
                      aria-label="Toggle smart duplicate hints"
                    >
                      <span
                        className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition"
                        style={{ left: aiSmartDuplicateHints ? 18 : 2 }}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-800">Auto-create rules</div>
                      <div className="text-[11px] text-muted-foreground">
                        Automatically generate rules from repeated categorization decisions
                      </div>
                    </div>

                    <button
                      type="button"
                      className={`h-5 w-9 rounded-full relative transition ${
                        aiAutoRules ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                      onClick={() => setAiAutoRules((v) => !v)}
                      aria-label="Toggle auto-create rules"
                      title="Coming soon"
                    >
                      <span
                        className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition"
                        style={{ left: aiAutoRules ? 18 : 2 }}
                      />
                    </button>
                  </div>

                  <div className="text-[11px] text-muted-foreground">
                    Phase 3: toggles are UI-only. We’ll wire persistence and automation jobs in Phase 4+.
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        }

        if (tab === "billing") {
          return (
            <div className="space-y-4">
              <Card>
                <CardHeader className="space-y-0 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle>Billing & Activity</CardTitle>
                      <div className="mt-1 text-xs text-muted-foreground">
                        View plan details and recent account activity
                      </div>
                    </div>

                    <Button size="sm" variant="outline" disabled title="Manage billing (coming soon)">
                      Manage billing
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Plan */}
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-slate-800">Current plan</div>
                        <div className="text-[11px] text-muted-foreground">Plan management is coming soon</div>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                        Free (Phase 3)
                      </span>
                    </div>
                  </div>

                  {/* Activity log shell */}
                  <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                      <div className="text-xs font-medium text-slate-700">Recent activity</div>
                    </div>
                    <div className="px-3 py-3 text-[11px] text-muted-foreground">
                      Activity log will appear here once backend events are enabled.
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        }

        return (
          <Card>
            <CardHeader>
              <CardTitle>
                {tab === "business" && "Business Profile"}
                {tab === "categories" && "Categories"}
                {tab === "ai" && "AI & Automation"}
                {tab === "billing" && "Billing & Activity"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Phase 3 shell. UI only.
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
