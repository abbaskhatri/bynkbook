"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { useAccounts } from "@/lib/queries/useAccounts";
import { useBusinesses } from "@/lib/queries/useBusinesses";

const LAST_BUSINESS_KEY = "bynkbook:lastBusinessId";

function readLocalStorage(key: string) {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

export function hrefWithMobileContext(params: {
  path: string;
  businessId?: string | null;
  accountId?: string | null;
  extra?: Record<string, string>;
}) {
  const q = new URLSearchParams();
  if (params.businessId) q.set("businessId", params.businessId);
  if (params.accountId) q.set("accountId", params.accountId);
  for (const [key, value] of Object.entries(params.extra ?? {})) q.set(key, value);
  const qs = q.toString();
  return qs ? `${params.path}?${qs}` : params.path;
}

export function useMobileWorkspaceContext() {
  const sp = useSearchParams();
  const businessesQ = useBusinesses();
  const businessIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;
  const accountIdFromUrl = sp.get("accountId") ?? null;

  const businessId = useMemo(() => {
    if (businessIdFromUrl) return businessIdFromUrl;

    const list = businessesQ.data ?? [];
    const storedBusinessId = readLocalStorage(LAST_BUSINESS_KEY);
    if (storedBusinessId && list.some((item) => item.id === storedBusinessId)) {
      return storedBusinessId;
    }

    return list[0]?.id ?? null;
  }, [businessIdFromUrl, businessesQ.data]);

  const business = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (!businessId) return null;
    return list.find((item) => item.id === businessId) ?? null;
  }, [businessId, businessesQ.data]);

  const businessNotFound = !!businessIdFromUrl && !businessesQ.isLoading && !!businessesQ.data && !business;
  const accountsQ = useAccounts(businessNotFound ? null : businessId);

  const activeAccounts = useMemo(
    () => (accountsQ.data ?? []).filter((account) => !account.archived_at),
    [accountsQ.data]
  );

  const accountId = useMemo(() => {
    if (accountIdFromUrl && accountIdFromUrl !== "all") return accountIdFromUrl;
    if (!businessId) return null;

    const storedAccountId = readLocalStorage(`bynkbook:lastAccountId:${businessId}`);
    if (storedAccountId && storedAccountId !== "all") {
      const ok = activeAccounts.some((account) => account.id === storedAccountId);
      if (ok) return storedAccountId;
    }

    return activeAccounts[0]?.id ?? null;
  }, [accountIdFromUrl, activeAccounts, businessId]);

  const account = useMemo(() => {
    if (!accountId) return null;
    return activeAccounts.find((item) => item.id === accountId) ?? null;
  }, [accountId, activeAccounts]);

  const accountNotFound =
    !!accountIdFromUrl &&
    accountIdFromUrl !== "all" &&
    !accountsQ.isLoading &&
    !!accountsQ.data &&
    !account;

  useEffect(() => {
    if (!businessId || businessNotFound) return;
    writeLocalStorage(LAST_BUSINESS_KEY, businessId);
  }, [businessId, businessNotFound]);

  useEffect(() => {
    if (!businessId || !accountId || accountNotFound) return;
    writeLocalStorage(`bynkbook:lastAccountId:${businessId}`, accountId);
  }, [accountId, accountNotFound, businessId]);

  const isLoading =
    businessesQ.isLoading ||
    (!!businessId && !businessNotFound && accountsQ.isLoading);

  const contextError =
    businessesQ.error ||
    accountsQ.error ||
    (businessNotFound ? new Error("The requested business is not available for this user.") : null) ||
    (accountNotFound ? new Error("The requested account is not available for this business.") : null);

  const contextReady = !!businessId && !!accountId && !businessNotFound && !accountNotFound && !isLoading;

  return {
    sp,
    businessesQ,
    accountsQ,
    activeAccounts,
    business,
    businessId,
    account,
    accountId,
    accountIdFromUrl,
    businessIdFromUrl,
    businessNotFound,
    accountNotFound,
    contextError,
    contextReady,
    isLoading,
  };
}
