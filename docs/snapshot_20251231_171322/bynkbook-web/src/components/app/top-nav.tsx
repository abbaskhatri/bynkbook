"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function TopNav() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const businessId = sp.get("businessId") ?? sp.get("businessesId") ?? "";

  const dashHref = businessId ? `/dashboard?businessId=${businessId}` : "/dashboard";
  const accountsHref = businessId ? `/accounts?businessId=${businessId}` : "/accounts";
  const ledgerHref = businessId ? `/ledger?businessId=${businessId}` : "/ledger";

  const isDash = pathname.startsWith("/dashboard");
  const isAccounts = pathname.startsWith("/accounts");
  const isLedger = pathname.startsWith("/ledger");

  return (
    <div className="flex items-center justify-between gap-3 pb-4">
      <div className="flex items-center gap-2">
        <Button asChild variant={isDash ? "default" : "outline"} size="sm">
          <Link href={dashHref}>Dashboard</Link>
        </Button>

        <Button asChild variant={isAccounts ? "default" : "outline"} size="sm">
          <Link href={accountsHref}>Accounts</Link>
        </Button>

        <Button asChild variant={isLedger ? "default" : "outline"} size="sm">
          <Link href={ledgerHref}>Ledger</Link>
        </Button>
      </div>
    </div>
  );
}
