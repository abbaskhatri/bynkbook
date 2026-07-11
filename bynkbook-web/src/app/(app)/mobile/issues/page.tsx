import { redirect } from "next/navigation";
import { canonicalMobileRedirectTarget, type MobileRedirectParams } from "@/lib/mobile/canonicalRedirect";

export default async function MobileIssuesPage({ searchParams }: { searchParams: Promise<MobileRedirectParams> }) {
  redirect(canonicalMobileRedirectTarget("/issues", await searchParams));
}
