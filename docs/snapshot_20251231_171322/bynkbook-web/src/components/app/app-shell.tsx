"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Bell, HelpCircle, UserCircle, Search } from "lucide-react";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/app/pill";

function navVariant(active: boolean) {
  return active ? "default" : "outline";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const sp = useSearchParams();

  // Hooks must always run; decide chrome after
  const showChrome = !(pathname.startsWith("/login") || pathname.startsWith("/me"));
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

  const href = (path: string, needsAccountId: boolean) => {
    if (!businessId) return path;
    const base = `${path}?businessId=${businessId}`;
    return needsAccountId && currentAccountId ? `${base}&accountId=${currentAccountId}` : base;
  };

  const nav = [
    { label: "Dashboard", path: "/dashboard", needsAccountId: false, icon: "D" },
    { label: "Accounts", path: "/accounts", needsAccountId: false, icon: "A" },
    { label: "Ledger", path: "/ledger", needsAccountId: true, icon: "L" },
    { label: "Reconcile", path: "/reconcile", needsAccountId: true, icon: "R" },
    { label: "Category Review", path: "/category-review", needsAccountId: true, icon: "C" },
    { label: "Closed Periods", path: "/closed-periods", needsAccountId: true, icon: "P" },
    { label: "Reports", path: "/reports", needsAccountId: false, icon: "Rp" },
    { label: "Vendors", path: "/vendors", needsAccountId: false, icon: "V" },
    { label: "Budgets", path: "/budgets", needsAccountId: false, icon: "B" },
    { label: "Goals", path: "/goals", needsAccountId: false, icon: "G" },
    { label: "Settings", path: "/settings", needsAccountId: false, icon: "S" },
  ];

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

        <div className="p-3 space-y-2 flex-1 overflow-y-auto">
          {nav.map((item) => {
            const active = pathname.startsWith(item.path);
            const link = href(item.path, item.needsAccountId);

            if (collapsed) {
              return (
                <Button
                  key={item.path}
                  asChild
                  variant={navVariant(active)}
                  className="w-full justify-center"
                  size="sm"
                  title={item.label}
                >
                  <Link href={link} prefetch>{item.icon}</Link>
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
                <Link href={link} prefetch>{item.label}</Link>
              </Button>
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
