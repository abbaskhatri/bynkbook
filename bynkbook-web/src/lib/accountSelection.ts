"use client";

import { useEffect, useMemo, useState } from "react";

export type AccountSelectionRow = {
  id: string;
  archived_at?: string | null;
  type?: string | null;
};

type AccountSelectionOptions = {
  allowAll?: boolean;
  excludeCash?: boolean;
  excludeTemp?: boolean;
};

type PickPreferredAccountArgs<T extends AccountSelectionRow> = AccountSelectionOptions & {
  accounts: T[];
  accountIdFromUrl?: string | null;
  storedAccountId?: string | null;
};

type UsePreferredAccountArgs<T extends AccountSelectionRow> = AccountSelectionOptions & {
  accounts: T[];
  businessId?: string | null;
  accountIdFromUrl?: string | null;
};

export function lastAccountStorageKey(businessId: string) {
  return `bynkbook:lastAccountId:${businessId}`;
}

export function readLastSelectedAccountId(businessId?: string | null) {
  if (!businessId || typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(lastAccountStorageKey(businessId));
  } catch {
    return null;
  }
}

export function writeLastSelectedAccountId(businessId?: string | null, accountId?: string | null) {
  if (!businessId || !accountId || accountId === "all" || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(lastAccountStorageKey(businessId), accountId);
  } catch {}
}

export function isSelectableAccount(account: AccountSelectionRow, options: AccountSelectionOptions = {}) {
  if (!account?.id) return false;
  if (account.archived_at) return false;
  if (options.excludeTemp && String(account.id).startsWith("temp_")) return false;
  if (options.excludeCash && String(account.type ?? "").toUpperCase() === "CASH") return false;
  return true;
}

export function selectableAccounts<T extends AccountSelectionRow>(
  accounts: T[],
  options: AccountSelectionOptions = {}
) {
  return accounts.filter((account) => isSelectableAccount(account, options));
}

export function pickPreferredAccountId<T extends AccountSelectionRow>({
  accounts,
  accountIdFromUrl,
  storedAccountId,
  allowAll = false,
  excludeCash = false,
  excludeTemp = false,
}: PickPreferredAccountArgs<T>) {
  const options = { excludeCash, excludeTemp };
  const selectable = selectableAccounts(accounts, options);
  const requested = accountIdFromUrl ? String(accountIdFromUrl) : "";

  if (allowAll && requested === "all") return "all";

  if (requested && requested !== "all") {
    const requestedAllowed = (!excludeTemp || !requested.startsWith("temp_"));
    if (requestedAllowed && (selectable.length === 0 || selectable.some((account) => String(account.id) === requested))) {
      return requested;
    }
  }

  const stored = storedAccountId ? String(storedAccountId) : "";
  if (stored && stored !== "all" && (!excludeTemp || !stored.startsWith("temp_"))) {
    const storedAccount = selectable.find((account) => String(account.id) === stored);
    if (storedAccount) return stored;
  }

  return selectable[0]?.id ?? "";
}

export function usePreferredAccountId<T extends AccountSelectionRow>({
  accounts,
  businessId,
  accountIdFromUrl,
  allowAll = false,
  excludeCash = false,
  excludeTemp = false,
}: UsePreferredAccountArgs<T>) {
  const [storedAccount, setStoredAccount] = useState<{
    businessId: string | null;
    accountId: string | null;
    ready: boolean;
  }>({ businessId: null, accountId: null, ready: false });

  useEffect(() => {
    if (!businessId) {
      setStoredAccount({ businessId: null, accountId: null, ready: true });
      return;
    }

    setStoredAccount({
      businessId,
      accountId: readLastSelectedAccountId(businessId),
      ready: true,
    });
  }, [businessId]);

  const selectedAccountId = useMemo(() => {
    const requested = accountIdFromUrl ? String(accountIdFromUrl) : "";
    const explicitRealAccount = requested && requested !== "all";

    if (!explicitRealAccount && (!storedAccount.ready || storedAccount.businessId !== businessId)) {
      return "";
    }

    return pickPreferredAccountId({
      accounts,
      accountIdFromUrl,
      storedAccountId: storedAccount.businessId === businessId ? storedAccount.accountId : null,
      allowAll,
      excludeCash,
      excludeTemp,
    });
  }, [
    accountIdFromUrl,
    accounts,
    allowAll,
    businessId,
    excludeCash,
    excludeTemp,
    storedAccount.accountId,
    storedAccount.businessId,
    storedAccount.ready,
  ]);

  useEffect(() => {
    const requested = accountIdFromUrl ? String(accountIdFromUrl) : "";
    const explicitRealAccount = requested && requested !== "all";
    if (!explicitRealAccount && !storedAccount.ready) return;
    writeLastSelectedAccountId(businessId, selectedAccountId);
  }, [accountIdFromUrl, businessId, selectedAccountId, storedAccount.ready]);

  return selectedAccountId;
}
