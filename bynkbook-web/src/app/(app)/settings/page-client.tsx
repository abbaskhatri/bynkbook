"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, fetchAuthSession, signOut } from "aws-amplify/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { patchBusiness, deleteBusiness, getBusinessUsage, type Business } from "@/lib/api/businesses";
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
import { plaidStatus, plaidDisconnect, plaidLinkTokenBusiness, plaidCreateAccount } from "@/lib/api/plaid";
import { PlaidConnectButton } from "@/components/plaid/PlaidConnectButton";
import { getTeam, createInvite, revokeInvite, updateMemberRole, removeMember, type TeamInvite, type TeamMember } from "@/lib/api/team";
import { getRolePolicies, upsertRolePolicy, type RolePolicyRow } from "@/lib/api/rolePolicies";
import { getActivity, type ActivityLogItem } from "@/lib/api/activity";
import { listCategories, createCategory, updateCategory, type CategoryRow } from "@/lib/api/categories";

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
import { Settings, Pencil, Archive, Trash2, UploadCloud, Link2Off } from "lucide-react";
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
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
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

type PlaidCellState = {
  connected?: boolean;
  institutionName?: string;
  last4?: string | null;
  status?: string;
  lastSyncAt?: string | null;
  _error?: boolean;
};

export default function SettingsPageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const spKey = sp.toString(); // stable dependency key (prevents dynamic deps array issues)
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

  const selectedBusinessRole = useMemo(() => {
    const list = businessesQ.data ?? [];
    const row = list.find((b) => b.id === selectedBusinessId);
    return String(row?.role ?? "").toUpperCase();
  }, [businessesQ.data, selectedBusinessId]);

  const selectedBusiness = useMemo(() => {
    const list = (businessesQ.data ?? []) as Business[];
    return list.find((b) => b.id === selectedBusinessId) ?? null;
  }, [businessesQ.data, selectedBusinessId]);

  const isOwnerRole = useMemo(() => selectedBusinessRole === "OWNER", [selectedBusinessRole]);
  const canEditBusinessProfile = useMemo(() => ["OWNER", "ADMIN"].includes(selectedBusinessRole), [selectedBusinessRole]);

  const accountsQ = useAccounts(selectedBusinessId);

  const usageQ = useQuery({

    queryKey: ["business-usage", selectedBusinessId],
    enabled: !!selectedBusinessId && authReady,
    queryFn: () => getBusinessUsage(String(selectedBusinessId)),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Plaid status cache (loaded only when Accounts tab is active)
  const [plaidByAccount, setPlaidByAccount] = useState<Record<string, PlaidCellState>>({});
  const [plaidLoading, setPlaidLoading] = useState<Record<string, boolean>>({});
  const [plaidChecked, setPlaidChecked] = useState<Record<string, boolean>>({});

  const institutionSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const a of accountsQ.data ?? []) {
      const manual = String((a as any).institution_name ?? "").trim();
      if (manual) set.add(manual);
      const plaid = String(plaidByAccount[a.id]?.institutionName ?? "").trim();
      if (plaid) set.add(plaid);
    }
    return Array.from(set).sort((x, y) => x.localeCompare(y));
  }, [accountsQ.data, plaidByAccount]);

  // Delete eligibility cache (LOCK: only show Delete if eligible === true)
  const [deleteEligByAccount, setDeleteEligByAccount] = useState<Record<string, { eligible: boolean; related_total: number }>>({});
  const [deleteEligLoading, setDeleteEligLoading] = useState<Record<string, boolean>>({});

  // Bookkeeping: Categories (real, persisted)
  const [catLoading, setCatLoading] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [catShowArchived, setCatShowArchived] = useState(false);
  const [catNewName, setCatNewName] = useState("");

  // Account create/edit dialogs
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Create account wizard
  const [createMode, setCreateMode] = useState<"choose" | "plaid" | "manual">("choose");
  const [plaidReviewOpen, setPlaidReviewOpen] = useState(false);
  const [plaidDraft, setPlaidDraft] = useState<{
    public_token: string;
    institution?: { name?: string; institution_id?: string };
    plaidAccountId: string;
    mask?: string;
    name: string;
    type: string;
    effectiveStartDate: string;
  } | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<AccountType>("CHECKING");
  const [editOpeningBalance, setEditOpeningBalance] = useState("0.00");
  const [editOpeningDate, setEditOpeningDate] = useState(todayYmd());
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  // Business profile form
  const [bpAddress, setBpAddress] = useState("");
  const [bpPhone, setBpPhone] = useState("");
  const [bpIndustry, setBpIndustry] = useState("");
  const [bpIndustryOther, setBpIndustryOther] = useState("");
  const [bpCurrency, setBpCurrency] = useState("USD");
  const [bpTimezone, setBpTimezone] = useState("America/Chicago");
  const [bpFiscalMonth, setBpFiscalMonth] = useState("1");
  const [bpSaving, setBpSaving] = useState(false);
  const [bpMsg, setBpMsg] = useState<string | null>(null);

  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const logoUploader = useUploadController({
    type: "BUSINESS_LOGO",
    ctx: { businessId: selectedBusinessId || undefined },
    meta: {},
  });
  const [logoSaving, setLogoSaving] = useState(false);

  // Hydrate business profile fields when business changes
  useEffect(() => {
    const b = selectedBusiness as any;
    if (!b) return;

    setBpAddress(String(b.address ?? ""));
    setBpPhone(String(b.phone ?? ""));
    const ind = String(b.industry ?? "");

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

  // When a logo upload completes, attach it to the business profile
  useEffect(() => {
    if (!selectedBusinessId) return;
    if (!selectedBusiness) return;

    const completed = (logoUploader.items || []).find((i) => i.status === "COMPLETED" && i.uploadId);
    if (!completed?.uploadId) return;

    if ((selectedBusiness as any)?.logo_upload_id === completed.uploadId) return;

    (async () => {
      try {
        setLogoSaving(true);
        await patchBusiness(selectedBusinessId, { logo_upload_id: completed.uploadId } as any);
        await businessesQ.refetch();
      } finally {
        setLogoSaving(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoUploader.items, selectedBusinessId]);

  // Profile (Google login: use idToken claims)
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [currentUserEmail, setCurrentUserEmail] = useState<string>("");

  useEffect(() => {
    if (!authReady) return;

    (async () => {
      try {
        const u: any = await getCurrentUser();
        const id = String(u?.userId || u?.username || "").trim();
        setCurrentUserId(id);
      } catch {
        setCurrentUserId("");
      }

      try {
        const sess: any = await fetchAuthSession();
        const claims = sess?.tokens?.idToken?.payload ?? {};
        const email = String(claims?.email || "").trim();
        const name =
          String(claims?.name || "").trim() ||
          [claims?.given_name, claims?.family_name].filter(Boolean).join(" ").trim();

        setCurrentUserEmail(email || "");
        setCurrentUserName(name || "");
        return;
      } catch {
        // ignore and continue
      }

      try {
        const u: any = await getCurrentUser();
        const loginId = String(u?.signInDetails?.loginId || "").trim();
        setCurrentUserEmail(loginId.includes("@") ? loginId : "");
        setCurrentUserName("");
      } catch {
        setCurrentUserName("");
        setCurrentUserEmail("");
      }
    })();
  }, [authReady]);

  // Team
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamInvites, setTeamInvites] = useState<TeamInvite[]>([]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MEMBER");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  const [teamSubTab, setTeamSubTab] = useState<"members" | "roles">("members");

  // Role policies
  const [polLoading, setPolLoading] = useState(false);
  const [polError, setPolError] = useState<string | null>(null);
  const [polMsg, setPolMsg] = useState<string | null>(null);
  const [polRows, setPolRows] = useState<RolePolicyRow[]>([]);

  // Activity log
  const [actLoading, setActLoading] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [actItems, setActItems] = useState<ActivityLogItem[]>([]);
  const [actEventType, setActEventType] = useState<string>("ALL");
  const [actDetailsId, setActDetailsId] = useState<string | null>(null);

  const noPermTitle = "Insufficient permissions";
  const policyDeniedTitle = "Not allowed by role policy";

  const canWriteTeamAllowlist = useMemo(
    () => ["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"].includes(selectedBusinessRole),
    [selectedBusinessRole]
  );

  const canManageMemberRolesAllowlist = useMemo(
    () => ["OWNER", "ADMIN"].includes(selectedBusinessRole),
    [selectedBusinessRole]
  );

  // Create account form
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("CHECKING");
  const [openingBalance, setOpeningBalance] = useState("0.00");
  const [openingDate, setOpeningDate] = useState(todayYmd());

  // Manual metadata (persisted fields)
  const [manualCurrency, setManualCurrency] = useState("USD");
  const [manualInstitution, setManualInstitution] = useState("");
  const [manualLast4, setManualLast4] = useState("");

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

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
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Account[]>(key) ?? [];
      qc.setQueryData<Account[]>(key, [optimistic, ...prev]);

      setOpen(false);

      const created = await createAccount(selectedBusinessId, {
        name: name.trim(),
        type,
        opening_balance_cents: cents,
        opening_balance_date: ymdToIso(openingDate),

        // Manual metadata (optional)
        currency_code: manualCurrency || null,
        institution_name: manualInstitution.trim() || null,
        last4: manualLast4.trim().length === 4 ? manualLast4.trim() : null,
      } as any);

      qc.setQueryData<Account[]>(key, (cur) => {
        const list = cur ?? [];
        return list.map((a) => (a.id === tempId ? created : a));
      });

      setName("");
      setType("CHECKING");
      setOpeningBalance("0.00");
      setOpeningDate(todayYmd());

      setManualCurrency("USD");
      setManualInstitution("");
      setManualLast4("");

      setTimeout(() => {
        qc.invalidateQueries({ queryKey: key });
      }, 250);
    } catch (e: any) {
      qc.invalidateQueries({ queryKey: key });
      setErr(e?.message || "Failed to create account");
      setOpen(true);
    } finally {
      setSaving(false);
    }
  }

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
          eventType: actEventType === "ALL" ? undefined : actEventType,
        });
        if (!cancelled) {
          const items: ActivityLogItem[] = res?.items ?? [];
          setActItems(items);
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

  // Load role policies when Team tab is active
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
        if (!cancelled) setPolRows(items);
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

  // Load plaid status when Accounts tab is active (cached)
  useEffect(() => {
    const tab = sp.get("tab") || "business";
    if (tab !== "accounts") return;
    if (!authReady) return;
    if (!selectedBusinessId) return;
    // Do not block on isLoading; we fetch once accounts data is present.

    const list = accountsQ.data ?? [];
    if (!accountsQ.data || list.length === 0) return;

    let cancelled = false;

    (async () => {
      const toFetch = list.filter((a) => plaidByAccount[a.id] == null && !plaidLoading[a.id] && !plaidChecked[a.id]);
      if (toFetch.length === 0) return;

      setPlaidLoading((cur) => {
        const next = { ...cur };
        for (const a of toFetch) next[a.id] = true;
        return next;
      });

      try {
        // Concurrency cap to avoid API 503s from browser burst
        const MAX_IN_FLIGHT = 2;
        const queue = [...toFetch];
        const results: any[] = [];

        async function worker() {
          while (queue.length) {
            const a = queue.shift()!;
            try {
              const res: any = await plaidStatus(selectedBusinessId, a.id);
              const connected = !!res?.connected;
              const institutionName =
                res?.institutionName ?? res?.institution_name ?? res?.institution?.name ?? undefined;
              const status = res?.status ?? undefined;
              const lastSyncAt = res?.lastSyncAt ?? null;
              const last4 = res?.last4 ?? null;
              results.push({ id: a.id, connected, institutionName, status, lastSyncAt, last4 });
            } catch {
              results.push({ id: a.id, connected: false as const, institutionName: undefined, _error: true as const });
            }
          }
        }

        await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, toFetch.length) }, () => worker()));

        if (cancelled) return;

        setPlaidByAccount((cur) => {
          const next = { ...cur };
          for (const r of results as any[]) {
            next[r.id] = {
              connected: !!r.connected,
              institutionName: r.institutionName,
              last4: (r as any).last4 ?? null,
              status: (r as any).status,
              lastSyncAt: (r as any).lastSyncAt ?? null,
              _error: !!r._error,
            };
          }
          return next;
        });

        setPlaidChecked((cur) => {
          const next = { ...cur };
          for (const r of results as any[]) next[r.id] = true;
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
  }, [spKey, authReady, selectedBusinessId, accountsQ.data]);

  // Load categories when Bookkeeping tab is active
  useEffect(() => {
    const tab = sp.get("tab") || "business";
    if (tab !== "bookkeeping") return;
    if (!authReady) return;
    if (!selectedBusinessId) return;

    let cancelled = false;
    (async () => {
      setCatLoading(true);
      setCatError(null);
      try {
        const res: any = await listCategories(selectedBusinessId, { includeArchived: catShowArchived });
        if (!cancelled) setCategories(res?.rows ?? res?.items ?? []);
      } catch (e: any) {
        if (!cancelled) setCatError(e?.message ?? "Failed to load categories");
      } finally {
        if (!cancelled) setCatLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sp, authReady, selectedBusinessId, catShowArchived]);

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

  // current tab (only allowed)
  const tab = (() => {
    const raw = sp.get("tab") || "business";
    if (raw === "team" || raw === "activity" || raw === "accounts" || raw === "bookkeeping" || raw === "business") return raw;
    return "business";
  })();

  if (!authReady) return <div><Skeleton className="h-10 w-64" /></div>;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<Settings className="h-4 w-4" />} title="Settings" />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        <div className="px-3 py-3">
          <div className="flex gap-2 text-sm">
            {[
              { key: "business", label: "Business Profile" },
              { key: "team", label: "Team" },
              { key: "activity", label: "Activity Log" },
              { key: "accounts", label: "Accounts" },
              { key: "bookkeeping", label: "Bookkeeping" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  const params = new URLSearchParams(String(sp));
                  params.set("tab", t.key);
                  router.replace(`?${params.toString()}`);
                }}
                className={`h-7 px-3 rounded-md text-xs font-medium transition
                  ${tab === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      {tab === "activity" ? (
        <Card>
          <CardHeader className="space-y-0 pb-3">
            <CardTitle>Activity Log</CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">Business-scoped audit trail (read-only for members).</div>
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
              <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">Read-only</span>
            </div>

            {actLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : actError ? (
              <div className="text-xs text-red-600">{actError}</div>
            ) : actItems.length === 0 ? (
              <div className="text-xs text-muted-foreground">No activity yet.</div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <Table>
                  <THead className="bg-slate-50">
                    <TableRow className="hover:bg-slate-50">
                      <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">When</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Event</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Actor</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Details</TableHead>
                    </TableRow>
                  </THead>

                  <TableBody>
                    {actItems.map((it) => {
                      const when = (() => {
                        try { return new Date(it.created_at).toLocaleString(); } catch { return String(it.created_at); }
                      })();

                      const humanize = (t: string) => String(t ?? "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

                      return (
                        <TableRow key={it.id} className="hover:bg-slate-50">
                          <TableCell className="py-2 text-slate-700 text-xs whitespace-nowrap">{when}</TableCell>
                          <TableCell className="py-2 text-slate-900 text-xs font-medium">{humanize(it.event_type)}</TableCell>
                          <TableCell className="py-2 text-slate-700 text-xs font-mono">{String(it.actor_user_id).slice(0, 12)}…</TableCell>
                          <TableCell className="py-2 text-right">
                            <button
                              type="button"
                              className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
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
                        <TableCell colSpan={4} className="py-2">
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
      ) : tab === "team" ? (
        <Card>
          <CardHeader className="space-y-0 pb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle>Team</CardTitle>
                <div className="mt-1 text-xs text-muted-foreground">Manage members, roles, and pending invites.</div>
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
                  className={`h-7 px-3 rounded-md text-xs font-medium transition ${teamSubTab === "members" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  onClick={() => setTeamSubTab("members")}
                >
                  Team Members
                </button>

                <button
                  type="button"
                  className={`h-7 px-3 rounded-md text-xs font-medium transition ${teamSubTab === "roles" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  onClick={() => setTeamSubTab("roles")}
                >
                  Roles & Permissions
                </button>
              </div>

              {teamSubTab === "roles" ? (
                <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                  Policies: store-only
                </span>
              ) : null}
            </div>

            {/* Members tab */}
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
                          setInviteMsg(e?.message ?? "Failed to create invite");
                        } finally {
                          setInviteBusy(false);
                        }
                      }}
                      disabled={inviteBusy || !inviteEmail.trim()}
                    >
                      {inviteBusy ? "Creating…" : "Create invite"}
                    </Button>

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

                  {inviteMsg ? <div className="mt-2 text-xs text-slate-700">{inviteMsg}</div> : null}
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
                                  onClick={async () => {
                                    if (!selectedBusinessId) return;
                                    await revokeInvite(selectedBusinessId, i.id);
                                    const res = await getTeam(selectedBusinessId);
                                    setTeamMembers(res.members ?? []);
                                    setTeamInvites(res.invites ?? []);
                                  }}
                                >
                                  Revoke
                                </Button>
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

                          const shownEmail = (() => {
                            const raw = String((m as any).email || "").trim();
                            const isMe = currentUserId && String(m.user_id) === String(currentUserId);
                            return raw || (isMe ? String(currentUserEmail || "").trim() : "");
                          })();

                          return (
                            <TableRow key={m.user_id} className="hover:bg-slate-50">
                              <TableCell className="py-2 font-medium text-slate-900">
                                <span className="inline-flex items-center rounded-md bg-slate-50 border border-slate-200 px-2 py-1 text-xs text-slate-800">
                                  {shownEmail || "Email not available"}
                                </span>
                              </TableCell>

                              <TableCell className="py-2 text-slate-700">
                                <Select
                                  value={m.role}
                                  onValueChange={async (v) => {
                                    if (!selectedBusinessId) return;
                                    if (!["OWNER", "ADMIN"].includes(selectedBusinessRole)) return;
                                    await updateMemberRole(selectedBusinessId, m.user_id, v);
                                    const res = await getTeam(selectedBusinessId);
                                    setTeamMembers(res.members ?? []);
                                    setTeamInvites(res.invites ?? []);
                                  }}
                                  disabled={!["OWNER", "ADMIN"].includes(selectedBusinessRole) || disableOwnerActions}
                                >
                                  <SelectTrigger className={`${selectTriggerClass} w-40`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="MEMBER">Member</SelectItem>
                                    <SelectItem value="ACCOUNTANT">Accountant</SelectItem>
                                    <SelectItem value="BOOKKEEPER">Bookkeeper</SelectItem>
                                    <SelectItem value="ADMIN">Admin</SelectItem>
                                    <SelectItem value="OWNER" disabled={!isOwnerRole}>Owner</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>

                              <TableCell className="py-2 text-slate-700">{formatShortDate(m.created_at)}</TableCell>

                              <TableCell className="py-2 text-right">
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
                                  disabled={!["OWNER", "ADMIN"].includes(selectedBusinessRole) || disableOwnerActions}
                                >
                                  Remove
                                </Button>
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
              // Roles & Permissions (still store-only UI, but NOT placeholder buttons)
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium text-slate-800">Roles & Permissions</div>
                      <div className="text-[11px] text-muted-foreground">Policies are stored; enforcement depends on authz_mode/wave.</div>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                      Store-only
                    </span>
                  </div>

                  {polLoading ? <div className="mt-3"><Skeleton className="h-20 w-full" /></div> : null}
                  {polError ? <div className="mt-3 text-xs text-red-600">{polError}</div> : null}
                  {polMsg ? <div className="mt-3 text-xs text-slate-700">{polMsg}</div> : null}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                    <div className="text-xs font-medium text-slate-700">Permissions matrix</div>
                  </div>

                  <Table>
                    <THead className="bg-slate-50">
                      <TableRow className="hover:bg-slate-50">
                        <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Feature</TableHead>
                        {["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT", "MEMBER"].map((r) => (
                          <TableHead key={r} className="text-[11px] uppercase tracking-wide text-slate-500 text-center">{r}</TableHead>
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
                      ].map(([key, label]) => (
                        <TableRow key={key} className="hover:bg-slate-50">
                          <TableCell className="py-2 font-medium text-slate-900">{label}</TableCell>

                          {["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT", "MEMBER"].map((r) => {
                            const row = polRows.find((x) => String(x.role).toUpperCase() === r);
                            const value = String((row?.policy_json as any)?.[key] ?? "NONE").toUpperCase();
                            const label2 = value === "FULL" ? "Full" : value === "VIEW" ? "View" : "None";
                            const cls =
                              value === "FULL"
                                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                : value === "VIEW"
                                  ? "bg-slate-50 text-slate-800 border-slate-200"
                                  : "bg-slate-50 text-slate-500 border-slate-200";

                            const canEdit = isOwnerRole; // only owner edits for now

                            return (
                              <TableCell key={r} className="py-2 text-center">
                                {canEdit ? (
                                  <Select
                                    value={value}
                                    onValueChange={async (nextVal) => {
                                      if (!selectedBusinessId) return;

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
                                            };

                                        const nextPolicy = { ...base, [key]: String(nextVal).toUpperCase() };

                                        if (idx >= 0) out[idx] = { ...out[idx], policy_json: nextPolicy } as any;
                                        else out.push({ role: r, policy_json: nextPolicy } as any);
                                        return out;
                                      });

                                      try {
                                        const res = await upsertRolePolicy(selectedBusinessId, r, {
                                          ...(row?.policy_json as any),
                                          [key]: String(nextVal).toUpperCase(),
                                        });
                                        if (res?.item) {
                                          setPolRows((cur) => cur.map((x) => (String(x.role).toUpperCase() === r ? (res.item as any) : x)));
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
                                  <span className={"inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold border " + cls}>
                                    {label2}
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
                    Enforcement not enabled yet — allowlists remain the source of truth.
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : tab === "bookkeeping" ? (
        <Card>
          <CardHeader className="space-y-0 pb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle>Bookkeeping</CardTitle>
                <div className="mt-1 text-xs text-muted-foreground">
                  Manage categories used for ledger classification.
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Label className="text-[11px] text-slate-600">Show archived</Label>
                <input
                  type="checkbox"
                  checked={catShowArchived}
                  onChange={(e) => setCatShowArchived(e.target.checked)}
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            {catError ? <div className="text-xs text-red-600">{catError}</div> : null}
            {catLoading ? <Skeleton className="h-10 w-full" /> : null}

            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label>New category</Label>
                <Input
                  className={inputH7}
                  value={catNewName}
                  onChange={(e) => setCatNewName(e.target.value)}
                  placeholder="e.g. Office Supplies"
                />
              </div>
              <Button
                className="h-7 px-3 text-xs"
                onClick={async () => {
                  if (!selectedBusinessId) return;
                  const name = catNewName.trim();
                  if (!name) return;
                  try {
                    await createCategory(selectedBusinessId, name);
                    setCatNewName("");
                    const res: any = await listCategories(selectedBusinessId, { includeArchived: catShowArchived });
                    setCategories(res?.rows ?? res?.items ?? []);
                  } catch (e: any) {
                    setCatError(e?.message ?? "Failed to create category");
                  }
                }}
                disabled={!selectedBusinessId || !catNewName.trim()}
              >
                Add
              </Button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <Table>
                <THead className="bg-slate-50">
                  <TableRow className="hover:bg-slate-50">
                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Name</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Status</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Actions</TableHead>
                  </TableRow>
                </THead>
                <TableBody>
                  {(categories ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-3 text-xs text-muted-foreground">
                        No categories yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (categories ?? []).map((c: any) => {
                      const archived = !!(c.archived_at || c.archivedAt || c.archived);
                      return (
                        <TableRow key={c.id} className="hover:bg-slate-50">
                          <TableCell className="py-2 font-medium text-slate-900">{c.name}</TableCell>
                          <TableCell className="py-2 text-right">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${archived ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700"
                              }`}>
                              {archived ? "Archived" : "Active"}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={async () => {
                                if (!selectedBusinessId) return;
                                try {
                                  await updateCategory(selectedBusinessId, c.id, { archived: !archived });
                                  const res: any = await listCategories(selectedBusinessId, { includeArchived: catShowArchived });
                                  setCategories(res?.rows ?? res?.items ?? []);
                                } catch (e: any) {
                                  setCatError(e?.message ?? "Failed to update category");
                                }
                              }}
                            >
                              {archived ? "Unarchive" : "Archive"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : tab === "accounts" ? (
        <Card>
          <CardHeader className="space-y-0 pb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle>Accounts</CardTitle>
                <div className="mt-1 text-xs text-muted-foreground">Manage bank accounts, cash accounts, and credit cards.</div>
              </div>

              <div>
                <Button size="sm" onClick={() => setOpen(true)}>Add account</Button>

                <AppDialog
                  open={open}
                  onClose={() => {
                    setOpen(false);
                    setErr(null);
                    setCreateMode("choose");
                    setPlaidDraft(null);
                  }}
                  title="Create account"
                  size="md"
                  footer={
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setOpen(false);
                          setErr(null);
                          setCreateMode("choose");
                          setPlaidDraft(null);
                        }}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => {
                          if (createMode === "manual") onCreateAccount();
                          else if (createMode === "choose") setErr("Select a creation method.");
                          else setErr("Continue to Plaid to review details.");
                        }}
                        disabled={
                          saving ||
                          !selectedBusinessId ||
                          (createMode === "manual" ? !name.trim() : false)
                        }
                      >
                        {saving ? "Working…" : (createMode === "manual" ? "Create" : "Continue")}
                      </Button>
                    </div>
                  }
                >
                  <div className="space-y-3">
                    {err && <div className="text-sm text-red-600">{err}</div>}

                    {createMode === "choose" ? (
                      <div className="space-y-3">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-sm font-semibold text-slate-900">How would you like to add this account?</div>
                          <div className="mt-1 text-xs text-slate-600">
                            Connect via Plaid for automatic bank sync, or set up manually for cash/offline tracking.
                          </div>
                        </div>

                        <button
                          type="button"
                          className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left hover:bg-slate-50"
                          onClick={() => setCreateMode("plaid")}
                          disabled={!selectedBusinessId}
                        >
                          <div className="text-sm font-semibold text-slate-900">Connect with Plaid</div>
                          <div className="mt-1 text-xs text-slate-600">Link your bank account for automatic transaction sync</div>
                        </button>

                        <button
                          type="button"
                          className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left hover:bg-slate-50"
                          onClick={() => setCreateMode("manual")}
                        >
                          <div className="text-sm font-semibold text-slate-900">Set up account manually</div>
                          <div className="mt-1 text-xs text-slate-600">For cash accounts or manual tracking</div>
                        </button>
                      </div>
                    ) : createMode === "manual" ? (
                      <>

                        <div className="space-y-1">
                          <Label>Name</Label>
                          <Input className={inputH7} value={name} onChange={(e) => setName(e.target.value)} />
                        </div>

                        <div className="space-y-1">
                          <Label>Type</Label>
                          <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
                            <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select type" /></SelectTrigger>
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
                            <Label>Currency</Label>
                            <Select value={manualCurrency} onValueChange={(v) => setManualCurrency(v)}>
                              <SelectTrigger className={selectTriggerClass}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="USD">USD</SelectItem>
                                <SelectItem value="CAD">CAD</SelectItem>
                                <SelectItem value="MXN">MXN</SelectItem>
                                <SelectItem value="EUR">EUR</SelectItem>
                                <SelectItem value="GBP">GBP</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1">
                            <Label>Last 4 digits</Label>
                            <Input
                              className={inputH7}
                              value={manualLast4}
                              onChange={(e) => setManualLast4(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                              placeholder="1234"
                            />
                          </div>

                          <div className="space-y-1 col-span-2">
                            <Label>Institution name</Label>
                            <Input
                              className={inputH7}
                              value={manualInstitution}
                              onChange={(e) => setManualInstitution(e.target.value)}
                              placeholder="Bank name (optional)"
                              list="institution-suggestions"
                            />
                            <datalist id="institution-suggestions">
                              {institutionSuggestions.map((x) => (
                                <option key={x} value={x} />
                              ))}
                            </datalist>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label>Opening balance</Label>
                            <Input className={inputH7} value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
                          </div>
                          <div className="space-y-1">
                            <Label>Opening date</Label>
                            <Input className={inputH7} type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <Button
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => setCreateMode("choose")}
                          >
                            Back
                          </Button>
                        </div>

                        <div className="text-sm text-slate-700">
                          Choose an opening balance date (retention start). You’ll review account details next.
                        </div>

                        <div className="space-y-1">
                          <Label>Opening date</Label>
                          <Input className={inputH7} type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
                        </div>

                        <Button
                          className="h-8 px-3 text-xs"
                          onClick={async () => {
                            if (!selectedBusinessId) return;
                            try {
                              // Open Plaid Link using business-level token; PlaidConnectButton is account-scoped, so we do it here.
                              const lt: any = await plaidLinkTokenBusiness(selectedBusinessId);
                              const linkToken = lt?.link_token;
                              if (!linkToken) throw new Error("Failed to create link token");

                              // Load Plaid script (same approach as PlaidConnectButton)
                              const scriptSrc = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
                              const existing = document.querySelector(`script[src="${scriptSrc}"]`);
                              if (!existing) {
                                const s = document.createElement("script");
                                s.src = scriptSrc;
                                s.async = true;
                                document.head.appendChild(s);
                                await new Promise<void>((resolve, reject) => {
                                  s.onload = () => resolve();
                                  s.onerror = () => reject(new Error("Plaid script failed to load"));
                                });
                              }

                              if (!(window as any).Plaid?.create) throw new Error("Plaid failed to load");

                              const handler = (window as any).Plaid.create({
                                token: linkToken,
                                onSuccess: (public_token: string, metadata: any) => {
                                  const institution = metadata?.institution
                                    ? { name: metadata.institution.name, institution_id: metadata.institution.institution_id }
                                    : undefined;

                                  const accountsRaw = Array.isArray(metadata?.accounts) ? metadata.accounts : [];
                                  const first = accountsRaw[0];
                                  if (!first?.id) {
                                    setErr("Plaid returned no accounts");
                                    return;
                                  }

                                  // Prefill draft from Plaid (user can edit on review)
                                  setPlaidDraft({
                                    public_token,
                                    institution,
                                    plaidAccountId: String(first.id),
                                    mask: first.mask ? String(first.mask) : undefined,
                                    name: first.name ? String(first.name) : (institution?.name ? `${institution.name} Account` : "Bank Account"),
                                    type: String((first.subtype ?? first.type ?? "CHECKING")).toUpperCase(),
                                    effectiveStartDate: openingDate,
                                  });

                                  setPlaidReviewOpen(true);
                                },
                              });

                              handler.open();
                            } catch (e: any) {
                              setErr(e?.message ?? "Plaid failed");
                            }
                          }}
                          disabled={!selectedBusinessId}
                        >
                          Continue to Plaid
                        </Button>
                      </>
                    )}
                  </div>
                </AppDialog>

                {/* Plaid review (step after Plaid selection) */}
                <AppDialog
                  open={plaidReviewOpen}
                  onClose={() => setPlaidReviewOpen(false)}
                  title="Review bank account"
                  size="md"
                  footer={
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setPlaidReviewOpen(false);
                          setCreateMode("plaid");
                        }}
                      >
                        Back
                      </Button>

                      <Button
                        onClick={async () => {
                          if (!selectedBusinessId || !plaidDraft) return;
                          setSaving(true);
                          setErr(null);
                          try {
                            const body: any = {
                              public_token: plaidDraft.public_token,
                              plaidAccountId: plaidDraft.plaidAccountId,
                              effectiveStartDate: plaidDraft.effectiveStartDate,
                              institution: plaidDraft.institution,
                              mask: plaidDraft.mask,
                              name: plaidDraft.name.trim(),
                              type: plaidDraft.type,
                            };

                            const res: any = await plaidCreateAccount(selectedBusinessId, body);
                            if (!res?.ok) throw new Error(res?.error ?? "Create failed");

                            qc.invalidateQueries({ queryKey: ["accounts", selectedBusinessId] });
                            setPlaidReviewOpen(false);
                            setOpen(false);

                            // Reset wizard for next time
                            setCreateMode("choose");
                            setPlaidDraft(null);
                          } catch (e: any) {
                            setErr(e?.message ?? "Failed to create account");
                          } finally {
                            setSaving(false);
                          }
                        }}
                        disabled={saving || !plaidDraft?.name?.trim()}
                      >
                        {saving ? "Creating…" : "Create Account"}
                      </Button>
                    </div>
                  }
                >
                  <div className="space-y-3">
                    {err ? <div className="text-sm text-red-600">{err}</div> : null}

                    <div className="space-y-1">
                      <Label>Name</Label>
                      <Input
                        className="h-7"
                        value={plaidDraft?.name ?? ""}
                        onChange={(e) => setPlaidDraft((cur) => (cur ? { ...cur, name: e.target.value } : cur))}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label>Type</Label>
                      <Select
                        value={(plaidDraft?.type ?? "CHECKING") as any}
                        onValueChange={(v) => setPlaidDraft((cur) => (cur ? { ...cur, type: v } : cur))}
                      >
                        <SelectTrigger className="h-7"><SelectValue /></SelectTrigger>
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
                        <Label>Institution</Label>
                        <Input className="h-7" value={plaidDraft?.institution?.name ?? ""} disabled />
                      </div>
                      <div className="space-y-1">
                        <Label>Last 4</Label>
                        <Input className="h-7" value={plaidDraft?.mask ?? ""} disabled />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label>Opening balance date</Label>
                      <Input
                        className="h-7"
                        type="date"
                        value={plaidDraft?.effectiveStartDate ?? todayYmd()}
                        onChange={(e) =>
                          setPlaidDraft((cur) => (cur ? { ...cur, effectiveStartDate: e.target.value } : cur))
                        }
                      />
                      <div className="text-[11px] text-slate-500">
                        This date controls how far back we retain transactions. Opening is computed after creation.
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

                            const patch: any = { name: editName.trim(), type: editType };
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
                        <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select type" /></SelectTrigger>
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
                      <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Institution</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wide text-slate-500">Last 4</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Opening balance</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Status</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-center">Plaid</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 text-right">Actions</TableHead>
                    </TableRow>
                  </THead>

                  <TableBody>
                    {(accountsQ.data ?? []).map((a) => {
                      const amount = currency.format(a.opening_balance_cents / 100);
                      const date = formatShortDate(a.opening_balance_date);
                      const isArchived = !!a.archived_at;

                      const st = plaidByAccount[a.id];
                      const loading = !!plaidLoading[a.id];
                      const checked = !!plaidChecked[a.id];

                      return (
                        <TableRow key={a.id} className="hover:bg-slate-50">
                          <TableCell className="py-2 font-medium text-slate-900">{a.name}</TableCell>
                          <TableCell className="py-2 text-slate-700">{formatAccountType(a.type)}</TableCell>

                          {/* Institution (Plaid OR manual) */}
                          <TableCell className="py-2 text-slate-700 text-xs">
                            {st?.institutionName ? (
                              <span className="truncate inline-block max-w-[220px]" title={st.institutionName}>
                                {st.institutionName}
                              </span>
                            ) : (a as any)?.institution_name ? (
                              <span className="truncate inline-block max-w-[220px]" title={(a as any).institution_name}>
                                {(a as any).institution_name}
                              </span>
                            ) : (
                              <span className="text-slate-400"></span>
                            )}
                          </TableCell>

                          {/* Last 4 (Plaid OR manual) */}
                          <TableCell className="py-2 text-slate-700 text-xs font-mono">
                            {st?.last4
                              ? `•••• ${st.last4}`
                              : (a as any)?.last4
                                ? `•••• ${(a as any).last4}`
                                : st?.connected
                                  ? <span className="text-slate-600">Reconnect</span>
                                  : <span className="text-slate-400"></span>}
                          </TableCell>

                          <TableCell className="py-2 text-right">
                            <div className="font-medium text-slate-900 leading-none">{amount}</div>
                            {date ? <div className="text-[11px] text-slate-500 leading-none mt-1">{date}</div> : null}
                          </TableCell>

                          <TableCell className="py-2 text-right">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${isArchived ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700"}`}>
                              {isArchived ? "Archived" : "Active"}
                            </span>
                          </TableCell>

                          {/* Plaid (status only) */}
                          <TableCell className="py-2 text-center">
                            {!st && loading ? (
                              <span className="text-[11px] text-slate-500">Checking…</span>
                            ) : (st as any)?.needsAttention ? (
                              <span
                                className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-[11px] font-medium"
                                title={(st as any)?.errorMessage ?? "Needs attention"}
                              >
                                Needs attention
                              </span>
                            ) : isArchived ? (
                              <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                                Not connected
                              </span>
                            ) : st?.connected ? (
                              <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-medium">
                                Connected
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                                Not connected
                              </span>
                            )}
                          </TableCell>


                          {/* Actions */}
                          <TableCell className="py-2 text-right">
                            <div className="flex justify-end gap-1 items-center">
                              {(() => {
                                // Plaid actions live in Actions column
                                if (!selectedBusinessId) return null;

                                // Archived accounts: no Plaid actions, no edit/archive; delete handled separately
                                if (isArchived) return null;

                                // While status is still loading/unknown, don't render connect/switch controls (prevents wrong flashes).
                                if (!checked || loading) return null;

                                // Needs attention -> Reconnect
                                if ((st as any)?.needsAttention && !isArchived) {
                                  return (
                                    <PlaidConnectButton
                                      businessId={selectedBusinessId}
                                      accountId={a.id}
                                      effectiveStartDate={todayYmd()}
                                      disabledClassName="opacity-50 cursor-not-allowed"
                                      buttonClassName="h-7 px-2 inline-flex items-center justify-center rounded-md border border-slate-200 text-xs font-medium hover:bg-slate-50"
                                      disabled={!selectedBusinessId}
                                      label="Reconnect (Plaid)"
                                      onConnected={async () => {
                                        try {
                                          const res: any = await plaidStatus(selectedBusinessId, a.id);
                                          setPlaidByAccount((cur) => ({
                                            ...cur,
                                            [a.id]: {
                                              connected: !!res?.connected,
                                              institutionName: res?.institutionName ?? undefined,
                                              last4: res?.last4 ?? null,
                                              status: res?.status ?? undefined,
                                              lastSyncAt: res?.lastSyncAt ?? null,
                                              needsAttention: !!res?.needsAttention,
                                              errorMessage: res?.error ?? null,
                                            } as any,
                                          }));
                                          setPlaidChecked((cur) => ({ ...cur, [a.id]: true }));
                                          qc.invalidateQueries({ queryKey: ["accounts", selectedBusinessId] });
                                        } catch { }
                                      }}
                                    />
                                  );
                                }

                                // Not connected -> Connect Plaid
                                if (!st?.connected && !isArchived) {
                                  return (
                                    <PlaidConnectButton
                                      businessId={selectedBusinessId}
                                      accountId={a.id}
                                      effectiveStartDate={todayYmd()}
                                      disabledClassName="opacity-50 cursor-not-allowed"
                                      buttonClassName="h-7 px-2 inline-flex items-center justify-center rounded-md border border-slate-200 text-xs font-medium hover:bg-slate-50"
                                      disabled={!selectedBusinessId}
                                      label="Connect (Plaid)"
                                      onConnected={async () => {
                                        // Refresh status after connect
                                        try {
                                          const res: any = await plaidStatus(selectedBusinessId, a.id);
                                          setPlaidByAccount((cur) => ({
                                            ...cur,
                                            [a.id]: {
                                              connected: !!res?.connected,
                                              institutionName: res?.institutionName ?? undefined,
                                              last4: res?.last4 ?? null,
                                              status: res?.status ?? undefined,
                                              lastSyncAt: res?.lastSyncAt ?? null,
                                            },
                                          }));
                                          setPlaidChecked((cur) => ({ ...cur, [a.id]: true }));
                                          qc.invalidateQueries({ queryKey: ["accounts", selectedBusinessId] });
                                        } catch { }
                                      }}
                                    />
                                  );
                                }

                                // Connected -> Switch + Disconnect (hide if archived)
                                if (st?.connected && !isArchived) {
                                  return (
                                    <>
                                      <PlaidConnectButton
                                        businessId={selectedBusinessId}
                                        accountId={a.id}
                                        effectiveStartDate={todayYmd()}
                                        disabledClassName="opacity-50 cursor-not-allowed"
                                        buttonClassName="h-7 px-2 inline-flex items-center justify-center rounded-md border border-slate-200 text-xs font-medium hover:bg-slate-50"
                                        disabled={!selectedBusinessId}
                                        label="Connect different bank account (Plaid)"
                                        onConnected={async () => {

                                          try {
                                            const res: any = await plaidStatus(selectedBusinessId, a.id);
                                            setPlaidByAccount((cur) => ({
                                              ...cur,
                                              [a.id]: {
                                                connected: !!res?.connected,
                                                institutionName: res?.institutionName ?? undefined,
                                                last4: res?.last4 ?? null,
                                                status: res?.status ?? undefined,
                                                lastSyncAt: res?.lastSyncAt ?? null,
                                              },
                                            }));
                                            setPlaidChecked((cur) => ({ ...cur, [a.id]: true }));
                                          } catch { }
                                        }}
                                      />

                                      <button
                                        type="button"
                                        className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                                        title="Disconnect Plaid"
                                        onClick={async () => {
                                          await plaidDisconnect(selectedBusinessId, a.id);
                                          setPlaidByAccount((cur) => ({ ...cur, [a.id]: { connected: false } }));
                                          setPlaidChecked((cur) => ({ ...cur, [a.id]: true }));
                                        }}
                                      >
                                        <Link2Off className="h-4 w-4" />
                                      </button>
                                    </>
                                  );
                                }

                                return null;
                              })()}
                              {!isArchived ? (
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
                                    } catch { }
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              ) : null}

                              {/* Archive / Unarchive */}
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

                              {/* Delete (archived only) */}
                              {(() => {
                                if (!isArchived) return null;

                                const elig = deleteEligByAccount[a.id];
                                const loadingElig = !!deleteEligLoading[a.id];

                                const eligible = !!elig?.eligible;
                                const relatedTotal = elig?.related_total ?? null;

                                const disabled = loadingElig || !eligible;

                                const title = loadingElig
                                  ? "Checking delete eligibility…"
                                  : eligible
                                    ? "Delete account"
                                    : `Cannot delete: ${relatedTotal ?? "unknown"} related rows. Remove related data first.`;

                                return (
                                  <button
                                    type="button"
                                    className={`h-6 w-6 inline-flex items-center justify-center rounded-md border border-slate-200 ${disabled ? "text-slate-300 cursor-not-allowed" : "text-rose-600 hover:bg-rose-50"
                                      }`}
                                    title={title}
                                    disabled={disabled}
                                    onClick={async () => {
                                      if (disabled) return;
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
      ) : (
        // Business tab
        <div className="space-y-4">
          <Card>
            <CardHeader className="space-y-0 pb-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle>Profile</CardTitle>
                  <div className="mt-1 text-xs text-muted-foreground">Your account information</div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-medium">
                    {roleLabel(selectedBusinessRole)}
                  </span>

                  <Button className="h-7 px-2 text-xs" variant="outline" onClick={onSignOut} title="Sign out">
                    Sign out
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="text-sm">
              <div className="font-medium text-slate-900">{currentUserName || currentUserEmail || "—"}</div>
              <div className="text-xs text-muted-foreground">{currentUserEmail || "—"}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-0 pb-2">
              <CardTitle>Current Usage</CardTitle>
              <div className="mt-1 text-xs text-muted-foreground">Track your usage against plan limits</div>
            </CardHeader>

            <CardContent className="pt-0">
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="flex items-stretch">
                  <div className="flex-1 px-4 py-3 text-center">
                    <div className="text-lg font-semibold text-slate-900 leading-none">{usageQ.isLoading ? "—" : (usageQ.data?.entries_count ?? 0)}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Entries</div>
                  </div>
                  <div className="w-px bg-slate-200" />
                  <div className="flex-1 px-4 py-3 text-center">
                    <div className="text-lg font-semibold text-slate-900 leading-none">{usageQ.isLoading ? "—" : (usageQ.data?.accounts_count ?? (accountsQ.data?.length ?? 0))}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Accounts</div>
                  </div>
                  <div className="w-px bg-slate-200" />
                  <div className="flex-1 px-4 py-3 text-center">
                    <div className="text-lg font-semibold text-slate-900 leading-none">{usageQ.isLoading ? "—" : (usageQ.data?.members_count ?? 1)}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Users</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-0 pb-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle>Business Profile</CardTitle>
                  <div className="mt-1 text-xs text-muted-foreground">Optional profile details (saved)</div>
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
                  <Input className={inputH7} value={bpAddress} onChange={(e) => setBpAddress(e.target.value)} disabled={!canEditBusinessProfile || bpSaving} />
                </div>

                <div className="space-y-1">
                  <Label>Phone</Label>
                  <Input className={inputH7} value={bpPhone} onChange={(e) => setBpPhone(e.target.value)} disabled={!canEditBusinessProfile || bpSaving} />
                </div>

                <div className="space-y-1">
                  <Label>Industry</Label>

                  <Select value={bpIndustry} onValueChange={(v) => { setBpIndustry(v); if (v !== "Other") setBpIndustryOther(""); }} disabled={!canEditBusinessProfile || bpSaving}>
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
                    <Input className={inputH7} value={bpIndustryOther} onChange={(e) => setBpIndustryOther(e.target.value)} disabled={!canEditBusinessProfile || bpSaving} placeholder="Enter industry…" />
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
                        e.currentTarget.value = "";
                      }}
                    />

                    <Button
                      type="button"
                      variant="outline"
                      className="h-7"
                      disabled={!canEditBusinessProfile || bpSaving || logoSaving || logoUploader.hasActiveUploads}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      <UploadCloud className="h-4 w-4 mr-2" />
                      {(selectedBusiness as any)?.logo_upload_id ? "Replace logo" : "Upload logo"}
                    </Button>

                    <div className="text-xs text-slate-500">
                      {(selectedBusiness as any)?.logo_upload_id ? "Logo uploaded" : "No logo uploaded"}
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Currency</Label>
                  <Select value={bpCurrency} onValueChange={(v) => setBpCurrency(v)} disabled={!canEditBusinessProfile || bpSaving}>
                    <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Currency" /></SelectTrigger>
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
                  <Select value={bpFiscalMonth} onValueChange={(v) => setBpFiscalMonth(v)} disabled={!canEditBusinessProfile || bpSaving}>
                    <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Month" /></SelectTrigger>
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
                  <Select value={bpTimezone} onValueChange={(v) => setBpTimezone(v)} disabled={!canEditBusinessProfile || bpSaving}>
                    <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Timezone" /></SelectTrigger>
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
                        const ok = window.confirm("Delete this business?\n\nThis permanently deletes the business and all related data. This cannot be undone.");
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
                        qc.invalidateQueries({ queryKey: ["businesses"] });
                        setBpMsg("Saved.");
                      } catch (e: any) {
                        setBpMsg(e?.message ?? "Save failed");
                      } finally {
                        setBpSaving(false);
                      }
                    }}
                  >
                    {bpSaving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
