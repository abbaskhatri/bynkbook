import { redirect } from "next/navigation";

/** @deprecated Accounts are managed in Settings. Kept as a server redirect for old bookmarks. */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const businessId = params.businessId ?? params.businessesId;
  const target = new URLSearchParams({ tab: "accounts" });
  if (typeof businessId === "string" && businessId) target.set("businessId", businessId);
  redirect(`/settings?${target.toString()}`);
}
