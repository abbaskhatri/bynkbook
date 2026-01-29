"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
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
} from "lucide-react";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
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

  const [collapsed, setCollapsed] = useState(false);

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

  const currentAccountId = sp.get("accountId") ?? firstActiveAccountId ?? "";

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
          <Pill title="Business">{businessesQ.isLoading ? "Loading…" : (business?.name ?? "Business")}</Pill>

          <div className="flex items-center gap-3">
            <div className="relative w-[300px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="h-8 pl-8" placeholder="Search…" />
            </div>

            <Button variant="outline" className="h-8 w-8 p-0" title="Notifications">
              <Bell className="h-4 w-4" />
            </Button>

            <Button variant="outline" className="h-8 w-8 p-0" title="Help">
              <HelpCircle className="h-4 w-4" />
            </Button>

            <Button variant="outline" className="h-9 w-9 p-0" title="Account">
              <UserCircle className="h-6 w-6" />
            </Button>
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
