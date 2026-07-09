"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
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
  Settings,
  FileText,
} from "lucide-react";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { getAttentionSummary } from "@/lib/api/attentionSummary";
import { getConfiguredAppEnvironment } from "@/lib/appEnvironment";
import { attentionSummaryKey } from "@/lib/queries/attentionSummary";
import { getActivity, type ActivityLogItem } from "@/lib/api/activity";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  pickPreferredAccountId,
  readLastSelectedAccountId,
  usePreferredAccountId,
  writeLastSelectedAccountId,
} from "@/lib/accountSelection";
import { Button } from "@/components/ui/button";
import { AppTooltip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/app/pill";
import BrandLogo from "@/components/app/BrandLogo";
import {
  expireSessionIfNeeded,
  getSessionExpiryReason,
  recordSessionActivity,
  sessionExpiredLoginUrl,
  signOutAndClearSession,
  type SessionExpiryReason,
} from "@/lib/auth/sessionPolicy";

function navVariant(active: boolean) {
  return active ? "default" : "ghost";
}

const NAV_ICON_CLASS = "h-5 w-5";

const AUTH_ROUTE_PREFIXES = [
  "/login",
  "/signup",
  "/confirm-signup",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
  "/oauth-callback",
  "/create-business",
  "/privacy",
  "/terms",
] as const;

function GlobalSearchFallback() {
  return (
    <div
      className="h-8 w-full rounded-md border border-bb-input-border bg-bb-input-bg shadow-sm sm:w-[320px]"
      aria-hidden="true"
    />
  );
}

const GlobalSearch = dynamic(() => import("@/components/app/global-search"), {
  ssr: false,
  loading: () => <GlobalSearchFallback />,
});

function isAuthPathname(pathname: string): boolean {
  return AUTH_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));
}

const NAV_GROUPS = [
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
];

function AuthRedirectScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-md border border-bb-border bg-bb-surface-card p-6 shadow-sm">
        <BrandLogo variant="full" size="md" priority className="mb-6" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-4 w-56" />
      </div>
    </div>
  );
}

function NoWorkspaceRedirectScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-md border border-bb-border bg-bb-surface-card p-6 shadow-sm">
        <BrandLogo variant="full" size="md" priority className="mb-6" />
        <div className="text-sm font-semibold text-foreground">Opening business setup</div>
        <p className="mt-2 text-sm leading-6 text-foreground/70">
          You need one business workspace before entering the app.
        </p>
        <Skeleton className="mt-5 h-9 w-full rounded-md" />
      </div>
    </div>
  );
}

