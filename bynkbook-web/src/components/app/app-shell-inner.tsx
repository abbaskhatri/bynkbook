"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import {
  Bell,
  HelpCircle,
  UserCircle,
  Search,
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
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/app/pill";

function navVariant(active: boolean) {
  return active ? "default" : "outline";
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

  useEffect(() => {
    if (pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/confirm-signup") || pathname.startsWith("/forgot-password") || pathname.startsWith("/reset-password") || pathname.startsWith("/accept-invite") || pathname.startsWith("/oauth-callback")) {
      setAuthChecked(true);
      setIsAuthed(false);
      return;
    }

    (async () => {
      try {
        await getCurrentUser();
        setIsAuthed(true);
      } catch {
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
    pathname.startsWith("/create-business");

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

  // Topbar user menu (Settings + Sign out)
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocMouseDown(ev: MouseEvent) {
      const el = userMenuRef.current;
      if (!el) return;
      if (ev.target instanceof Node && !el.contains(ev.target)) setUserMenuOpen(false);
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

  const businessesQ = useBusinesses();

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

  // Sidebar attention counts (UI-only; not authoritative)
  const [attnIssues, setAttnIssues] = useState(0);
  const [attnUncat, setAttnUncat] = useState(0);

  useEffect(() => {
    if (!businessId || !currentAccountId) {
      setAttnIssues(0);
      setAttnUncat(0);
      return;
    }

    const read = () => {
      try {
        const kIssues = `bynkbook:attn:issues:${businessId}:${currentAccountId}`;
        const kUncat = `bynkbook:attn:uncat:${businessId}:${currentAccountId}`;

        const i = Number(localStorage.getItem(kIssues) || "0");
        const u = Number(localStorage.getItem(kUncat) || "0");

        setAttnIssues(Number.isFinite(i) ? i : 0);
        setAttnUncat(Number.isFinite(u) ? u : 0);
      } catch {
        setAttnIssues(0);
        setAttnUncat(0);
      }
    };

    // initial read
    read();

    // same-tab updates from Ledger
    const onCustom = () => read();

    // cross-tab updates
    const onStorage = (ev: StorageEvent) => {
      if (!ev.key) return;
      if (ev.key.includes(`bynkbook:attn:issues:${businessId}:${currentAccountId}`)) return read();
      if (ev.key.includes(`bynkbook:attn:uncat:${businessId}:${currentAccountId}`)) return read();
    };

    window.addEventListener("bynkbook:attnCountsUpdated" as any, onCustom);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("bynkbook:attnCountsUpdated" as any, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, [businessId, currentAccountId]);

  const href = (path: string, needsAccountId: boolean) => {
    if (!businessId) return path;
    const base = `${path}?businessId=${businessId}`;
    return needsAccountId && currentAccountId ? `${base}&accountId=${currentAccountId}` : base;
  };

  const navGroups = [
    {
      group: "Core",
      items: [
        { label: "Dashboard", path: "/dashboard", needsAccountId: false, icon: <LayoutDashboard className="h-4 w-4" /> },
        { label: "Ledger", path: "/ledger", needsAccountId: true, icon: <BookOpen className="h-4 w-4" /> },
      ],
    },
      {
        group: "Bookkeeping",
        items: [
          { label: "Reconcile", path: "/reconcile", needsAccountId: true, icon: <GitMerge className="h-4 w-4" /> },
          { label: "Issues", path: "/issues", needsAccountId: true, icon: <AlertTriangle className="h-4 w-4" /> },
          { label: "Category Review", path: "/category-review", needsAccountId: true, icon: <Tags className="h-4 w-4" /> },
          { label: "Closed Periods", path: "/closed-periods", needsAccountId: true, icon: <CalendarCheck2 className="h-4 w-4" /> },
          { label: "Planning", path: "/planning", needsAccountId: false, icon: <PieChart className="h-4 w-4" /> },
          { label: "Reports", path: "/reports", needsAccountId: false, icon: <BarChart3 className="h-4 w-4" /> },
        ],
      },
      {
        group: "Business",
        items: [
          { label: "Vendors", path: "/vendors", needsAccountId: false, icon: <Users className="h-4 w-4" /> },
          { label: "Settings", path: "/settings", needsAccountId: false, icon: <Settings className="h-4 w-4" /> },
        ],
      },
    {
      group: "System",
      items: [
        // Intentionally minimal for Phase 3; keep room for future items.
      ],
    },
  ];

  // Stage 1: prevent app-page flash while we determine whether user must create a business
  if (showChrome && authChecked && isAuthed && !pathname.startsWith("/create-business")) {
    if (businessesQ.isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="text-sm text-slate-600">Loading…</div>
        </div>
      );
    }

    const list = businessesQ.data ?? [];
    if (list.length === 0) {
      // Redirect effect will run; render a stable loading state to avoid flashing Dashboard.
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="text-sm text-slate-600">Loading…</div>
        </div>
      );
    }
  }

  if (!showChrome) return <>{children}</>;

  return (
    <div className="min-h-screen flex">
      {/* Sidebar (sticky) */}
      <aside
        className={(collapsed ? "w-16" : "w-56") + " border-r bg-background flex flex-col sticky top-0 h-screen"}
      >
        <div className="h-14 px-3 border-b flex items-center">
          <div className="text-sm font-semibold leading-none">{collapsed ? "BB" : "BynkBook"}</div>
        </div>

        <div className="p-3 space-y-3 flex-1 overflow-y-auto">
          {navGroups.map((group) => {
            if (!group.items.length) return null;

            return (
              <div key={group.group} className="space-y-2">
                {/* Group label (hidden when collapsed to keep width stable) */}
                {!collapsed ? (
                  <div className="px-1 text-[10px] uppercase tracking-wide text-slate-500">
                    {group.group}
                  </div>
                ) : null}

                <div className="space-y-2">
                  {group.items.map((item) => {
                    const active = pathname.startsWith(item.path);
                    const link = href(item.path, item.needsAccountId);

                    if (collapsed) {
                      const showIssues = item.label === "Issues" && attnIssues > 0;
                      const showUncat = item.label === "Category Review" && attnUncat > 0;

                      return (
                        <Button
                          key={item.path}
                          asChild
                          variant={navVariant(active)}
                          className="w-full justify-center"
                          size="sm"
                          title={
                            item.label === "Issues" && attnIssues > 0
                              ? `Issues (${attnIssues})`
                              : item.label === "Category Review" && attnUncat > 0
                                ? `Category Review (${attnUncat})`
                                : item.label
                          }
                        >
                          <Link href={link} prefetch className="relative flex items-center justify-center w-full">
                            <span>{item.icon}</span>

                            {showIssues ? (
                              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-md bg-amber-50 px-1 text-[10px] font-semibold text-amber-800 border border-amber-200">
                                {attnIssues}
                              </span>
                            ) : null}

                            {showUncat ? (
                              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-md bg-violet-50 px-1 text-[10px] font-semibold text-violet-800 border border-violet-200">
                                {attnUncat}
                              </span>
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
                        className="w-full justify-start"
                        size="sm"
                      >
                        <Link href={link} prefetch className="flex w-full items-center gap-2">
                          <span className="shrink-0 text-slate-600">{item.icon}</span>
                          <span className="truncate">{item.label}</span>

                          {item.label === "Issues" && attnIssues > 0 ? (
                            <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
                              {attnIssues}
                            </span>
                          ) : null}

                          {item.label === "Category Review" && attnUncat > 0 ? (
                            <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-violet-50 px-1.5 text-[11px] font-semibold text-violet-800 border border-violet-200">
                              {attnUncat}
                            </span>
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

        <div className="p-3 border-t">
          <Button
            variant="outline"
            size="sm"
            className={collapsed ? "w-full justify-center" : "w-full justify-between"}
            onClick={toggleCollapsed}
            title="Collapse sidebar"
          >
            {collapsed ? "»" : "Collapse"}
            {!collapsed ? <span>«</span> : null}
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar (sticky) */}
        <header className="h-14 border-b flex items-center justify-between px-4 sticky top-0 z-40 bg-background">
          {/* Left: Business pill (display-only; we expect 1 business) */}
          <div className="flex items-center gap-3 min-w-0">
            <Pill title="Business">
              {businessesQ.isLoading ? "Loading…" : business?.name ?? "Business"}
            </Pill>
          </div>

          {/* Center: Search bar is intentionally hidden until Step I (AI/search is real). */}
          <div className="flex-1" />

          {/* Right: Icon buttons + user menu */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
            </button>

            <button
              type="button"
              className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
              title="Help"
            >
              <HelpCircle className="h-4 w-4" />
            </button>

            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
                title="Account"
                onClick={() => setUserMenuOpen((v) => !v)}
              >
                <UserCircle className="h-4 w-4" />
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
        <main className={(noPageScroll ? "p-6 overflow-hidden flex-1 min-h-0" : "p-6 overflow-y-auto flex-1 min-h-0")}>
          {children}
        </main>
      </div>
    </div>
  );
}
