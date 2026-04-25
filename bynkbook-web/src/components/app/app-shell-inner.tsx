"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import {
  Bell,
  Menu,
  X,
  HelpCircle,
  UserCircle,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  BookOpen,
  GitMerge,
  AlertTriangle,
  Tags,
  CalendarCheck2,
  BarChart3,
  Users,
  PieChart,
  Target,
  Settings,
  FileText,
} from "lucide-react";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { getIssuesCount } from "@/lib/api/issues";
import { getActivity, type ActivityLogItem } from "@/lib/api/activity";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/app/pill";
import GlobalSearch from "@/components/app/global-search";
import BrandLogo from "@/components/app/BrandLogo";

function navVariant(active: boolean) {
  return active ? "default" : "outline";
}

const NAV_ICON_CLASS = "h-5 w-5";

function AuthRedirectScreen() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-md border border-slate-200 bg-white p-6 shadow-sm">
        <BrandLogo variant="full" size="md" priority className="mb-6" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-4 w-56" />
      </div>
    </div>
  );
}

export default function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();

  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "";

  const envLabel = useMemo(() => {
    const host = apiBase.toLowerCase();
    // DEV heuristics: execute-api host or explicit dev subdomain
    if (host.includes("execute-api") || host.includes("api-dev") || host.includes("-dev")) return "DEV";
    return "PROD";
  }, [apiBase]);

  const currentUrl = useMemo(() => {
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, sp]);

  // Stage 1: global auth guard for all app routes (exclude auth pages themselves)
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    if (
      pathname.startsWith("/login") ||
      pathname.startsWith("/signup") ||
      pathname.startsWith("/confirm-signup") ||
      pathname.startsWith("/forgot-password") ||
      pathname.startsWith("/reset-password") ||
      pathname.startsWith("/accept-invite") ||
      pathname.startsWith("/oauth-callback") ||
      pathname.startsWith("/privacy") ||
      pathname.startsWith("/terms")
    ) {
      setAuthChecked(true);
      setIsAuthed(false);
      return;
    }

    (async () => {
      try {
        const u: any = await getCurrentUser();
        setIsAuthed(true);

        // Prefer stable identifier for activity "You" label.
        const id = String(u?.userId ?? u?.username ?? "");
        setCurrentUserId(id || null);
      } catch {
        setCurrentUserId(null);
        router.replace(`/login?next=${encodeURIComponent(currentUrl)}`);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, [pathname, router, currentUrl]);

  // Hooks must always run; decide chrome after
  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/confirm-signup") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/accept-invite") ||
    pathname.startsWith("/oauth-callback") ||
    pathname.startsWith("/create-business") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms");

  const showChrome = !isAuthRoute;
  const noPageScroll = pathname.startsWith("/ledger"); // ledger should not page-scroll

  async function onSignOut() {
    try {
      await signOut();
    } finally {
      // Local-first: clear cached app state and return to login
      qc.clear();
      router.replace("/login");
    }
  }

  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Topbar user menu (Settings + Sign out)
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  // Activity dropdown (Bell)
  const [activityOpen, setActivityOpen] = useState(false);
  const activityRef = useRef<HTMLDivElement | null>(null);

  const [activityItems, setActivityItems] = useState<ActivityLogItem[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityErr, setActivityErr] = useState<string | null>(null);
  const activityFetchedAtRef = useRef<number>(0);

  const ACTIVITY_TTL_MS = 15_000;

  useEffect(() => {
    function onDocMouseDown(ev: MouseEvent) {
      const t = ev.target;
      if (!(t instanceof Node)) return;

      const userEl = userMenuRef.current;
      if (userEl && !userEl.contains(t)) setUserMenuOpen(false);

      const actEl = activityRef.current;
      if (actEl && !actEl.contains(t)) setActivityOpen(false);
    }

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    try {
      const v = localStorage.getItem("bynkbook.sidebar.collapsed");
      if (v === "1") setCollapsed(true);
    } catch {}
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("bynkbook.sidebar.collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  function openMobileNav() {
    setActivityOpen(false);
    setUserMenuOpen(false);
    setMobileNavOpen(true);
  }

  const appDataEnabled = showChrome && authChecked && isAuthed;
  const businessesQ = useBusinesses({ enabled: appDataEnabled });

  // Stage 1: if signed in but has no businesses, force create-business (except when already there)
  useEffect(() => {
    if (!authChecked || !isAuthed) return;
    if (pathname.startsWith("/create-business")) return;
    if (businessesQ.isLoading) return;

    const list = businessesQ.data ?? [];
    if (list.length === 0) {
      router.replace(`/create-business?next=${encodeURIComponent(currentUrl)}`);
    }
  }, [authChecked, isAuthed, pathname, businessesQ.isLoading, businessesQ.data, router, currentUrl]);

  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;

  const business = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return list.find((b) => b.id === bizIdFromUrl) ?? list[0] ?? null;
    return list[0] ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const businessId = business?.id ?? bizIdFromUrl ?? "";

  const accountsQ = useAccounts(businessId || null);

    // Activity cache must never leak across businesses.
  useEffect(() => {
    setActivityItems(null);
    setActivityErr(null);
    setActivityLoading(false);
    activityFetchedAtRef.current = 0;
  }, [businessId]);

  const firstActiveAccountId = useMemo(() => {
    const list = accountsQ.data ?? [];
    return list.find((a) => !a.archived_at)?.id ?? null;
  }, [accountsQ.data]);

  // Global rule: some routes REQUIRE a single account (cannot accept accountId=all)
  const routeRequiresSingleAccount = useMemo(() => {
    return (
      pathname.startsWith("/ledger") ||
      pathname.startsWith("/reconcile") ||
      pathname.startsWith("/issues") ||
      pathname.startsWith("/category-review") ||
      pathname.startsWith("/closed-periods")
    );
  }, [pathname]);

  // URL is the source of truth; we may temporarily *display/use* the first active account,
  // but we only write it into the URL once accounts have loaded (debounced) to avoid loops.
  const accountIdFromUrl = sp.get("accountId") ?? null;

  // Persist last real accountId ONLY when accountId !== "all"
  useEffect(() => {
    if (!businessId) return;
    if (!accountIdFromUrl) return;
    if (accountIdFromUrl === "all") return;

    try {
      const key = `bynkbook:lastAccountId:${businessId}`;
      localStorage.setItem(key, accountIdFromUrl);
    } catch {}
  }, [businessId, accountIdFromUrl]);

  // If URL has accountId=all and route requires a single account:
  // fallback to last real account for that business (localStorage) or first active account.
  useEffect(() => {
    if (!businessId) return;
    if (accountIdFromUrl !== "all") return;
    if (!routeRequiresSingleAccount) return;
    if (accountsQ.isLoading) return;

    const accounts = accountsQ.data ?? [];
    let fallback: string | null = null;

    try {
      const key = `bynkbook:lastAccountId:${businessId}`;
      const stored = localStorage.getItem(key);
      if (stored && stored !== "all") {
        const ok = accounts.some((a) => a.id === stored && !a.archived_at);
        if (ok) fallback = stored;
      }
    } catch {}

    if (!fallback) fallback = firstActiveAccountId ?? null;
    if (!fallback) return;

    const params = new URLSearchParams(sp.toString());
    params.set("businessId", businessId);
    params.delete("businessesId");
    params.set("accountId", fallback);

    router.replace(`${pathname}?${params.toString()}`);
  }, [
    businessId,
    accountIdFromUrl,
    routeRequiresSingleAccount,
    accountsQ.isLoading,
    accountsQ.data,
    firstActiveAccountId,
    pathname,
    router,
    sp,
  ]);

  const effectiveAccountId = accountIdFromUrl ?? firstActiveAccountId ?? null;
  const currentAccountId = effectiveAccountId ?? "";

  // When the current URL uses accountId=all, single-account routes must never navigate with "all".
  // Compute a safe fallback for link-building: last real account for this business, else first active account.
  const navAccountId = useMemo(() => {
    if (!businessId) return "";
    if (!effectiveAccountId) return "";
    if (effectiveAccountId !== "all") return effectiveAccountId;

    const accounts = accountsQ.data ?? [];

    try {
      const key = `bynkbook:lastAccountId:${businessId}`;
      const stored = localStorage.getItem(key);
      if (stored && stored !== "all") {
        const ok = accounts.some((a) => a.id === stored && !a.archived_at);
        if (ok) return stored;
      }
    } catch {}

    return firstActiveAccountId ?? "";
  }, [businessId, effectiveAccountId, accountsQ.data, firstActiveAccountId]);

  const account = useMemo(() => {
    const list = accountsQ.data ?? [];
    const id = effectiveAccountId ?? "";
    return list.find((a) => a.id === id) ?? list[0] ?? null;
  }, [accountsQ.data, effectiveAccountId]);

  const autopickRef = useRef<{ bizId: string | null; timer: any }>({ bizId: null, timer: null });

  // Auto-pick first account after accounts load (single debounced URL write)
  useEffect(() => {
    if (!businessId) return;

    // If URL already has accountId, mark this business as handled.
    if (accountIdFromUrl) {
      autopickRef.current.bizId = businessId;
      if (autopickRef.current.timer) {
        clearTimeout(autopickRef.current.timer);
        autopickRef.current.timer = null;
      }
      return;
    }

    if (accountsQ.isLoading) return;
    if (!firstActiveAccountId) return;

    // One-shot per business selection
    if (autopickRef.current.bizId === businessId) return;

    if (autopickRef.current.timer) clearTimeout(autopickRef.current.timer);

    autopickRef.current.timer = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      params.set("businessId", businessId);
      params.delete("businessesId");
      params.set("accountId", firstActiveAccountId);

      router.replace(`${pathname}?${params.toString()}`);
      autopickRef.current.bizId = businessId;
      autopickRef.current.timer = null;
    }, 200);

    return () => {
      if (autopickRef.current.timer) {
        clearTimeout(autopickRef.current.timer);
        autopickRef.current.timer = null;
      }
    };
  }, [accountsQ.isLoading, accountIdFromUrl, businessId, firstActiveAccountId, pathname, router, sp]);

  function onBusinessChange(nextBusinessId: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("businessId", nextBusinessId);
    params.delete("businessesId");
    params.delete("accountId"); // LOCK: clear accountId immediately on business change

    // Allow autopick for the new business after accounts load
    autopickRef.current.bizId = null;
    if (autopickRef.current.timer) {
      clearTimeout(autopickRef.current.timer);
      autopickRef.current.timer = null;
    }

    router.replace(`${pathname}?${params.toString()}`);
  }

  function onAccountChange(nextAccountId: string) {
    if (!businessId) return;
    const params = new URLSearchParams(sp.toString());
    params.set("businessId", businessId);
    params.delete("businessesId");
    params.set("accountId", nextAccountId);

    autopickRef.current.bizId = businessId;
    router.replace(`${pathname}?${params.toString()}`);
  }

  // Sidebar Issues count (authoritative; server-derived)
  const issuesCountQ = useQuery({
    queryKey: ["issuesCount", businessId, currentAccountId || "all", "OPEN"],
    enabled: !!businessId && !!currentAccountId,
    queryFn: () => getIssuesCount(businessId!, { status: "OPEN", accountId: currentAccountId! }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  // IMPORTANT: never flash a fake "0" while loading — skeleton-first.
  const attnIssues = issuesCountQ.isLoading ? null : (Number(issuesCountQ.data?.count ?? 0) || 0);

  async function ensureActivityFresh(force = false) {
    if (!businessId) return;

    const now = Date.now();
    const hasCache = Array.isArray(activityItems);
    const fresh = hasCache && now - activityFetchedAtRef.current < ACTIVITY_TTL_MS;

    if (!force && fresh) return;

    setActivityLoading(true);
    setActivityErr(null);

    try {
      const res = await getActivity(businessId, {
        limit: 10,
        accountId: accountIdFromUrl && accountIdFromUrl !== "all" ? accountIdFromUrl : undefined,
      });

      setActivityItems(res.items ?? []);
      activityFetchedAtRef.current = Date.now();
    } catch {
      // Keep last-good items visible; just show a small error line.
      setActivityErr("Couldn’t load activity.");
    } finally {
      setActivityLoading(false);
    }
  }

  const href = (path: string, needsAccountId: boolean) => {
    if (!businessId) return path;
    const base = `${path}?businessId=${businessId}`;

    if (!needsAccountId) return base;

    const id = navAccountId || "";
    return id ? `${base}&accountId=${id}` : base;
  };

  const navGroups = [
    {
      group: "Core",
      items: [
        { label: "Dashboard", path: "/dashboard", needsAccountId: false, icon: <LayoutDashboard className={NAV_ICON_CLASS} /> },
        { label: "Ledger", path: "/ledger", needsAccountId: true, icon: <BookOpen className={NAV_ICON_CLASS} /> },
      ],
    },
      {
        group: "Bookkeeping",
        items: [
          { label: "Reconcile", path: "/reconcile", needsAccountId: true, icon: <GitMerge className={NAV_ICON_CLASS} /> },
          { label: "Issues", path: "/issues", needsAccountId: true, icon: <AlertTriangle className={NAV_ICON_CLASS} /> },
          { label: "Category Review", path: "/category-review", needsAccountId: true, icon: <Tags className={NAV_ICON_CLASS} /> },
          { label: "Closed Periods", path: "/closed-periods", needsAccountId: true, icon: <CalendarCheck2 className={NAV_ICON_CLASS} /> },
          { label: "Planning", path: "/planning", needsAccountId: false, icon: <PieChart className={NAV_ICON_CLASS} /> },
          { label: "Reports", path: "/reports", needsAccountId: false, icon: <BarChart3 className={NAV_ICON_CLASS} /> },
        ],
      },
      {
        group: "Business",
        items: [
          { label: "Vendors", path: "/vendors", needsAccountId: false, icon: <Users className={NAV_ICON_CLASS} /> },
          { label: "Settings", path: "/settings", needsAccountId: false, icon: <Settings className={NAV_ICON_CLASS} /> },
        ],
      },
    {
      group: "System",
      items: [
        // Intentionally minimal for Phase 3; keep room for future items.
      ],
    },
  ];

  const renderNavGroups = (isCollapsed: boolean, onNavigate?: () => void) => (
    <div className="p-3 space-y-3 flex-1 overflow-y-auto">
      {navGroups.map((group) => {
        if (!group.items.length) return null;

        return (
          <div key={group.group} className="space-y-2">
            {/* Group label (hidden when collapsed to keep width stable) */}
            {!isCollapsed ? (
              <div className="px-1 text-[10px] uppercase tracking-[0.16em] text-slate-500 transition-opacity duration-200">
                {group.group}
              </div>
            ) : null}

            <div className="space-y-2">
              {group.items.map((item) => {
                const active = pathname.startsWith(item.path);
                const link = href(item.path, item.needsAccountId);

                if (isCollapsed) {
                  const showIssues =
                    item.label === "Issues" && typeof attnIssues === "number" && attnIssues > 0;
                  const showIssuesSkeleton = item.label === "Issues" && issuesCountQ.isLoading;

                  return (
                    <Button
                      key={item.path}
                      asChild
                      variant={navVariant(active)}
                      className="w-full justify-center transition-colors duration-200"
                      size="sm"
                      title={
                        item.label === "Issues" && typeof attnIssues === "number" && attnIssues > 0
                          ? `Issues (${attnIssues})`
                          : item.label
                      }
                    >
                      <Link
                        href={link}
                        prefetch
                        className="relative flex items-center justify-center w-full"
                        onClick={onNavigate}
                      >
                        <span>{item.icon}</span>

                        {showIssues ? (
                          <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-md bg-amber-50 px-1 text-[10px] font-semibold text-amber-800 border border-amber-200">
                            {attnIssues}
                          </span>
                        ) : showIssuesSkeleton ? (
                          <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-1 animate-pulse" />
                        ) : null}
                      </Link>
                    </Button>
                  );
                }

                return (
                  <Button
                    key={item.path}
                    asChild
                    variant={navVariant(active)}
                    className="w-full justify-start transition-colors duration-200"
                    size="sm"
                  >
                    <Link
                      href={link}
                      prefetch
                      className="flex w-full items-center gap-2 transition-all duration-200"
                      onClick={onNavigate}
                    >
                      <span className="shrink-0 text-slate-600">{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                      {item.label === "Issues" && typeof attnIssues === "number" && attnIssues > 0 ? (
                        <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
                          {attnIssues}
                        </span>
                      ) : item.label === "Issues" && issuesCountQ.isLoading ? (
                        <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-1.5 animate-pulse" />
                      ) : null}
                    </Link>
                  </Button>
                );
              })}
            </div>

            {/* Divider between groups */}
            <div className="border-t border-slate-200 pt-2" />
          </div>
        );
      })}
    </div>
  );

  // Stage 1: prevent app-page flash while we determine whether user must create a business
  if (showChrome && authChecked && isAuthed && !pathname.startsWith("/create-business")) {
    if (businessesQ.isLoading) {
      return (
        <div className="min-h-screen flex bg-slate-50">
          {/* Sidebar skeleton */}
          <div className="hidden md:block w-64 border-r border-slate-200 bg-white p-3 space-y-3">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <div className="pt-2 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>

          {/* Main skeleton */}
          <div className="flex-1 min-w-0 p-4 md:p-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-44" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-6 w-28" />
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          </div>
        </div>
      );
    }

    const list = businessesQ.data ?? [];
    if (list.length === 0) {
      // Redirect effect will run; render a stable loading state to avoid flashing Dashboard.
      return (
        <div className="min-h-screen flex bg-slate-50">
          {/* Sidebar skeleton */}
          <div className="hidden md:block w-64 border-r border-slate-200 bg-white p-3 space-y-3">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <div className="pt-2 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>

          {/* Main skeleton */}
          <div className="flex-1 min-w-0 p-4 md:p-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-44" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-6 w-28" />
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          </div>
        </div>
      );
    }
  }

  if (!showChrome) return <>{children}</>;

  if (!authChecked || !isAuthed) {
    return <AuthRedirectScreen />;
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar (sticky) */}
      <aside
        className={[
          collapsed ? "w-16" : "w-56",
          "border-r border-slate-200 bg-white/95 backdrop-blur hidden md:flex flex-col sticky top-0 h-screen",
          "transition-[width] duration-200 ease-out",
        ].join(" ")}
      >
        <div className="h-14 px-3 border-b border-slate-200 flex items-center bg-white/95">
          <div
            className={
              collapsed
                ? "w-full flex items-center justify-center"
                : "w-full flex items-center justify-start"
            }
          >
            <BrandLogo
              collapsed={collapsed}
              variant={collapsed ? "icon" : "full"}
              size={collapsed ? "md" : "md"}
              priority
              className={collapsed ? "" : "translate-y-[1px]"}
            />
          </div>
        </div>

        {renderNavGroups(collapsed)}

        <div className="p-3 border-t border-slate-200 bg-white/95">
          <Button
            variant="outline"
            size="sm"
            className={collapsed ? "w-full justify-center h-9" : "w-full justify-between h-9"}
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : (
              <>
                <span>Collapse</span>
                <ChevronsLeft className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar (sticky) */}
        <header className="h-14 border-b border-slate-200 flex items-center justify-between gap-2 px-3 md:px-4 sticky top-0 z-40 bg-white">
          {/* Left: Business pill (display-only; we expect 1 business) */}
          <div className="flex items-center gap-2 min-w-0 flex-1 md:flex-none">
            <button
              type="button"
              className="md:hidden h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
              title="Open navigation"
              aria-label="Open navigation"
              onClick={openMobileNav}
            >
              <Menu className={NAV_ICON_CLASS} />
            </button>

            <div className="min-w-0 max-w-full overflow-hidden">
              <Pill title="Business">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <Building2 className="h-4 w-4 text-slate-500 shrink-0" />
                  <span className="truncate">
                    {businessesQ.isLoading ? "Loading…" : business?.name ?? "Business"}
                  </span>
                </span>
              </Pill>
            </div>
          </div>

          {/* Center spacer */}
          <div className="hidden md:block flex-1" />

          {/* Right: Global search + bell + user menu */}
          <div className="flex shrink-0 items-center gap-2">
            {businessId ? (
              <div className="hidden md:block">
                <GlobalSearch
                  businessId={businessId}
                  accountId={accountIdFromUrl && accountIdFromUrl !== "all" ? accountIdFromUrl : undefined}
                />
              </div>
            ) : null}

            <div className="relative" ref={activityRef}>
              <button
                type="button"
                className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
                title="Activity"
                onClick={() => {
                  // Close other menu; toggle activity
                  setUserMenuOpen(false);

                  setActivityOpen((v) => {
                    const next = !v;
                    if (next) {
                      // Fetch-on-open with TTL. Keep last-good list visible.
                      ensureActivityFresh(false);
                    }
                    return next;
                  });
                }}
              >
                <Bell className={NAV_ICON_CLASS} />
              </button>

              {activityOpen ? (
                <div className="absolute right-0 mt-2 w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:w-[420px] rounded-md border border-slate-200 bg-white shadow-md overflow-hidden z-50">
                  <div className="px-3 h-10 flex items-center justify-between border-b border-slate-200 bg-slate-50">
                    <div className="text-xs font-semibold text-slate-700">Activity</div>

                    <button
                      type="button"
                      className="text-xs text-slate-600 hover:text-slate-900"
                      onClick={() => {
                        setActivityOpen(false);

                        // Route to existing activity surface in Settings (real page).
                        const base = businessId ? `/settings?businessId=${businessId}&tab=activity` : "/settings?tab=activity";
                        router.push(base);
                      }}
                    >
                      View all
                    </button>
                  </div>

                  {/* Body */}
                  <div className="max-h-[calc(100dvh-5rem)] sm:max-h-[420px] overflow-auto">
                    {/* Error line (never hides last-good list) */}
                    {activityErr ? (
                      <div className="px-3 py-2 text-xs text-rose-700 border-b border-slate-100 flex items-center justify-between gap-2">
                        <span>{activityErr}</span>
                        <button
                          type="button"
                          className="text-xs text-slate-700 hover:text-slate-900"
                          onClick={() => ensureActivityFresh(true)}
                        >
                          Retry
                        </button>
                      </div>
                    ) : null}

                    {/* Skeleton-first: only show skeleton when no cache yet */}
                    {activityLoading && (!activityItems || activityItems.length === 0) ? (
                      <div className="p-3 space-y-2">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div key={i} className="space-y-1">
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-3 w-64" />
                          </div>
                        ))}
                      </div>
                    ) : !activityItems || activityItems.length === 0 ? (
                      <div className="p-3 text-sm text-slate-600">No activity yet.</div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {activityItems.slice(0, 10).map((it) => {
                          const who =
                            currentUserId && String(it.actor_user_id) === String(currentUserId)
                              ? "You"
                              : it.actor_user_id
                              ? "Member"
                              : "System";

                          // Never show raw IDs; keep event readable.
                          const evt = String(it.event_type || "").replace(/_/g, " ");

                          const when = (() => {
                            try {
                              return new Date(it.created_at).toLocaleString();
                            } catch {
                              return String(it.created_at ?? "");
                            }
                          })();

                          return (
                            <div key={it.id} className="px-3 py-2">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-900 truncate">{evt}</div>
                                  <div className="mt-0.5 text-[11px] text-slate-500 truncate">
                                    {who} • {when}
                                  </div>
                                </div>

                                {/* Keep last-good visible while refresh happens (no empty flash) */}
                                {activityLoading ? (
                                  <span className="text-[11px] text-slate-400">Updating…</span>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
                title="Account"
                onClick={() => setUserMenuOpen((v) => !v)}
              >
                <UserCircle className={NAV_ICON_CLASS} />
              </button>

              {userMenuOpen ? (
                <div className="absolute right-0 mt-2 w-44 rounded-md border border-slate-200 bg-white shadow-md overflow-hidden z-50">
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Settings className="h-4 w-4 text-slate-500" />
                    Settings
                  </Link>

                  <Link
                    href="/privacy"
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <HelpCircle className="h-4 w-4 text-slate-500" />
                    Privacy
                  </Link>

                  <Link
                    href="/terms"
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <FileText className="h-4 w-4 text-slate-500" />
                    Terms
                  </Link>

                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                    onClick={async () => {
                      setUserMenuOpen(false);
                      await onSignOut();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {/* Content: ledger must not page-scroll */}
        <main className={(noPageScroll ? "p-4 md:p-6 overflow-hidden flex-1 min-h-0" : "p-4 md:p-6 overflow-y-auto flex-1 min-h-0")}>
          {children}
        </main>
      </div>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />

          <aside className="relative flex h-dvh max-h-dvh w-[min(20rem,calc(100vw-2rem))] flex-col border-r border-slate-200 bg-white shadow-xl">
            <div className="h-14 px-3 border-b border-slate-200 flex items-center justify-between bg-white">
              <BrandLogo variant="full" size="md" priority className="translate-y-[1px]" />
              <button
                type="button"
                className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
                title="Close navigation"
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {renderNavGroups(false, () => setMobileNavOpen(false))}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
