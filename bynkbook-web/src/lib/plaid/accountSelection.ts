export type RequiredPlaidAccount = {
  plaidAccountId?: string | null;
  mask?: string | null;
  plaidType?: string | null;
  plaidSubtype?: string | null;
  name?: string | null;
};

export type ReturnedPlaidAccount = {
  id?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
};

export type RelatedBynkbookAccount = RequiredPlaidAccount & {
  accountId?: string | null;
};

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizedBynkbookAccountType(value: unknown) {
  const raw = normalized(value).replace(/[^a-z]/g, "");
  if (raw.includes("credit")) return "creditcard";
  if (raw.includes("saving")) return "savings";
  if (raw.includes("checking") || raw === "depository") return "checking";
  return raw;
}

function returnedAccountType(account: ReturnedPlaidAccount) {
  const subtype = normalizedBynkbookAccountType(account?.subtype);
  if (subtype) return subtype;
  return normalizedBynkbookAccountType(account?.type);
}

export function plaidAccountSelectionMatches(
  required: RequiredPlaidAccount,
  returned: ReturnedPlaidAccount,
) {
  const requiredId = String(required?.plaidAccountId ?? "").trim();
  const returnedId = String(returned?.id ?? "").trim();
  if (requiredId && returnedId && requiredId === returnedId) return true;

  // Plaid documents that account_id can change after reauthorization. Fall
  // back to the stable account identity fields so the same selected account is
  // not rejected merely because Plaid issued a replacement identifier.
  const requiredMask = normalized(required?.mask);
  const returnedMask = normalized(returned?.mask);
  if (!requiredMask || requiredMask !== returnedMask) return false;

  const requiredType = normalized(required?.plaidType);
  const returnedType = normalized(returned?.type);
  if (requiredType && returnedType && requiredType !== returnedType) return false;

  const requiredSubtype = normalized(required?.plaidSubtype);
  const returnedSubtype = normalized(returned?.subtype);
  if (requiredSubtype && returnedSubtype && requiredSubtype !== returnedSubtype) return false;

  return true;
}

export function missingRequiredPlaidAccount(
  requiredAccounts: RequiredPlaidAccount[],
  returnedAccounts: ReturnedPlaidAccount[],
) {
  return requiredAccounts.find(
    (required) => !returnedAccounts.some((returned) => plaidAccountSelectionMatches(required, returned)),
  );
}

export function splitPlaidAccountsByExistingMapping<T extends ReturnedPlaidAccount>(
  returnedAccounts: T[],
  relatedAccounts: RelatedBynkbookAccount[],
) {
  const existing: Array<{ account: T; mapping: RelatedBynkbookAccount }> = [];
  const unmatched: T[] = [];
  const remainingMappings = [...relatedAccounts];

  for (const account of returnedAccounts) {
    const mappingIndex = remainingMappings.findIndex((related) =>
      plaidAccountSelectionMatches(related, account),
    );
    if (mappingIndex < 0) {
      unmatched.push(account);
      continue;
    }

    const [mapping] = remainingMappings.splice(mappingIndex, 1);
    existing.push({ account, mapping });
  }

  return { existing, unmatched };
}

export function resolveTargetPlaidAccount<T extends ReturnedPlaidAccount>(params: {
  returnedAccounts: T[];
  requiredAccounts: RequiredPlaidAccount[];
  relatedAccounts: RelatedBynkbookAccount[];
  targetBynkbookAccountId?: string | null;
  targetMask?: string | null;
  targetType?: string | null;
}) {
  const mappedTarget = splitPlaidAccountsByExistingMapping(
    params.returnedAccounts,
    params.relatedAccounts,
  ).existing.filter(({ mapping }) =>
    String(mapping.accountId ?? "") === String(params.targetBynkbookAccountId ?? ""),
  );
  if (mappedTarget.length === 1) {
    return { account: mappedTarget[0].account, certain: true, reason: "existing_mapping" as const };
  }

  const targetMask = normalized(params.targetMask);
  const maskMatches = targetMask
    ? params.returnedAccounts.filter((account) => normalized(account.mask) === targetMask)
    : [];
  if (maskMatches.length === 1) {
    return { account: maskMatches[0], certain: true, reason: "unique_mask" as const };
  }

  const targetType = normalizedBynkbookAccountType(params.targetType);
  const typeMatches = targetType
    ? params.returnedAccounts.filter((account) => returnedAccountType(account) === targetType)
    : [];
  if (typeMatches.length === 1) {
    return { account: typeMatches[0], certain: true, reason: "unique_type" as const };
  }

  const newlyShared = params.returnedAccounts.filter(
    (account) => !params.requiredAccounts.some((required) =>
      plaidAccountSelectionMatches(required, account),
    ),
  );
  if (newlyShared.length === 1) {
    return { account: newlyShared[0], certain: true, reason: "single_new_account" as const };
  }

  return {
    account: params.returnedAccounts[0] ?? null,
    certain: false,
    reason: "ambiguous" as const,
  };
}