function WorkspaceLoadErrorScreen({
  message,
  onRetry,
  onSignOut,
}: {
  message?: string | null;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-md border border-bb-border bg-bb-surface-card p-6 shadow-sm">
        <BrandLogo variant="full" size="md" priority className="mb-6" />
        <div className="text-sm font-semibold text-foreground">Workspace did not load</div>
        <p className="mt-2 text-sm leading-6 text-foreground/70">
          Your session is active, but Bynkbook could not load your business workspace.
        </p>
        {message ? (
          <div className="mt-3 rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-xs leading-5 text-bb-status-warning-fg">
            {message}
          </div>
        ) : null}
        <div className="mt-5 flex gap-2">
          <Button className="flex-1" onClick={onRetry}>
            Retry
          </Button>
          <Button className="flex-1" variant="outline" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();

  const appEnv = useMemo(() => getConfiguredAppEnvironment(), []);

  const currentUrl = useMemo(() => {
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, sp]);
  const currentUrlRef = useRef(currentUrl);

  useEffect(() => {
    currentUrlRef.current = currentUrl;
  }, [currentUrl]);

  // Stage 1: global auth guard for all app routes (exclude auth pages themselves)
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthPathname(pathname)) {
      setAuthChecked(true);
      setIsAuthed(false);
      return;
    }

    (async () => {
      try {
        const u: any = await getCurrentUser();
        const expired = await expireSessionIfNeeded();
        if (expired) {
          qc.clear();
          setCurrentUserId(null);
          setCurrentUserEmail(null);
          setIsAuthed(false);
          router.replace(sessionExpiredLoginUrl(expired, currentUrlRef.current));
          return;
        }

        setIsAuthed(true);

        // Prefer stable identifier for activity "You" label.
        const id = String(u?.userId ?? u?.username ?? "");
        setCurrentUserId(id || null);

        // signInDetails.loginId is the email the user signed in with (Amplify v6).
        // Fall back to username if loginId not present.
        const email =
          String(u?.signInDetails?.loginId ?? u?.username ?? "").trim() || null;
        // Only display if it looks like an email — never expose internal IDs.
        setCurrentUserEmail(email && email.includes("@") ? email : null);
      } catch {
        setCurrentUserId(null);
        setCurrentUserEmail(null);
        router.replace(`/login?next=${encodeURIComponent(currentUrlRef.current)}`);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, [pathname, qc, router]);

  // Hooks must always run; decide chrome after
  const isAuthRoute = isAuthPathname(pathname);

  const isMobileRoute = pathname === "/mobile" || pathname.startsWith("/mobile/");
  const showChrome = !isAuthRoute && !isMobileRoute;
  const noPageScroll = pathname.startsWith("/ledger"); // ledger should not page-scroll

  async function onSignOut() {
    try {
      await signOutAndClearSession();
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
    setGlobalSearchReady(true);
    setMobileNavOpen(true);
  }

  const appDataEnabled = !isAuthRoute && authChecked && isAuthed;

  useEffect(() => {
    if (!appDataEnabled) return;

    let lastActivityWrite = 0;
    let expiring = false;

    const expire = async (reason: SessionExpiryReason) => {
      if (expiring) return;
      expiring = true;

      try {
        await signOutAndClearSession();
      } finally {
        qc.clear();
        setCurrentUserId(null);
        setCurrentUserEmail(null);
        setIsAuthed(false);
        router.replace(sessionExpiredLoginUrl(reason, currentUrlRef.current));
      }
    };

    const checkSession = () => {
      const reason = getSessionExpiryReason();
      if (reason) void expire(reason);
    };

    const onUserActivity = () => {
      const now = Date.now();
      if (now - lastActivityWrite < 15_000) return;
      lastActivityWrite = now;
      recordSessionActivity(now);
    };

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") checkSession();
    };

    const activityEvents = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    for (const event of activityEvents) {
      window.addEventListener(event, onUserActivity, { passive: true });
    }
    window.addEventListener("focus", checkSession);
    window.addEventListener("storage", checkSession);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);

    const interval = window.setInterval(checkSession, 60_000);
    checkSession();

    return () => {
      window.clearInterval(interval);
      for (const event of activityEvents) {
        window.removeEventListener(event, onUserActivity);
      }
      window.removeEventListener("focus", checkSession);
      window.removeEventListener("storage", checkSession);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
    };
  }, [appDataEnabled, qc, router]);

  const businessesQ = useBusinesses({ enabled: appDataEnabled });

  // Stage 1: if signed in but has no businesses, force create-business (except when already there)
  useEffect(() => {
    if (!authChecked || !isAuthed) return;
    if (pathname.startsWith("/create-business")) return;
    if (businessesQ.isLoading) return;
    if (businessesQ.error) return;

    const list = businessesQ.data ?? [];
    if (list.length === 0) {
      router.replace(`/create-business?next=${encodeURIComponent(currentUrl)}`);
    }
  }, [authChecked, isAuthed, pathname, businessesQ.isLoading, businessesQ.error, businessesQ.data, router, currentUrl]);

  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;

  const business = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return list.find((b) => b.id === bizIdFromUrl) ?? list[0] ?? null;
    return list[0] ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const businessId = showChrome ? business?.id ?? bizIdFromUrl ?? "" : "";
  const [globalSearchReady, setGlobalSearchReady] = useState(false);

  useEffect(() => {
    if (!showChrome || !businessId) {
      setGlobalSearchReady(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const markReady = () => {
      if (!cancelled) setGlobalSearchReady(true);
    };

    const w = window as any;
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(markReady, { timeout: 1800 });
    } else {
      timeoutId = setTimeout(markReady, 800);
    }

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (idleId != null && typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(idleId);
    };
  }, [showChrome, businessId]);

  const accountsQ = useAccounts(showChrome ? businessId || null : null);

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

    writeLastSelectedAccountId(businessId, accountIdFromUrl);
  }, [businessId, accountIdFromUrl]);

  // If URL is missing an account or has accountId=all and the route requires a single account:
  // fallback to last real account for that business (localStorage) or first active account.
  useEffect(() => {
    if (!businessId) return;
    if (accountIdFromUrl && accountIdFromUrl !== "all") return;
    if (!routeRequiresSingleAccount) return;
    if (accountsQ.isLoading) return;

    const fallback = pickPreferredAccountId({
      accounts: accountsQ.data ?? [],
      storedAccountId: readLastSelectedAccountId(businessId),
    });
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
    pathname,
    router,
    sp,
  ]);

  const preferredAccountId = usePreferredAccountId({
    businessId: showChrome ? businessId : null,
    accounts: accountsQ.data ?? [],
    accountIdFromUrl,
  });
  const effectiveAccountId = preferredAccountId || accountIdFromUrl || firstActiveAccountId || null;
  const currentAccountId = effectiveAccountId ?? "";
  const issuesCountScopeKey = showChrome && businessId && currentAccountId ? `${businessId}:${currentAccountId}` : "";
  const [issuesCountReadyKey, setIssuesCountReadyKey] = useState<string | null>(null);

  useEffect(() => {
    setIssuesCountReadyKey(null);
    if (!issuesCountScopeKey) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const markReady = () => {
      if (!cancelled) setIssuesCountReadyKey(issuesCountScopeKey);
    };

    const w = window as any;
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(markReady, { timeout: 1500 });
    } else {
      timeoutId = setTimeout(markReady, 800);
    }

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (idleId != null && typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(idleId);
    };
  }, [issuesCountScopeKey]);

  // When the current URL uses accountId=all, single-account routes must never navigate with "all".
  // Compute a safe fallback for link-building: last real account for this business, else first active account.
  const navAccountId = useMemo(() => {
    if (!businessId) return "";
    if (!effectiveAccountId) return "";
    if (effectiveAccountId !== "all") return effectiveAccountId;

    return pickPreferredAccountId({
      accounts: accountsQ.data ?? [],
      storedAccountId: readLastSelectedAccountId(businessId),
    });
  }, [businessId, effectiveAccountId, accountsQ.data]);

  const attentionAccountId =
    currentAccountId && currentAccountId !== "all" ? currentAccountId : navAccountId;

  const autopickRef = useRef<{ bizId: string | null; timer: any }>({ bizId: null, timer: null });

  // Auto-pick remembered account after accounts load (single debounced URL write)
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

    // One-shot per business selection
    if (autopickRef.current.bizId === businessId) return;

    if (autopickRef.current.timer) clearTimeout(autopickRef.current.timer);

    autopickRef.current.timer = setTimeout(() => {
      const fallback = pickPreferredAccountId({
        accounts: accountsQ.data ?? [],
        storedAccountId: readLastSelectedAccountId(businessId),
      });
      if (!fallback) {
        autopickRef.current.timer = null;
        return;
      }

      const params = new URLSearchParams(sp.toString());
      params.set("businessId", businessId);
      params.delete("businessesId");
      params.set("accountId", fallback);

      router.replace(`${pathname}?${params.toString()}`);
      autopickRef.current.bizId = businessId;
      autopickRef.current.timer = null;
    }, 200);

    const ref = autopickRef.current;
    return () => {
      if (ref.timer) {
        clearTimeout(ref.timer);
        ref.timer = null;
      }
    };
  }, [accountsQ.isLoading, accountsQ.data, accountIdFromUrl, businessId, pathname, router, sp]);

  // Sidebar Issues count (authoritative; server-derived)
  const issuesCountQ = useQuery({
    queryKey: attentionSummaryKey(businessId, attentionAccountId || "all"),
    enabled: showChrome && issuesCountReadyKey === issuesCountScopeKey && !!businessId && !!attentionAccountId,
    queryFn: () => getAttentionSummary({ businessId: businessId!, accountId: attentionAccountId! }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // IMPORTANT: never flash a fake "0" while loading — skeleton-first.
  const attnIssues = issuesCountQ.isLoading ? null : (Number(issuesCountQ.data?.issue_count ?? 0) || 0);
  const attnUncategorized = issuesCountQ.isLoading ? null : (Number(issuesCountQ.data?.uncategorized_count ?? 0) || 0);

  // Activity feed (bell dropdown) — fetched on open with TTL caching.
  // useQuery handles per-business cache isolation via queryKey, so we no
  // longer need a businessId-change effect to clear local state.
  const activityScopedAccountId =
    accountIdFromUrl && accountIdFromUrl !== "all" ? accountIdFromUrl : null;

  const activityQ = useQuery({
    queryKey: ["activityFeed", businessId, activityScopedAccountId ?? "all"],
    enabled: !!businessId && activityOpen,
    queryFn: async () => {
      const res = await getActivity(businessId, {
        limit: 10,
        accountId: activityScopedAccountId ?? undefined,
      });
      return res.items ?? [];
    },
    staleTime: ACTIVITY_TTL_MS,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  // Compat shims so the existing JSX below reads naturally without rewrites.
  const activityItems: ActivityLogItem[] | null = activityQ.data ?? null;
  const activityLoading = activityQ.isFetching;
  const activityErr = activityQ.error ? "Couldn’t load activity." : null;

  const href = (path: string, needsAccountId: boolean) => {
    if (!businessId) return path;
    const base = `${path}?businessId=${businessId}`;

    if (!needsAccountId) return base;

    const id = navAccountId || "";
    return id ? `${base}&accountId=${id}` : base;
  };

  const renderNavGroups = (isCollapsed: boolean, onNavigate?: () => void) => (
    <div className="p-2.5 space-y-2 flex-1 overflow-y-auto">
      {NAV_GROUPS.map((group, groupIndex) => {
        if (!group.items.length) return null;

        return (
          <div key={group.group} className="space-y-1">
            {/* Group label (hidden when collapsed to keep width stable) */}
            {!isCollapsed ? (
                <div className="px-2 pt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-opacity duration-200">
                {group.group}
              </div>
            ) : null}

            <div className="space-y-1">
              {group.items.map((item) => {
                const active = pathname.startsWith(item.path);
                const link = href(item.path, item.needsAccountId);

                if (isCollapsed) {
                  const showIssues =
                    item.label === "Issues" && typeof attnIssues === "number" && attnIssues > 0;
                  const showIssuesSkeleton = item.label === "Issues" && issuesCountQ.isLoading;
                  const showUncategorized =
                    item.label === "Category Review" && typeof attnUncategorized === "number" && attnUncategorized > 0;
                  const showUncategorizedSkeleton = item.label === "Category Review" && issuesCountQ.isLoading;

                  return (
                    <Button
                      key={item.path}
                      asChild
                      variant={navVariant(active)}
                      className={[
                        "w-full justify-center border transition-[color,background-color,border-color,box-shadow,transform] duration-200",
                        active
                          ? "border-transparent bg-bb-nav-active-bg text-bb-nav-active-fg shadow-sm hover:bg-bb-nav-active-bg/90"
                          : "border-transparent bg-transparent text-bb-sidebar-fg/68 hover:bg-bb-surface-elevated hover:text-bb-sidebar-fg",
                      ].join(" ")}
                      size="sm"
                      title={
                        item.label === "Issues" && typeof attnIssues === "number" && attnIssues > 0
                          ? `Issues (${attnIssues})`
                          : item.label === "Category Review" && typeof attnUncategorized === "number" && attnUncategorized > 0
                            ? `Category Review (${attnUncategorized} uncategorized)`
                            : item.label
                      }
                    >
                      <Link
                        href={link}
                        prefetch={false}
                        className="relative flex items-center justify-center w-full"
                        onClick={onNavigate}
                      >
                        <span>{item.icon}</span>

                        {showIssues ? (
                          <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-md bg-bb-status-warning-bg px-1 text-[10px] font-semibold text-bb-status-warning-fg border border-bb-status-warning-border">
                            {attnIssues}
                          </span>
                        ) : showIssuesSkeleton ? (
                          <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-md border border-bb-border bg-muted px-1 animate-pulse" />
                        ) : null}

                        {showUncategorized ? (
                          <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-md bg-bb-status-warning-bg px-1 text-[10px] font-semibold text-bb-status-warning-fg border border-bb-status-warning-border">
                            {attnUncategorized}
                          </span>
                        ) : showUncategorizedSkeleton ? (
                          <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-md border border-bb-border bg-muted px-1 animate-pulse" />
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
                    className={[
                      "w-full justify-start border transition-[color,background-color,border-color,box-shadow,transform] duration-200",
                      active
                        ? "border-transparent bg-bb-nav-active-bg text-bb-nav-active-fg shadow-sm hover:bg-bb-nav-active-bg/90"
                        : "border-transparent bg-transparent text-bb-sidebar-fg/68 hover:bg-bb-surface-elevated hover:text-bb-sidebar-fg",
                    ].join(" ")}
                    size="sm"
                  >
                    <Link
                      href={link}
                      prefetch={false}
                      className="flex w-full items-center gap-2 transition-colors duration-200"
                      onClick={onNavigate}
                    >
                      <span className="shrink-0 text-current">{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                      {item.label === "Issues" && typeof attnIssues === "number" && attnIssues > 0 ? (
                        <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-bb-status-warning-bg px-1.5 text-[11px] font-semibold text-bb-status-warning-fg border border-bb-status-warning-border">
                          {attnIssues}
                        </span>
                      ) : item.label === "Issues" && issuesCountQ.isLoading ? (
                        <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-md border border-bb-border bg-muted px-1.5 animate-pulse" />
                      ) : item.label === "Category Review" && typeof attnUncategorized === "number" && attnUncategorized > 0 ? (
                        <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-bb-status-warning-bg px-1.5 text-[11px] font-semibold text-bb-status-warning-fg border border-bb-status-warning-border">
                          {attnUncategorized}
                        </span>
                      ) : item.label === "Category Review" && issuesCountQ.isLoading ? (
                        <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-md border border-bb-border bg-muted px-1.5 animate-pulse" />
                      ) : null}
                    </Link>
                  </Button>
                );
              })}
            </div>

            {groupIndex < NAV_GROUPS.length - 1 ? (
              <div className="pt-1" />
            ) : null}
          </div>
        );
      })}
    </div>
  );

  // Stage 1: prevent app-page flash while we determine whether user must create a business
  if (showChrome && authChecked && isAuthed && !pathname.startsWith("/create-business")) {
    if (businessesQ.isLoading) {
      return (
        <div className="min-h-screen flex bg-background">
          {/* Sidebar skeleton */}
          <div className="hidden md:block w-64 border-r border-bb-border bg-bb-sidebar-bg p-3 space-y-3">
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

    if (businessesQ.error) {
      return (
        <WorkspaceLoadErrorScreen
          message={(businessesQ.error as any)?.message ?? null}
          onRetry={() => void businessesQ.refetch()}
          onSignOut={() => void onSignOut()}
        />
      );
    }

    const list = businessesQ.data ?? [];
    if (!businessesQ.error && list.length === 0) {
      // Redirect effect will run; keep the protected shell/sidebar out of the
      // transition so no-workspace users get a clear setup state, not a blank app.
      return <NoWorkspaceRedirectScreen />;
    }
  }

  if (isAuthRoute) return <>{children}</>;

  if (!authChecked || !isAuthed) {
    return <AuthRedirectScreen />;
  }

  if (isMobileRoute) return <>{children}</>;

  return (
    <div className="min-h-screen flex bg-background bb-app-canvas">
      {/* Sidebar (sticky) */}
      <aside
        className={[
          collapsed ? "w-16" : "w-56",
          "bb-modern-sidebar border-r border-bb-border bg-bb-sidebar-bg hidden md:flex flex-col sticky top-0 h-screen text-bb-sidebar-fg",
          "transition-[width] duration-200 ease-out",
        ].join(" ")}
      >
        <div className="h-14 px-3 border-b border-bb-border flex items-center bg-bb-sidebar-bg">
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

        <div className="p-3 border-t border-bb-border bg-bb-sidebar-bg">
          <Button
            variant="outline"
            size="sm"
            className={
              collapsed
                ? "w-full justify-center h-9 border-bb-border bg-transparent text-bb-sidebar-fg hover:bg-bb-surface-elevated"
                : "w-full justify-between h-9 border-bb-border bg-transparent text-bb-sidebar-fg hover:bg-bb-surface-elevated"
            }
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
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
        <header className="bb-modern-topbar h-14 border-b border-bb-border flex items-center justify-between gap-2 px-3 md:px-4 sticky top-0 z-40 bg-bb-surface-card/95 backdrop-blur-md">
          {/* Left: Business pill (display-only; we expect 1 business) */}
          <div className="flex items-center gap-2 min-w-0 flex-1 md:flex-none">
            <AppTooltip content="Open navigation" side="bottom">
              <button
                type="button"
                className="md:hidden h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card text-foreground/80 hover:bg-bb-table-row-hover"
                aria-label="Open navigation"
                onClick={openMobileNav}
              >
                <Menu className={NAV_ICON_CLASS} />
              </button>
            </AppTooltip>

            <div className="min-w-0 max-w-full overflow-hidden">
              <Pill title="Business">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
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
                {globalSearchReady ? (
                  <GlobalSearch
                    businessId={businessId}
                    accountId={accountIdFromUrl && accountIdFromUrl !== "all" ? accountIdFromUrl : undefined}
                  />
                ) : (
                  <GlobalSearchFallback />
                )}
              </div>
            ) : null}

            {appEnv.label !== "PROD" ? (
              <AppTooltip content={`Environment: ${appEnv.label} (${appEnv.source}${appEnv.explicit ? "" : " fallback"})`} side="bottom">
                <span className="hidden sm:inline-flex h-7 items-center rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-2 text-[11px] font-semibold text-bb-status-warning-fg">
                  {appEnv.label}
                </span>
              </AppTooltip>
            ) : null}

            <div className="relative" ref={activityRef}>
              <AppTooltip content="Recent activity" side="bottom">
                <button
                  type="button"
                  className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card text-foreground/80 hover:bg-bb-table-row-hover"
                  aria-label="Recent activity"
                  onClick={() => {
                    // Close other menu; toggle activity
                    setUserMenuOpen(false);

                    // Just toggle — the activity useQuery is enabled when
                    // activityOpen flips to true and uses staleTime as the TTL.
                    setActivityOpen((v) => !v);
                  }}
                >
                  <Bell className={NAV_ICON_CLASS} />
                </button>
              </AppTooltip>

              {activityOpen ? (
                <div className="absolute right-0 mt-2 w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:w-[420px] rounded-lg border border-bb-border bg-bb-surface-elevated shadow-[0_18px_60px_rgba(15,23,42,0.16)] dark:shadow-[0_18px_60px_rgba(0,0,0,0.36)] overflow-hidden z-50">
                  <div className="px-3 h-10 flex items-center justify-between border-b border-bb-border bg-bb-surface-soft">
                    <div className="text-xs font-semibold text-foreground/80">Activity</div>

                    <button
                      type="button"
                      className="text-xs text-foreground/70 hover:text-foreground"
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
                      <div className="px-3 py-2 text-xs text-bb-status-danger-fg border-b border-bb-border-muted flex items-center justify-between gap-2">
                        <span>{activityErr}</span>
                        <button
                          type="button"
                          className="text-xs text-foreground/80 hover:text-foreground"
                          onClick={() => void activityQ.refetch()}
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
                      <div className="p-3 text-sm text-foreground/70">No activity yet.</div>
                    ) : (
                      <div className="divide-y divide-bb-border-muted">
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
                                  <div className="text-sm font-semibold text-foreground truncate">{evt}</div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                                    {who} • {when}
                                  </div>
                                </div>

                                {/* Keep last-good visible while refresh happens (no empty flash) */}
                                {activityLoading ? (
                                  <span className="text-[11px] text-bb-text-subtle">Updating…</span>
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
              <AppTooltip content="Account menu" side="bottom">
                <button
                  type="button"
                  className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card text-foreground/80 hover:bg-bb-table-row-hover"
                  aria-label="Account menu"
                  onClick={() => setUserMenuOpen((v) => !v)}
                >
                  <UserCircle className={NAV_ICON_CLASS} />
                </button>
              </AppTooltip>

              {userMenuOpen ? (
                <div className="absolute right-0 mt-2 w-56 rounded-lg border border-bb-border bg-bb-surface-elevated shadow-[0_18px_60px_rgba(15,23,42,0.16)] dark:shadow-[0_18px_60px_rgba(0,0,0,0.36)] overflow-hidden z-50">
                  {currentUserEmail ? (
                    <div className="px-3 py-2 border-b border-bb-border-muted bg-bb-surface-soft">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Signed in as
                      </div>
                      <div className="mt-0.5 text-sm font-medium text-foreground truncate" title={currentUserEmail}>
                        {currentUserEmail}
                      </div>
                    </div>
                  ) : null}

                  <Link
                    href="/settings"
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground/80 hover:bg-bb-table-row-hover"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    Settings
                  </Link>

                  <Link
                    href="/privacy"
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground/80 hover:bg-bb-table-row-hover"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    Privacy
                  </Link>

                  <Link
                    href="/terms"
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground/80 hover:bg-bb-table-row-hover"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    Terms
                  </Link>

                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-bb-status-danger-fg hover:bg-bb-status-danger-bg"
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

        {/* Content: ledger must not page-scroll. Extra bottom padding on
            mobile reserves space for the fixed bottom tab bar. */}
        <main className={(noPageScroll ? "p-3 pb-[5.25rem] md:p-4 md:pb-4 overflow-hidden flex-1 min-h-0" : "p-3 pb-[5.25rem] md:p-5 md:pb-5 overflow-y-auto flex-1 min-h-0")}>
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar — primary navigation, thumb-friendly. Hidden on
          md+ where the sidebar is shown. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 h-[4.75rem] border-t border-bb-border bg-bb-surface-card/92 backdrop-blur-xl flex items-stretch justify-around px-1.5 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-10px_24px_rgba(15,23,42,0.08)] dark:shadow-[0_-16px_36px_rgba(0,0,0,0.28)]"
        aria-label="Primary"
      >
        {[
          { label: "Home", path: "/dashboard", needsAccountId: false, icon: <LayoutDashboard className={NAV_ICON_CLASS} /> },
          { label: "Ledger", path: "/ledger", needsAccountId: true, icon: <BookOpen className={NAV_ICON_CLASS} /> },
          { label: "Reconcile", path: "/reconcile", needsAccountId: true, icon: <GitMerge className={NAV_ICON_CLASS} /> },
          { label: "Issues", path: "/issues", needsAccountId: true, icon: <AlertTriangle className={NAV_ICON_CLASS} /> },
        ].map((item) => {
          const active = pathname.startsWith(item.path);
          const showBadge =
            item.label === "Issues" && typeof attnIssues === "number" && attnIssues > 0;
          return (
            <Link
              key={item.path}
              href={href(item.path, item.needsAccountId)}
              prefetch={false}
              className={[
                "relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-semibold leading-none",
                active ? "bg-bb-nav-active-bg text-bb-nav-active-fg shadow-sm" : "text-foreground/60 hover:bg-bb-surface-soft hover:text-foreground",
              ].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              <span className="relative">
                {item.icon}
                {showBadge ? (
                  <span className="absolute -top-1.5 -right-2 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-bb-status-warning-bg px-1 text-[9px] font-semibold text-bb-status-warning-fg border border-bb-status-warning-border">
                    {attnIssues}
                  </span>
                ) : null}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-semibold leading-none text-foreground/60 hover:bg-bb-surface-soft hover:text-foreground"
          onClick={openMobileNav}
          aria-label="More navigation"
        >
          <Menu className={NAV_ICON_CLASS} />
          <span>More</span>
        </button>
      </nav>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-bb-overlay"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />

          <aside className="relative flex h-dvh max-h-dvh w-[min(20rem,calc(100vw-2rem))] flex-col border-r border-bb-border bg-bb-sidebar-bg text-bb-sidebar-fg shadow-xl">
            <div className="h-14 px-3 border-b border-bb-border flex items-center justify-between bg-bb-sidebar-bg">
              <BrandLogo variant="full" size="md" priority className="translate-y-[1px]" />
              <button
                type="button"
                className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-bb-border text-foreground/80 hover:bg-bb-table-row-hover"
                title="Close navigation"
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {businessId ? (
              <div className="px-3 pt-3">
                {globalSearchReady ? (
                  <GlobalSearch
                    businessId={businessId}
                    accountId={accountIdFromUrl && accountIdFromUrl !== "all" ? accountIdFromUrl : undefined}
                  />
                ) : (
                  <GlobalSearchFallback />
                )}
              </div>
            ) : null}

            {renderNavGroups(false, () => setMobileNavOpen(false))}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
