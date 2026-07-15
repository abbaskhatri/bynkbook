"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  GitMerge,
  Home,
  Menu,
} from "lucide-react";

import { cn } from "@/lib/utils";

type MobileShellProps = {
  children: React.ReactNode;
  businessId?: string | null;
  accountId?: string | null;
};

function withBusiness(path: string, businessId?: string | null, accountId?: string | null) {
  const params = new URLSearchParams();
  if (businessId) params.set("businessId", businessId);
  if (accountId) params.set("accountId", accountId);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

export function MobileShell({ children, businessId, accountId }: MobileShellProps) {
  const pathname = usePathname();

  const items = [
    {
      label: "Home",
      href: withBusiness("/dashboard", businessId, accountId),
      icon: <Home className="h-5 w-5" />,
      active: pathname === "/dashboard",
    },
    {
      label: "Transactions",
      href: withBusiness("/operations", businessId, accountId),
      icon: <Activity className="h-5 w-5" />,
      active: pathname === "/operations",
      disabled: !businessId,
    },
    {
      label: "Reconcile",
      href: withBusiness("/reconcile", businessId, accountId),
      icon: <GitMerge className="h-5 w-5" />,
      active: pathname === "/reconcile",
      disabled: !businessId || !accountId,
    },
    {
      label: "Ledger",
      href: withBusiness("/ledger", businessId, accountId),
      icon: <BookOpen className="h-5 w-5" />,
      active: pathname === "/ledger",
      disabled: !businessId || !accountId,
    },
    {
      label: "More",
      href: withBusiness("/settings", businessId, accountId),
      icon: <Menu className="h-5 w-5" />,
      active: pathname === "/settings",
      disabled: !businessId,
    },
  ];

  return (
    <div className="mobile-app-canvas min-h-dvh">
      <div className="mx-auto min-h-[calc(100dvh-7rem)] w-full max-w-[480px] px-3 pb-28 pt-3 sm:px-4">
        <main className="space-y-3.5">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-bb-border bg-bb-mobile-nav-bg px-2 pb-[calc(env(safe-area-inset-bottom)+0.55rem)] pt-2 shadow-[0_-14px_34px_rgba(15,23,42,0.10)] backdrop-blur-xl md:hidden">
        <div className="mx-auto grid max-w-[480px] grid-cols-5 gap-1 rounded-lg border border-bb-border bg-bb-surface-card/82 p-1 shadow-[0_1px_0_rgba(255,255,255,0.65)_inset] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]">
          {items.map((item) => {
            const content = (
              <span
                className={cn(
                  "flex min-h-[3.2rem] flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[10px] font-semibold leading-none transition-[background-color,color,transform]",
                  item.active
                    ? "bg-bb-nav-active-bg text-bb-nav-active-fg shadow-sm"
                    : "text-muted-foreground hover:bg-bb-surface-soft hover:text-foreground",
                  item.disabled ? "opacity-45" : ""
                )}
              >
                <span className={cn("grid h-6 w-6 place-items-center rounded-md", item.active ? "bg-white/12" : "bg-transparent")}>
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </span>
            );

            if (item.disabled) {
              return (
                <span key={item.label} aria-disabled="true">
                  {content}
                </span>
              );
            }

            return (
              <Link key={item.label} href={item.href} prefetch={false} aria-current={item.active ? "page" : undefined}>
                {content}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
