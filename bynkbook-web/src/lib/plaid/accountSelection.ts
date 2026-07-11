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

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
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
