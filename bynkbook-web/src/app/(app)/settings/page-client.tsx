"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, fetchUserAttributes, signOut } from "aws-amplify/auth";
import { useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { patchBusiness, deleteBusiness, type Business } from "@/lib/api/businesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import {
  createAccount,
  patchAccount,
  archiveAccount,
  unarchiveAccount,
  getAccountDeleteEligibility,
  deleteAccount,
  type Account,
  type AccountType,
} from "@/lib/api/accounts";
import { plaidStatus, plaidDisconnect } from "@/lib/api/plaid";
import { PlaidConnectButton } from "@/components/plaid/PlaidConnectButton";
import { getTeam, createInvite, revokeInvite, updateMemberRole, removeMember, type TeamInvite, type TeamMember } from "@/lib/api/team";
import { getRolePolicies, upsertRolePolicy, type RolePolicyRow } from "@/lib/api/rolePolicies";
import { getActivity, type ActivityLogItem } from "@/lib/api/activity";

import { HintWrap } from "@/components/primitives/HintWrap";
import { canWriteByRolePolicy } from "@/lib/auth/permissionHints";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader as THead, TableRow } from "@/components/ui/table";
import { Settings, Pencil, Archive, Trash2, UploadCloud } from "lucide-react";
import { inputH7, selectTriggerClass } from "@/components/primitives/tokens";
import { useUploadController } from "@/components/uploads/useUploadController";

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

