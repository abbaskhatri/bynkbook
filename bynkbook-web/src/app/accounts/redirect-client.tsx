"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AccountsRedirectClient() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    const businessId = sp.get("businessId") ?? sp.get("businessesId");
    const params = new URLSearchParams();
    if (businessId) params.set("businessId", businessId);
    params.set("tab", "accounts");
    router.replace(`/settings?${params.toString()}`);
  }, [router, sp]);

  return null;
}
