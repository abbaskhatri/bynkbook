"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileText,
  Home,
  ReceiptText,
  Tags,
  Users,
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
      href: withBusiness("/mobile", businessId, accountId),
      icon: <Home className="h-5 w-5" />,
      active: pathname === "/mobile",
    },
    {
      label: "Review",
      href: withBusiness("/mobile/review", businessId, accountId),
      icon: <Tags className="h-5 w-5" />,
      active:
        pathname === "/mobile/review" ||
        pathname === "/mobile/uncategorized" ||
        pathname === "/mobile/issues",
      disabled: !businessId || !accountId,
    },
    {
      label: "Receipt",
      href: withBusiness("/mobile/receipt", businessId, accountId),
      icon: <ReceiptText className="h-5 w-5" />,
      active: pathname === "/mobile/receipt",
      disabled: !businessId,
    },
    {
      label: "Vendors",
      href: withBusiness("/mobile/vendors", businessId, accountId),
      icon: <Users className="h-5 w-5" />,
      active: pathname === "/mobile/vendors",
      disabled: !businessId,
    },
    {
      label: "Invoice",
      href: withBusiness("/mobile/invoice", businessId, accountId),
      icon: <FileText className="h-5 w-5" />,
      active: pathname === "/mobile/invoice",
      disabled: !businessId,
    },
  ];

  return (
    <div className="mx-auto min-h-[calc(100dvh-7rem)] w-full max-w-[480px] pb-24">
      {children}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-10px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-[480px] grid-cols-5 gap-1">
          {items.map((item) => {
            const content = (
              <span
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-medium",
                  item.active
                    ? "bg-bb-nav-active-bg text-bb-nav-active-fg"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  item.disabled ? "opacity-45" : ""
                )}
              >
                {item.icon}
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
              <Link key={item.label} href={item.href} prefetch>
                {content}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