function roleLabel(role?: string | null) {
  const r = String(role ?? "").toUpperCase();
  switch (r) {
    case "OWNER": return "Owner";
    case "ADMIN": return "Admin";
    case "BOOKKEEPER": return "Bookkeeper";
    case "ACCOUNTANT": return "Accountant";
    case "MEMBER": return "Member";
    default: return r ? r.charAt(0) + r.slice(1).toLowerCase() : "—";
  }
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

  // Keep Settings URL consistent with the selected business (one-shot sync; no loops)
  const didSyncBizRef = useRef(false);
  useEffect(() => {
    if (didSyncBizRef.current) return;
    if (businessesQ.isLoading) return;

    const list = businessesQ.data ?? [];
    const firstId = list[0]?.id ?? null;
    if (!firstId) return;

    if (bizIdFromUrl) {
      didSyncBizRef.current = true;
      return;
    }

    const params = new URLSearchParams(String(sp));
    params.set("businessId", firstId);
    params.delete("businessesId");
    router.replace(`?${params.toString()}`);
    didSyncBizRef.current = true;
  }, [bizIdFromUrl, businessesQ.isLoading, businessesQ.data, router, sp]);

  const accountsQ = useAccounts(selectedBusinessId);

  // Plaid status cache (loaded only when Accounts tab is active)
  const [plaidByAccount, setPlaidByAccount] = useState<Record<string, { connected: boolean; institutionName?: string; _error?: boolean }>>({});
  const [plaidLoading, setPlaidLoading] = useState<Record<string, boolean>>({});

  // Delete eligibility cache (LOCK: only show Delete if eligible === true)
  const [deleteEligByAccount, setDeleteEligByAccount] = useState<Record<string, { eligible: boolean; related_total: number }>>({});
  const [deleteEligLoading, setDeleteEligLoading] = useState<Record<string, boolean>>({});

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Edit account dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<AccountType>("CHECKING");
  const [editOpeningBalance, setEditOpeningBalance] = useState("0.00");
  const [editOpeningDate, setEditOpeningDate] = useState(todayYmd());
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  // Team (Phase 6C)
  const selectedBusinessRole = useMemo(() => {
    const list = businessesQ.data ?? [];
    const row = list.find((b) => b.id === selectedBusinessId);
    return String(row?.role ?? "").toUpperCase();
  }, [businessesQ.data, selectedBusinessId]);

    const selectedBusiness = useMemo(() => {
    const list = (businessesQ.data ?? []) as Business[];
    return list.find((b) => b.id === selectedBusinessId) ?? null;
  }, [businessesQ.data, selectedBusinessId]);

  // (moved) canEditBusinessProfile is declared later, after selectedBusinessRole

  const [bpAddress, setBpAddress] = useState("");
  const [bpPhone, setBpPhone] = useState("");
  const [bpIndustry, setBpIndustry] = useState("");
  const [bpIndustryOther, setBpIndustryOther] = useState("");

  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const logoUploader = useUploadController({
    type: "BUSINESS_LOGO",
    ctx: { businessId: selectedBusinessId || undefined },
    meta: {},
  });

  const [logoSaving, setLogoSaving] = useState(false);

  // When a logo upload completes, attach it to the business profile
  useEffect(() => {
    if (!selectedBusinessId) return;
    if (!selectedBusiness) return;

    const completed = (logoUploader.items || []).find((i) => i.status === "COMPLETED" && i.uploadId);
    if (!completed?.uploadId) return;

    // If already set to this upload id, do nothing
    if ((selectedBusiness as any)?.logo_upload_id === completed.uploadId) return;

    (async () => {
      try {
        setLogoSaving(true);
        await patchBusiness(selectedBusinessId, { logo_upload_id: completed.uploadId } as any);
        // Refresh businesses list + selected business view
        await businessesQ.refetch();
      } finally {
        setLogoSaving(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoUploader.items, selectedBusinessId]);
  const [bpCurrency, setBpCurrency] = useState("USD");
  const [bpTimezone, setBpTimezone] = useState("America/Chicago");
  const [bpFiscalMonth, setBpFiscalMonth] = useState("1");
  const [bpSaving, setBpSaving] = useState(false);
  const [bpMsg, setBpMsg] = useState<string | null>(null);

  // Hydrate form when business changes/loads
  useEffect(() => {
    const b = selectedBusiness as any;
    if (!b) return;
    setBpAddress(String(b.address ?? ""));
    setBpPhone(String(b.phone ?? ""));
    const ind = String(b.industry ?? "");
    // If it matches our presets, store as-is; otherwise treat as "Other"
    const presets = new Set([
      "Accounting",
      "Construction",
      "E-commerce",
      "Food & Beverage",
      "Healthcare",
      "Home Services",
      "Legal",
      "Logistics",
      "Manufacturing",
      "Real Estate",
      "Retail",
      "SaaS / Technology",
      "Transportation",
      "Other",
    ]);
    if (!ind) {
      setBpIndustry("");
      setBpIndustryOther("");
    } else if (presets.has(ind)) {
      setBpIndustry(ind);
      setBpIndustryOther("");
    } else {
      setBpIndustry("Other");
      setBpIndustryOther(ind);
    }
    setBpCurrency(String(b.currency ?? "USD"));
    setBpTimezone(String(b.timezone ?? "America/Chicago"));
    setBpFiscalMonth(String(b.fiscal_year_start_month ?? 1));
  }, [selectedBusinessId, selectedBusiness]);

  const noPermTitle = "Insufficient permissions";
  const policyDeniedTitle = "Not allowed by role policy";

const canWriteTeamAllowlist = useMemo(
  () => ["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"].includes(selectedBusinessRole),
  [selectedBusinessRole]
);

// Stage 1 rule: only OWNER/ADMIN can change member roles
const canManageMemberRolesAllowlist = useMemo(
  () => ["OWNER", "ADMIN"].includes(selectedBusinessRole),
  [selectedBusinessRole]
);

const isOwnerRole = useMemo(() => selectedBusinessRole === "OWNER", [selectedBusinessRole]);
const canEditBusinessProfile = useMemo(
  () => ["OWNER", "ADMIN"].includes(selectedBusinessRole),
  [selectedBusinessRole]
);

  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamInvites, setTeamInvites] = useState<TeamInvite[]>([]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MEMBER");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  // Standard control sizing for Settings: use shared tokens (inputH7 / selectTriggerClass)

  // Team sub-tab
  const [teamSubTab, setTeamSubTab] = useState<"members" | "roles">("members");

// Role Policies (store-only, not enforced yet) — view-only in S1
  const [polLoading, setPolLoading] = useState(false);
  const [polError, setPolError] = useState<string | null>(null);
  const [polMsg, setPolMsg] = useState<string | null>(null);
  const [polRows, setPolRows] = useState<RolePolicyRow[]>([]);

  // Activity Log (Phase 6D)
  const [actLoading, setActLoading] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [actItems, setActItems] = useState<ActivityLogItem[]>([]);
  const [actEventType, setActEventType] = useState<string>("ALL"); // optional filter
  const [actDetailsId, setActDetailsId] = useState<string | null>(null);
  const [actBefore, setActBefore] = useState<string | null>(null);

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

  // Hide non-functional tabs completely (no placeholder UI allowed).
  // IMPORTANT: must be top-level (hooks cannot run inside render-time IIFEs).
  useEffect(() => {
    const rawTab = sp.get("tab") || "business";
    if (rawTab !== "ai" && rawTab !== "billing") return;

    const params = new URLSearchParams(String(sp));
    params.set("tab", "business");
    router.replace(`?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, router]);

  // Load activity when Activity tab is active
  useEffect(() => {
    const tab = sp.get("tab") || "business";
    if (tab !== "activity") return;
    if (!authReady) return;
    if (!selectedBusinessId) return;

    let cancelled = false;
    (async () => {
      setActLoading(true);
      setActError(null);
      try {
        const res: any = await getActivity(selectedBusinessId, {
          limit: 50,
          before: undefined,
          eventType: actEventType === "ALL" ? undefined : actEventType,
        });
        if (!cancelled) {
          const items: ActivityLogItem[] = res?.items ?? [];
          setActItems(items);
          setActBefore(items.length > 0 ? String(items[items.length - 1].created_at) : null);
        }
      } catch (e: any) {
        if (!cancelled) setActError(e?.message ?? "Failed to load activity");
      } finally {
        if (!cancelled) setActLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sp, authReady, selectedBusinessId, actEventType]);

  // Load team data when Team tab is active
  useEffect(() => {
    const tab = sp.get("tab") || "business";
    if (tab !== "team") return;
    if (!authReady) return;
    if (!selectedBusinessId) return;

    let cancelled = false;
    (async () => {
      setTeamLoading(true);
      setTeamError(null);
      try {
        const res = await getTeam(selectedBusinessId);
        if (!cancelled) {
          setTeamMembers(res.members ?? []);
          setTeamInvites(res.invites ?? []);
        }
      } catch (e: any) {
        if (!cancelled) setTeamError(e?.message ?? "Failed to load team");
      } finally {
        if (!cancelled) setTeamLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sp, authReady, selectedBusinessId]);

  // Load plaid status when Accounts tab is active (instant-fast; cached)
  useEffect(() => {
    const tab = sp.get("tab") || "business";
    if (tab !== "accounts") return;
    if (!authReady) return;
    if (!selectedBusinessId) return;
    if (accountsQ.isLoading) return;

    const list = accountsQ.data ?? [];
    if (list.length === 0) return;

    let cancelled = false;

    (async () => {
      // Only fetch for accounts we haven't cached yet
      const toFetch = list.filter((a) => plaidByAccount[a.id] == null && !plaidLoading[a.id]);
      if (toFetch.length === 0) return;

      // mark loading
      setPlaidLoading((cur) => {
        const next = { ...cur };
        for (const a of toFetch) next[a.id] = true;
        return next;
      });

      try {
        const results = await Promise.all(
          toFetch.map(async (a) => {
            try {
              const res: any = await plaidStatus(selectedBusinessId, a.id);
              const connected = !!res?.connected;
              const institutionName = res?.institution?.name ?? res?.institution_name ?? undefined;
              return { id: a.id, connected, institutionName };
            } catch (e: any) {
              // If status fails, mark unknown but ensure we *finish* and render something
              return { id: a.id, connected: false as const, institutionName: undefined, _error: true as const };
            }
          })
        );

        if (cancelled) return;

        setPlaidByAccount((cur) => {
          const next = { ...cur };
          for (const r of results as any[]) {
            next[r.id] = {
              connected: !!r.connected,
              institutionName: r.institutionName,
              // keep an error hint so UI can show "Unknown" instead of infinite loading
              _error: !!r._error,
            } as any;
          }
          return next;
        });
      } finally {
        if (!cancelled) {
          setPlaidLoading((cur) => {
            const next = { ...cur };
            for (const a of toFetch) delete next[a.id];
            return next;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sp, authReady, selectedBusinessId, accountsQ.isLoading, accountsQ.data, plaidByAccount, plaidLoading]);

  // Load delete eligibility when Accounts tab is active (cached)
  useEffect(() => {
    const tab = sp.get("tab") || "business";
    if (tab !== "accounts") return;
    if (!authReady) return;
    if (!selectedBusinessId) return;
    if (accountsQ.isLoading) return;

    const list = accountsQ.data ?? [];
    if (list.length === 0) return;

    let cancelled = false;
    (async () => {
      const toFetch = list.filter((a) => deleteEligByAccount[a.id] == null && !deleteEligLoading[a.id]);
      if (toFetch.length === 0) return;

      setDeleteEligLoading((cur) => {
        const next = { ...cur };
        for (const a of toFetch) next[a.id] = true;
        return next;
      });

      try {
        const results = await Promise.all(
          toFetch.map(async (a) => {
            try {
              const res = await getAccountDeleteEligibility(selectedBusinessId, a.id);
              return { id: a.id, ...res };
            } catch {
              // If the check fails, treat as not eligible and keep delete hidden
              return { id: a.id, eligible: false, related_total: 1 };
            }
          })
        );

        if (cancelled) return;
        setDeleteEligByAccount((cur) => {
          const next = { ...cur };
          for (const r of results) next[r.id] = { eligible: r.eligible, related_total: r.related_total };
          return next;
        });
      } finally {
        if (!cancelled) {
          setDeleteEligLoading((cur) => {
            const next = { ...cur };
            for (const a of toFetch) delete next[a.id];
            return next;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sp, authReady, selectedBusinessId, accountsQ.isLoading, accountsQ.data, deleteEligByAccount, deleteEligLoading]);

  // Load role policies when Team tab is active (members or roles)
  // - Needed for Phase 7.2B permission hints
  // - Also reused for Roles & Permissions editor when teamSubTab === "roles"
  useEffect(() => {
    const tab = sp.get("tab") || "business";
    if (tab !== "team") return;
    if (!authReady) return;
    if (!selectedBusinessId) return;

    let cancelled = false;
    (async () => {
      setPolLoading(true);
      setPolError(null);
      setPolMsg(null);
      try {
        const res: any = await getRolePolicies(selectedBusinessId);
        const items: RolePolicyRow[] = res?.items ?? [];
        if (!cancelled) {
          setPolRows(items);

          // S1 LOCK: view-only (store-only). No draft/edit state, no upserts.

        }
      } catch (e: any) {
        if (!cancelled) setPolError(e?.message ?? "Failed to load role policies");
      } finally {
        if (!cancelled) setPolLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sp, teamSubTab, authReady, selectedBusinessId]);

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [currentUserEmail, setCurrentUserEmail] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        // Prefer Cognito attributes (email/name) — much more reliable than username/sub.
        const attrs: any = await fetchUserAttributes();
        const email = String(attrs?.email || "").trim();
        const name =
          String(attrs?.name || "").trim() ||
          [attrs?.given_name, attrs?.family_name].filter(Boolean).join(" ").trim();

        setCurrentUserEmail(email);
        setCurrentUserName(name || "");
      } catch {
        // Fallback: at least avoid showing a raw id as "email"
        try {
          const u: any = await getCurrentUser();
          const fallbackEmail = String(u?.signInDetails?.loginId || "").trim();
          setCurrentUserEmail(fallbackEmail);
          setCurrentUserName("");
        } catch {
          setCurrentUserName("");
          setCurrentUserEmail("");
        }
      }
    })();
  }, []);

  // Role is derived from team membership when possible; fallback to empty.
  const currentUserRole =
    (teamMembers || []).find((m: any) => String(m?.email || "").toLowerCase() === String(currentUserEmail || "").toLowerCase())
      ?.role || "";

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
              { key: "team", label: "Team" },
              { key: "activity", label: "Activity Log" },
              { key: "bookkeeping", label: "Bookkeeping" },
              { key: "accounts", label: "Accounts" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  const params = new URLSearchParams(String(sp));
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

        // Hide non-functional tabs completely (no placeholder UI allowed)
        const normalizedTab =
          rawTab === "ai" || rawTab === "billing"
            ? "business"
            : rawTab === "categories"
              ? "bookkeeping"
              : rawTab;

        const tab = normalizedTab;

        if (tab === "activity") {
          const humanize = (t: string) => {
            return String(t ?? "")
              .replace(/_/g, " ")
              .toLowerCase()
              .replace(/\b\w/g, (c) => c.toUpperCase());
          };

          return (
            <div className="space-y-4">
              <Card>
                <CardHeader className="space-y-0 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle>Activity Log</CardTitle>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Business-scoped audit trail (read-only for members).
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-[260px]">
                      <Label className="text-[11px]">Event type (optional)</Label>
                      <Select value={actEventType} onValueChange={(v) => setActEventType(v)}>
                        <SelectTrigger className={selectTriggerClass}>
                          <SelectValue placeholder="All events" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All</SelectItem>
                          <SelectItem value="TEAM_INVITE_CREATED">Team invite created</SelectItem>
                          <SelectItem value="TEAM_INVITE_REVOKED">Team invite revoked</SelectItem>
                          <SelectItem value="TEAM_INVITE_ACCEPTED">Team invite accepted</SelectItem>
                          <SelectItem value="TEAM_ROLE_CHANGED">Team role changed</SelectItem>
                          <SelectItem value="TEAM_MEMBER_REMOVED">Team member removed</SelectItem>
                          <SelectItem value="ROLE_POLICY_UPDATED">Role policy updated</SelectItem>
                          <SelectItem value="RECONCILE_MATCH_CREATED">Reconcile match created</SelectItem>
                          <SelectItem value="RECONCILE_MATCH_VOIDED">Reconcile match voided</SelectItem>
                          <SelectItem value="RECONCILE_ENTRY_ADJUSTMENT_MARKED">Entry adjustment marked</SelectItem>
                          <SelectItem value="RECONCILE_ENTRY_ADJUSTMENT_UNMARKED">Entry adjustment unmarked</SelectItem>
                          <SelectItem value="RECONCILE_SNAPSHOT_CREATED">Snapshot created</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex-1" />
                    <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                      Read-only
                    </span>
                  </div>

                  {actLoading ? (
                    <Skeleton className="h-24 w-full" />
                  ) : actError ? (
                    <div className="text-xs text-red-600">{actError}</div>
                  ) : actItems.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      No activity yet. Actions recorded after Phase 6D deploy will appear here.
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <Table>
                        <THead className="bg-slate-50">
                          <TableRow className="hover:bg-slate-50">
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">When</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Event</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Actor</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Account</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Details</TableHead>
                          </TableRow>
                        </THead>

                        <TableBody>
                          {actItems.map((it) => {
                            const when = (() => {
                              try {
                                return new Date(it.created_at).toLocaleString();
                              } catch {
                                return String(it.created_at);
                              }
                            })();

                            return (
                              <TableRow key={it.id} className="hover:bg-slate-50">
                                <TableCell className="py-2 text-slate-700 text-xs whitespace-nowrap">{when}</TableCell>
                                <TableCell className="py-2 text-slate-900 text-xs font-medium">{humanize(it.event_type)}</TableCell>
                                <TableCell className="py-2 text-slate-700 text-xs font-mono">{String(it.actor_user_id).slice(0, 12)}…</TableCell>
                                <TableCell className="py-2 text-slate-700 text-xs font-mono">
                                  {it.scope_account_id ? String(it.scope_account_id).slice(0, 12) + "…" : "—"}
                                </TableCell>
                                <TableCell className="py-2 text-right">
                                  <button
                                    type="button"
                                    className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 focus-visible:ring-offset-0"
                                    onClick={() => setActDetailsId((cur) => (cur === it.id ? null : it.id))}
                                  >
                                    {actDetailsId === it.id ? "Hide" : "View"}
                                  </button>
                                </TableCell>
                              </TableRow>
                            );
                          })}

                          {actDetailsId ? (
                            <TableRow className="bg-slate-50">
                              <TableCell colSpan={5} className="py-2">
                                <pre className="text-[11px] whitespace-pre-wrap break-words bg-white border border-slate-200 rounded-md p-2">
{JSON.stringify(actItems.find((x) => x.id === actDetailsId)?.payload_json ?? {}, null, 2)}
                                </pre>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        }

        if (tab === "team") {
          const policyTeamWrite = canWriteByRolePolicy(polRows, selectedBusinessRole, "team_management");
          const canWriteTeam = canWriteTeamAllowlist && (policyTeamWrite === null ? true : policyTeamWrite);

          // Stage 1: only OWNER/ADMIN can change member roles (and still subject to policy if present)
          const policyManageMemberRoles = canWriteByRolePolicy(polRows, selectedBusinessRole, "team_management");
          const canManageMemberRoles = canManageMemberRolesAllowlist && (policyManageMemberRoles === null ? true : policyManageMemberRoles);

          const noPerm =
            !canWriteTeamAllowlist ? noPermTitle :
            policyTeamWrite === false ? policyDeniedTitle :
            noPermTitle; // fallback (shouldn't be used when allowed)

          return (
            <div className="space-y-4">
              <Card>
                <CardHeader className="space-y-0 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle>Team</CardTitle>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Manage members, roles, and pending invites.
                      </div>
                    </div>

                    <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                      Role: {roleLabel(selectedBusinessRole)}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Team sub-tabs */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={`h-7 px-3 rounded-md text-xs font-medium transition ${
                          teamSubTab === "members" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                        }`}
                        onClick={() => setTeamSubTab("members")}
                      >
                        Team Members
                      </button>

                      <button
                        type="button"
                        className={`h-7 px-3 rounded-md text-xs font-medium transition ${
                          teamSubTab === "roles" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                        }`}
                        onClick={() => setTeamSubTab("roles")}
                      >
                        Roles & Permissions
                      </button>
                    </div>

                    <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                      Not enforced yet
                    </span>
                  </div>

                  {teamSubTab === "members" ? (
                    <>
                      {/* Invite */}
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs font-medium text-slate-800">Invite member</div>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div className="md:col-span-2">
                        <Label className="text-[11px]">Email</Label>
                        <Input className={inputH7} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@example.com" />
                      </div>
                      <div>
                        <Label className="text-[11px]">Role</Label>
                        <Select value={inviteRole} onValueChange={(v) => setInviteRole(v)}>
                          <SelectTrigger className={selectTriggerClass}>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MEMBER">Member</SelectItem>
                            <SelectItem value="ACCOUNTANT">Accountant</SelectItem>
                            <SelectItem value="BOOKKEEPER">Bookkeeper</SelectItem>
                            <SelectItem value="ADMIN">Admin</SelectItem>
                            <SelectItem value="OWNER" disabled={!isOwnerRole}>Owner</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <HintWrap disabled={!canWriteTeam} reason={!canWriteTeam ? (!canWriteTeamAllowlist ? noPermTitle : policyDeniedTitle) : null}>
                        <Button
                          className="h-7 px-2 text-xs"
                          onClick={async () => {
                          if (!selectedBusinessId) return;
                          setInviteBusy(true);
                          setInviteMsg(null);
                          setInviteToken(null);
                          try {
                            const inv = await createInvite(selectedBusinessId, inviteEmail, inviteRole);
                            setInviteToken(inv?.token ?? null);
                            setInviteMsg("Invite created.");
                            const res = await getTeam(selectedBusinessId);
                            setTeamMembers(res.members ?? []);
                            setTeamInvites(res.invites ?? []);
                          } catch (e: any) {
                            const msg = e?.message ?? "Failed to create invite";
                            setInviteMsg(msg);
                          } finally {
                            setInviteBusy(false);
                          }
                        }}
                        disabled={!canWriteTeam || inviteBusy || !inviteEmail.trim()}
                        title={!canWriteTeam ? (!canWriteTeamAllowlist ? noPermTitle : policyDeniedTitle) : "Create invite"}
                      >
                        {inviteBusy ? "Creating…" : "Create invite"}
                      </Button>
                      </HintWrap>

                      {inviteToken ? (
                        <Button
                          className="h-7 px-2 text-xs"
                          variant="outline"
                          onClick={() => {
                            const url = `${window.location.origin}/accept-invite?token=${encodeURIComponent(inviteToken)}`;
                            navigator.clipboard.writeText(url);
                            setInviteMsg("Invite link copied.");
                          }}
                        >
                          Copy invite link
                        </Button>
                      ) : null}
                    </div>

                    {inviteToken ? (
                      <div className="mt-2 text-[11px] text-slate-600 break-all">
                        Link: {`${typeof window !== "undefined" ? window.location.origin : ""}/accept-invite?token=${inviteToken}`}
                      </div>
                    ) : null}

                    {inviteMsg ? (
                      <div className="mt-2 text-xs text-slate-700">{inviteMsg}</div>
                    ) : null}
                  </div>

                  {/* Pending invites */}
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                      <div className="text-xs font-medium text-slate-700">Pending invites</div>
                    </div>

                    {teamLoading ? (
                      <div className="p-3"><Skeleton className="h-20 w-full" /></div>
                    ) : teamError ? (
                      <div className="p-3 text-xs text-red-600">{teamError}</div>
                    ) : teamInvites.length === 0 ? (
                      <div className="p-3 text-xs text-muted-foreground">No pending invites.</div>
                    ) : (
                      <Table>
                        <THead className="bg-slate-50">
                          <TableRow className="hover:bg-slate-50">
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Email</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Role</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Expires</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Actions</TableHead>
                          </TableRow>
                        </THead>
                        <TableBody>
                          {teamInvites.map((i) => (
                            <TableRow key={i.id} className="hover:bg-slate-50">
                              <TableCell className="py-2 font-medium text-slate-900">{i.email}</TableCell>
                              <TableCell className="py-2 text-slate-700">{i.role}</TableCell>
                              <TableCell className="py-2 text-slate-700">{formatShortDate(i.expires_at)}</TableCell>
                              <TableCell className="py-2 text-right">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    className="h-7 px-2 text-xs"
                                    variant="outline"
                                    onClick={() => {
                                      const url = `${window.location.origin}/accept-invite?token=${encodeURIComponent((i as any).token ?? "")}`;
                                      if ((i as any).token) navigator.clipboard.writeText(url);
                                    }}
                                    disabled={!canWriteTeam || !(i as any).token}
                                    title={!canWriteTeam ? noPerm : "Copy link (token returned on create only)"}
                                  >
                                    Copy
                                  </Button>

                                  <HintWrap disabled={!canWriteTeam} reason={!canWriteTeam ? (!canWriteTeamAllowlist ? noPermTitle : policyDeniedTitle) : null}>
                                    <Button
                                      className="h-7 px-2 text-xs"
                                      variant="outline"
                                      onClick={async () => {
                                      if (!selectedBusinessId) return;
                                      await revokeInvite(selectedBusinessId, i.id);
                                      const res = await getTeam(selectedBusinessId);
                                      setTeamMembers(res.members ?? []);
                                      setTeamInvites(res.invites ?? []);
                                    }}
                                    disabled={!canWriteTeam}
                                    title={!canWriteTeam ? (!canWriteTeamAllowlist ? noPermTitle : policyDeniedTitle) : "Revoke invite"}
                                  >
                                    Revoke
                                  </Button>
                                  </HintWrap>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>

                  {/* Members */}
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                      <div className="text-xs font-medium text-slate-700">Members</div>
                    </div>

                    {teamLoading ? (
                      <div className="p-3"><Skeleton className="h-20 w-full" /></div>
                    ) : teamError ? (
                      <div className="p-3 text-xs text-red-600">{teamError}</div>
                    ) : (
                      <Table>
                        <THead className="bg-slate-50">
                          <TableRow className="hover:bg-slate-50">
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Email</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Role</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Added</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Actions</TableHead>
                          </TableRow>
                        </THead>
                        <TableBody>
                          {teamMembers.map((m) => {
                            const targetIsOwner = String(m.role).toUpperCase() === "OWNER";
                            const disableOwnerActions = targetIsOwner && !isOwnerRole;

                            return (
                              <TableRow key={m.user_id} className="hover:bg-slate-50">
                                <TableCell className="py-2 font-medium text-slate-900">
                                  <span
                                    title={(m as any).email ? String((m as any).email) : String(m.user_id)}
                                    className="inline-flex items-center rounded-md bg-slate-50 border border-slate-200 px-2 py-1 text-xs text-slate-800"
                                  >
                                    {(m as any).email ? String((m as any).email) : `User ID • ${String(m.user_id).slice(0, 8)}…`}
                                  </span>
                                </TableCell>
                                <TableCell className="py-2 text-slate-700">
                                  <HintWrap
                                    disabled={!canManageMemberRoles}
                                    reason={
                                      !canManageMemberRoles
                                        ? (!canManageMemberRolesAllowlist ? "Only Owner/Admin can change roles" : policyDeniedTitle)
                                        : null
                                    }
                                    className="inline-flex"
                                  >
                                    <Select
                                      value={m.role}
                                      onValueChange={async (v) => {
                                        if (!selectedBusinessId) return;
                                        await updateMemberRole(selectedBusinessId, m.user_id, v);
                                        const res = await getTeam(selectedBusinessId);
                                        setTeamMembers(res.members ?? []);
                                        setTeamInvites(res.invites ?? []);
                                      }}
                                      disabled={!canManageMemberRoles || disableOwnerActions}
                                    >
                                      <SelectTrigger
                                        className={`${selectTriggerClass} w-40`}
                                        title={
                                          !canManageMemberRoles
                                            ? (!canManageMemberRolesAllowlist ? "Only Owner/Admin can change roles" : policyDeniedTitle)
                                            : disableOwnerActions
                                              ? "Only Owner can change an Owner"
                                              : "Change role"
                                        }
                                      >
                                        <SelectValue />
                                      </SelectTrigger>

                                      <SelectContent>
                                        <SelectItem value="MEMBER">Member</SelectItem>
                                        <SelectItem value="ACCOUNTANT">Accountant</SelectItem>
                                        <SelectItem value="BOOKKEEPER">Bookkeeper</SelectItem>
                                        <SelectItem value="ADMIN">Admin</SelectItem>
                                        <SelectItem value="OWNER" disabled={!isOwnerRole}>
                                          Owner
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </HintWrap>
                                </TableCell>
                                <TableCell className="py-2 text-slate-700">{formatShortDate(m.created_at)}</TableCell>
                                <TableCell className="py-2 text-right">
                                  <HintWrap disabled={!canWriteTeam} reason={!canWriteTeam ? (!canWriteTeamAllowlist ? noPermTitle : policyDeniedTitle) : null}>
                                    <Button
                                      className="h-7 px-2 text-xs"
                                      variant="outline"
                                      onClick={async () => {
                                      if (!selectedBusinessId) return;
                                      await removeMember(selectedBusinessId, m.user_id);
                                      const res = await getTeam(selectedBusinessId);
                                      setTeamMembers(res.members ?? []);
                                      setTeamInvites(res.invites ?? []);
                                    }}
                                    disabled={!canWriteTeam || disableOwnerActions}
                                    title={!canWriteTeam ? (!canWriteTeamAllowlist ? noPermTitle : policyDeniedTitle) : disableOwnerActions ? "Only OWNER can remove an OWNER" : "Remove member"}
                                  >
                                    Remove
                                  </Button>
                                  </HintWrap>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>

                      <div className="text-[11px] text-muted-foreground">
                        Guardrails: last OWNER cannot be removed/downgraded; only OWNER can promote/remove an OWNER.
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-medium text-slate-800">Roles & Permissions</div>
                            <div className="text-[11px] text-muted-foreground">
                              Store-only. These settings are not enforced yet.
                            </div>
                          </div>

                          <span
                            className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium"
                            title="View-only in S1"
                          >
                            View-only (S1)
                          </span>
                        </div>

                        {polLoading ? <div className="mt-3"><Skeleton className="h-20 w-full" /></div> : null}
                        {polError ? <div className="mt-3 text-xs text-red-600">{polError}</div> : null}
                        {polMsg ? <div className="mt-3 text-xs text-slate-700">{polMsg}</div> : null}
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                          <div className="text-xs font-medium text-slate-700">Permissions matrix (store-only)</div>
                        </div>

                        <Table>
                          <THead className="bg-slate-50">
                            <TableRow className="hover:bg-slate-50">
                              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Feature</TableHead>
                              {["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT", "MEMBER"].map((r) => (
                                <TableHead key={r} className="text-[11px] uppercase tracking-wide text-slate-500 text-center">
                                  {r}
                                </TableHead>
                              ))}
                            </TableRow>
                          </THead>

                          <TableBody>
                            {[
                              ["dashboard", "Dashboard"],
                              ["ledger", "Ledger"],
                              ["reconcile", "Reconcile"],
                              ["issues", "Issues"],
                              ["vendors", "Vendors"],
                              ["invoices", "Invoices"],
                              ["reports", "Reports"],
                              ["settings", "Settings"],
                              ["bank_connections", "Bank Connections"],
                              ["team_management", "Team Management"],
                              ["billing", "Billing"],
                              ["ai_automation", "AI & Automation"],
                            ].map(([key, label]) => (
                              <TableRow key={key} className="hover:bg-slate-50">
                                <TableCell className="py-2 font-medium text-slate-900">{label}</TableCell>

                                {["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT", "MEMBER"].map((r) => {
                                  const row = polRows.find((x) => String(x.role).toUpperCase() === r);
                                  const value = String((row?.policy_json as any)?.[key] ?? "NONE").toUpperCase();

                                  const label = value === "FULL" ? "Full" : value === "VIEW" ? "View" : "None";
                                  const cls =
                                    value === "FULL"
                                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                      : value === "VIEW"
                                        ? "bg-slate-50 text-slate-800 border-slate-200"
                                        : "bg-slate-50 text-slate-500 border-slate-200";

                                  return (
                                    <TableCell key={r} className="py-2 text-center">
                                      {isOwnerRole ? (
                                        <Select
                                          value={value}
                                          onValueChange={async (nextVal) => {
                                            if (!selectedBusinessId) return;

                                            // optimistic update
                                            const prevRows = polRows;
                                            setPolRows((cur) => {
                                              const out = [...cur];
                                              const idx = out.findIndex((x) => String(x.role).toUpperCase() === r);
                                              const base =
                                                idx >= 0
                                                  ? (out[idx].policy_json as any)
                                                  : {
                                                      dashboard: "NONE",
                                                      ledger: "NONE",
                                                      reconcile: "NONE",
                                                      issues: "NONE",
                                                      vendors: "NONE",
                                                      invoices: "NONE",
                                                      reports: "NONE",
                                                      settings: "NONE",
                                                      bank_connections: "NONE",
                                                      team_management: "NONE",
                                                      billing: "NONE",
                                                      ai_automation: "NONE",
                                                    };

                                              const nextPolicy = { ...base, [key]: String(nextVal).toUpperCase() };

                                              if (idx >= 0) {
                                                out[idx] = { ...out[idx], policy_json: nextPolicy } as any;
                                              } else {
                                                out.push({
                                                  role: r,
                                                  policy_json: nextPolicy,
                                                  updated_at: new Date().toISOString(),
                                                  updated_by_user_id: "me",
                                                } as any);
                                              }
                                              return out;
                                            });

                                            try {
                                              const res = await upsertRolePolicy(selectedBusinessId, r, {
                                                ...(row?.policy_json as any),
                                                [key]: String(nextVal).toUpperCase(),
                                              });
                                              if (res?.item) {
                                                setPolRows((cur) =>
                                                  cur.map((x) =>
                                                    String(x.role).toUpperCase() === r ? (res.item as any) : x
                                                  )
                                                );
                                              }
                                              setPolMsg("Saved.");
                                            } catch (e: any) {
                                              setPolRows(prevRows);
                                              setPolMsg(e?.message ?? "Save failed");
                                            }
                                          }}
                                        >
                                          <SelectTrigger className={`${selectTriggerClass} h-7 w-[88px] mx-auto`}>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="NONE">None</SelectItem>
                                            <SelectItem value="VIEW">View</SelectItem>
                                            <SelectItem value="FULL">Full</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      ) : (
                                        <span
                                          className={
                                            "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold border " +
                                            cls
                                          }
                                          title="Owner-only"
                                        >
                                          {label}
                                        </span>
                                      )}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>

                        <div className="px-3 py-2 text-[11px] text-muted-foreground border-t border-slate-200">
                          Not enforced yet — existing Phase 6A allowlist rules remain the source of truth.
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        }

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

  <AppDialog
    open={editOpen}
    onClose={() => setEditOpen(false)}
    title="Edit account"
    size="md"
    footer={
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editBusy}>
          Cancel
        </Button>
        <Button
          onClick={async () => {
            if (!selectedBusinessId || !editAccountId) return;

            setEditBusy(true);
            setEditErr(null);

            try {
              const elig = deleteEligByAccount[editAccountId];
              const canEditOpening = !!elig?.eligible;

              const cents = Math.round(Number(editOpeningBalance || "0") * 100);

              const patch: any = {
                name: editName.trim(),
                type: editType,
              };

              if (canEditOpening) {
                patch.opening_balance_cents = cents;
                patch.opening_balance_date = ymdToIso(editOpeningDate);
              }

              await patchAccount(selectedBusinessId, editAccountId, patch);

              qc.invalidateQueries({ queryKey: ["accounts", selectedBusinessId] });
              setEditOpen(false);
            } catch (e: any) {
              setEditErr(e?.message ?? "Save failed");
            } finally {
              setEditBusy(false);
            }
          }}
          disabled={editBusy || !editName.trim()}
        >
          {editBusy ? "Saving…" : "Save"}
        </Button>
      </div>
    }
  >
    <div className="space-y-3">
      {editErr ? <div className="text-sm text-red-600">{editErr}</div> : null}

      <div className="space-y-1">
        <Label>Name</Label>
        <Input className={inputH7} value={editName} onChange={(e) => setEditName(e.target.value)} />
      </div>

      <div className="space-y-1">
        <Label>Type</Label>
        <Select value={editType} onValueChange={(v) => setEditType(v as AccountType)}>
          <SelectTrigger className={selectTriggerClass}>
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

      {(() => {
        const elig = editAccountId ? deleteEligByAccount[editAccountId] : null;
        const canEditOpening = !!elig?.eligible;

        return (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Opening balance</Label>
              <Input
                className={inputH7}
                value={editOpeningBalance}
                onChange={(e) => setEditOpeningBalance(e.target.value)}
                disabled={!canEditOpening}
                title={!canEditOpening ? "Opening fields can only be edited before any related data exists." : "Edit opening balance"}
              />
            </div>

            <div className="space-y-1">
              <Label>Opening date</Label>
              <Input
                className={inputH7}
                type="date"
                value={editOpeningDate}
                onChange={(e) => setEditOpeningDate(e.target.value)}
                disabled={!canEditOpening}
                title={!canEditOpening ? "Opening fields can only be edited before any related data exists." : "Edit opening date"}
              />
            </div>
          </div>
        );
      })()}
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
                          <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Plaid</TableHead>
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

                              {/* Plaid column (real: status + connect dialog + disconnect) */}
                              <TableCell className="py-2 text-right">
                                {(() => {
                                  const st = plaidByAccount[a.id];
                                  const loading = !!plaidLoading[a.id];

                                  if (loading && !st) {
                                    return <span className="text-[11px] text-slate-500">Loading…</span>;
                                  }

                                  if (st && (st as any)._error) {
                                    return (
                                      <div className="flex justify-end">
                                        <button
                                          type="button"
                                          className="h-7 px-2 inline-flex items-center justify-center rounded-md border border-slate-200 text-xs font-medium hover:bg-slate-50"
                                          onClick={() => {
                                            // force refetch by clearing cached status for this account
                                            setPlaidByAccount((cur) => {
                                              const next = { ...cur };
                                              delete (next as any)[a.id];
                                              return next;
                                            });
                                          }}
                                          title="Retry Plaid status"
                                        >
                                          Unknown (Retry)
                                        </button>
                                      </div>
                                    );
                                  }

                                  if (st?.connected) {
                                    return (
                                      <div className="flex justify-end items-center gap-2">
                                        <span
                                          className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-medium"
                                          title={st.institutionName ? st.institutionName : "Connected"}
                                        >
                                          Connected
                                        </span>

                                        {/* Switch = re-run Plaid connect flow for this account */}
                                        <PlaidConnectButton
                                          businessId={selectedBusinessId ?? ""}
                                          accountId={a.id}
                                          effectiveStartDate={todayYmd()}
                                          disabledClassName="opacity-50 cursor-not-allowed"
                                          buttonClassName="h-7 px-2 inline-flex items-center justify-center rounded-md border border-slate-200 text-xs font-medium hover:bg-slate-50"
                                          disabled={!selectedBusinessId}
                                          onConnected={async () => {
                                            if (!selectedBusinessId) return;
                                            try {
                                              const res: any = await plaidStatus(selectedBusinessId, a.id);
                                              setPlaidByAccount((cur) => ({
                                                ...cur,
                                                [a.id]: {
                                                  connected: !!res?.connected,
                                                  institutionName: res?.institution?.name ?? res?.institution_name ?? undefined,
                                                },
                                              }));
                                            } catch {}
                                          }}
                                        />

                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-7 px-2 text-xs"
                                          onClick={async () => {
                                            if (!selectedBusinessId) return;
                                            await plaidDisconnect(selectedBusinessId, a.id);
                                            setPlaidByAccount((cur) => ({
                                              ...cur,
                                              [a.id]: { connected: false },
                                            }));
                                          }}
                                        >
                                          Disconnect
                                        </Button>
                                      </div>
                                    );
                                  }

                                  // Not connected: open Plaid consent/dialog via existing component
                                  return (
                                    <div className="flex justify-end">
                                      <PlaidConnectButton
                                        businessId={selectedBusinessId ?? ""}
                                        accountId={a.id}
                                        effectiveStartDate={todayYmd()}
                                        disabledClassName="opacity-50 cursor-not-allowed"
                                        buttonClassName="h-7 px-2 inline-flex items-center justify-center rounded-md border border-slate-200 text-xs font-medium hover:bg-slate-50"
                                        disabled={!selectedBusinessId}
                                        onConnected={async () => {
                                          if (!selectedBusinessId) return;
                                          // Refresh status after connect/sync
                                          try {
                                            const res: any = await plaidStatus(selectedBusinessId, a.id);
                                            setPlaidByAccount((cur) => ({
                                              ...cur,
                                              [a.id]: {
                                                connected: !!res?.connected,
                                                institutionName: res?.institution?.name ?? res?.institution_name ?? undefined,
                                              },
                                            }));
                                          } catch {
                                            // best effort; UI still works
                                          }
                                        }}
                                      />
                                    </div>
                                  );
                                })()}
                              </TableCell>

                              {/* Actions: Rename / Archive / Delete (Delete only if eligible === true) */}
                              <TableCell className="py-2 text-right">
                                <div className="flex justify-end gap-1">
                                  <button
                                    type="button"
                                    className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                                    title="Edit"
                                    onClick={() => {
                                      setEditAccountId(a.id);
                                      setEditName(a.name);
                                      setEditType(a.type as AccountType);
                                      setEditOpeningBalance(String((Number(a.opening_balance_cents ?? 0) as any) / 100));
                                      setEditOpeningDate(todayYmd());
                                      setEditErr(null);
                                      setEditOpen(true);

                                      try {
                                        const d = new Date(a.opening_balance_date as any);
                                        if (!Number.isNaN(d.getTime())) {
                                          const y = d.getFullYear();
                                          const m = String(d.getMonth() + 1).padStart(2, "0");
                                          const day = String(d.getDate()).padStart(2, "0");
                                          setEditOpeningDate(`${y}-${m}-${day}`);
                                        }
                                      } catch {}
                                    }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>

                                  <button
                                    type="button"
                                    className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                                    title={isArchived ? "Unarchive" : "Archive"}
                                    onClick={async () => {
                                      if (!selectedBusinessId) return;
                                      if (isArchived) await unarchiveAccount(selectedBusinessId, a.id);
                                      else await archiveAccount(selectedBusinessId, a.id);
                                      qc.invalidateQueries({ queryKey: ["accounts", selectedBusinessId] });
                                    }}
                                  >
                                    <Archive className="h-3.5 w-3.5" />
                                  </button>

                                  {(() => {
                                    const elig = deleteEligByAccount[a.id];
                                    if (!elig || !elig.eligible) return null;

                                    return (
                                      <button
                                        type="button"
                                        className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-slate-200 text-rose-600 hover:bg-rose-50"
                                        title="Delete (only allowed when no related rows)"
                                        onClick={async () => {
                                          if (!selectedBusinessId) return;
                                          const ok = window.confirm("Delete this account? This cannot be undone.");
                                          if (!ok) return;
                                          await deleteAccount(selectedBusinessId, a.id);
                                          qc.invalidateQueries({ queryKey: ["accounts", selectedBusinessId] });
                                        }}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    );
                                  })()}
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
                      {roleLabel(currentUserRole)}
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
               {/* Business Profile (real, persisted) */}
               <Card>
                 <CardHeader className="space-y-0 pb-3">
                   <div className="flex items-start justify-between gap-4">
                     <div className="min-w-0">
                       <CardTitle>Business Profile</CardTitle>
                       <div className="mt-1 text-xs text-muted-foreground">
                         Optional profile details (saved)
                       </div>
                     </div>

                     <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                       {canEditBusinessProfile ? "Editable" : "View-only"}
                     </span>
                   </div>
                 </CardHeader>

                 <CardContent className="space-y-3">
                   {bpMsg ? <div className="text-xs text-slate-700">{bpMsg}</div> : null}

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                     <div className="space-y-1">
                       <Label>Business name</Label>
                       <Input className={inputH7} disabled value={selectedBusiness?.name ?? ""} />
                     </div>

                     <div className="space-y-1">
                       <Label>Role</Label>
                       <Input className={inputH7} disabled value={roleLabel(selectedBusinessRole)} />
                     </div>

                     <div className="space-y-1">
                       <Label>Address</Label>
                       <Input
                         className={inputH7}
                         value={bpAddress}
                         onChange={(e) => setBpAddress(e.target.value)}
                         disabled={!canEditBusinessProfile || bpSaving}
                         title={!canEditBusinessProfile ? "Only OWNER/ADMIN can edit business profile" : "Edit address"}
                       />
                     </div>

                     <div className="space-y-1">
                       <Label>Phone</Label>
                       <Input
                         className={inputH7}
                         value={bpPhone}
                         onChange={(e) => setBpPhone(e.target.value)}
                         disabled={!canEditBusinessProfile || bpSaving}
                         title={!canEditBusinessProfile ? "Only OWNER/ADMIN can edit business profile" : "Edit phone"}
                       />
                     </div>

                     <div className="space-y-1">
                       <Label>Industry</Label>

                       <Select
                         value={bpIndustry}
                         onValueChange={(v) => {
                           setBpIndustry(v);
                           if (v !== "Other") setBpIndustryOther("");
                         }}
                         disabled={!canEditBusinessProfile || bpSaving}
                       >
                         <SelectTrigger className={selectTriggerClass}>
                           <SelectValue placeholder="Select industry" />
                         </SelectTrigger>
                         <SelectContent>
                           <SelectItem value="Accounting">Accounting</SelectItem>
                           <SelectItem value="Construction">Construction</SelectItem>
                           <SelectItem value="E-commerce">E-commerce</SelectItem>
                           <SelectItem value="Food & Beverage">Food &amp; Beverage</SelectItem>
                           <SelectItem value="Healthcare">Healthcare</SelectItem>
                           <SelectItem value="Home Services">Home Services</SelectItem>
                           <SelectItem value="Legal">Legal</SelectItem>
                           <SelectItem value="Logistics">Logistics</SelectItem>
                           <SelectItem value="Manufacturing">Manufacturing</SelectItem>
                           <SelectItem value="Real Estate">Real Estate</SelectItem>
                           <SelectItem value="Retail">Retail</SelectItem>
                           <SelectItem value="SaaS / Technology">SaaS / Technology</SelectItem>
                           <SelectItem value="Transportation">Transportation</SelectItem>
                           <SelectItem value="Other">Other</SelectItem>
                         </SelectContent>
                       </Select>

                       {bpIndustry === "Other" ? (
                         <Input
                           className={inputH7}
                           value={bpIndustryOther}
                           onChange={(e) => setBpIndustryOther(e.target.value)}
                           disabled={!canEditBusinessProfile || bpSaving}
                           placeholder="Enter industry…"
                         />
                       ) : null}
                     </div>

                     <div className="space-y-1 md:col-span-2">
                       <Label>Logo</Label>

                       <div className="flex items-center gap-2">
                         <input
                           ref={logoInputRef}
                           type="file"
                           accept="image/*"
                           className="hidden"
                           onChange={(e) => {
                             const file = e.target.files?.[0] || null;
                             if (!file) return;
                             if (!canEditBusinessProfile || bpSaving || logoSaving) return;
                             logoUploader.enqueueAndStart([file]);
                             // allow re-selecting same file later
                             e.currentTarget.value = "";
                           }}
                         />

                         <Button
                           type="button"
                           variant="outline"
                           className="h-7"
                           disabled={!canEditBusinessProfile || bpSaving || logoSaving || logoUploader.hasActiveUploads}
                           title={!canEditBusinessProfile ? "Only OWNER/ADMIN can edit business profile" : "Upload logo"}
                           onClick={() => logoInputRef.current?.click()}
                         >
                           <UploadCloud className="h-4 w-4 mr-2" />
                           {(selectedBusiness as any)?.logo_upload_id ? "Replace logo" : "Upload logo"}
                         </Button>

                         <div className="text-xs text-slate-500">
                           {(selectedBusiness as any)?.logo_upload_id
                             ? "Logo uploaded"
                             : "No logo uploaded"}
                         </div>
                       </div>
                     </div>

                     <div className="space-y-1">
                       <Label>Currency</Label>
                       <Select
                         value={bpCurrency}
                         onValueChange={(v) => setBpCurrency(v)}
                         disabled={!canEditBusinessProfile || bpSaving}
                       >
                         <SelectTrigger
                           className={selectTriggerClass}
                           title={!canEditBusinessProfile ? "Only OWNER/ADMIN can edit business profile" : "Select currency"}
                         >
                           <SelectValue placeholder="Currency" />
                         </SelectTrigger>
                         <SelectContent>
                           <SelectItem value="USD">USD — US Dollar</SelectItem>
                           <SelectItem value="CAD">CAD — Canadian Dollar</SelectItem>
                           <SelectItem value="MXN">MXN — Mexican Peso</SelectItem>
                           <SelectItem value="EUR">EUR — Euro</SelectItem>
                           <SelectItem value="GBP">GBP — British Pound</SelectItem>
                         </SelectContent>
                       </Select>
                     </div>

                     <div className="space-y-1">
                       <Label>Fiscal year start month</Label>
                       <Select
                         value={bpFiscalMonth}
                         onValueChange={(v) => setBpFiscalMonth(v)}
                         disabled={!canEditBusinessProfile || bpSaving}
                       >
                         <SelectTrigger
                           className={selectTriggerClass}
                           title={!canEditBusinessProfile ? "Only OWNER/ADMIN can edit business profile" : "Select month"}
                         >
                           <SelectValue placeholder="Month" />
                         </SelectTrigger>
                         <SelectContent>
                           <SelectItem value="1">January</SelectItem>
                           <SelectItem value="2">February</SelectItem>
                           <SelectItem value="3">March</SelectItem>
                           <SelectItem value="4">April</SelectItem>
                           <SelectItem value="5">May</SelectItem>
                           <SelectItem value="6">June</SelectItem>
                           <SelectItem value="7">July</SelectItem>
                           <SelectItem value="8">August</SelectItem>
                           <SelectItem value="9">September</SelectItem>
                           <SelectItem value="10">October</SelectItem>
                           <SelectItem value="11">November</SelectItem>
                           <SelectItem value="12">December</SelectItem>
                         </SelectContent>
                       </Select>
                     </div>

                     <div className="space-y-1 md:col-span-2">
                       <Label>Timezone</Label>
                       <Select
                         value={bpTimezone}
                         onValueChange={(v) => setBpTimezone(v)}
                         disabled={!canEditBusinessProfile || bpSaving}
                       >
                         <SelectTrigger
                           className={selectTriggerClass}
                           title={!canEditBusinessProfile ? "Only OWNER/ADMIN can edit business profile" : "Select timezone"}
                         >
                           <SelectValue placeholder="Timezone" />
                         </SelectTrigger>
                         <SelectContent>
                           <SelectItem value="America/New_York">America/New_York (ET)</SelectItem>
                           <SelectItem value="America/Chicago">America/Chicago (CT)</SelectItem>
                           <SelectItem value="America/Denver">America/Denver (MT)</SelectItem>
                           <SelectItem value="America/Los_Angeles">America/Los_Angeles (PT)</SelectItem>
                           <SelectItem value="America/Phoenix">America/Phoenix (AZ)</SelectItem>
                         </SelectContent>
                       </Select>
                     </div>
                   </div>

                   <div className="flex items-center justify-between gap-2 pt-1">
                     <div>
                       {isOwnerRole ? (
                         <Button
                           type="button"
                           variant="outline"
                           className="h-7 px-3 text-xs text-rose-600 border-rose-200 hover:bg-rose-50"
                           onClick={async () => {
                             if (!selectedBusinessId) return;
                             const ok = window.confirm(
                               "Delete this business?\n\nThis permanently deletes the business and all related data. This cannot be undone."
                             );
                             if (!ok) return;

                             try {
                               await deleteBusiness(selectedBusinessId);
                               await businessesQ.refetch();

                               const list = businessesQ.data ?? [];
                               const nextId = list.find((b) => b.id !== selectedBusinessId)?.id ?? null;

                               if (nextId) router.replace(`/settings?businessId=${nextId}`);
                               else router.replace("/create-business");
                             } catch (e: any) {
                               alert(e?.message ?? "Delete failed");
                             }
                           }}
                         >
                           Delete business
                         </Button>
                       ) : null}
                     </div>

                     <div className="flex items-center justify-end gap-2">
                       <Button
                         className="h-7 px-3 text-xs"
                         disabled={!canEditBusinessProfile || bpSaving || !selectedBusinessId}
                         onClick={async () => {
                           if (!selectedBusinessId) return;
                           setBpSaving(true);
                           setBpMsg(null);
                           try {
                             await patchBusiness(selectedBusinessId, {
                               address: bpAddress.trim() || null,
                               phone: bpPhone.trim() || null,
                               industry: (bpIndustry === "Other" ? bpIndustryOther.trim() : bpIndustry.trim()) || null,
                               currency: (bpCurrency || "USD").toUpperCase(),
                               timezone: bpTimezone.trim() || "America/Chicago",
                               fiscal_year_start_month: Number(bpFiscalMonth || "1"),
                             });
                             // Refresh businesses cache (single invalidate)
                             qc.invalidateQueries({ queryKey: ["businesses"] });
                             setBpMsg("Saved.");
                           } catch (e: any) {
                             setBpMsg(e?.message ?? "Save failed");
                           } finally {
                             setBpSaving(false);
                           }
                         }}
                         title={!canEditBusinessProfile ? "Only OWNER/ADMIN can edit business profile" : "Save changes"}
                       >
                         {bpSaving ? "Saving…" : "Save changes"}
                       </Button>
                     </div>
                   </div>
                 </CardContent>
               </Card>

              {/* Preferences removed (was placeholder/duplicate timezone). */}
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

                    <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                      Active (local)
                    </span>
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

                    <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                      View-only
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Plan */}
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-slate-800">Current plan</div>
                        <div className="text-[11px] text-muted-foreground">Plan management is not configured yet.</div>
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
                      Activity appears in the Activity Log tab (read-only).
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
