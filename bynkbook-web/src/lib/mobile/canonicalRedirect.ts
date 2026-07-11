export type MobileRedirectParams = Record<string, string | string[] | undefined>;

export function canonicalMobileRedirectTarget(path: string, params: MobileRedirectParams): string {
  const target = new URLSearchParams();
  const businessId = params.businessId ?? params.businessesId;
  const accountId = params.accountId;
  if (typeof businessId === "string" && businessId) target.set("businessId", businessId);
  if (typeof accountId === "string" && accountId) target.set("accountId", accountId);
  const query = target.toString();
  return query ? `${path}?${query}` : path;
}
