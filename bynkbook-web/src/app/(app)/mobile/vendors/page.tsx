import { redirect } from "next/navigation";
import { canonicalMobileRedirectTarget, type MobileRedirectParams } from "@/lib/mobile/canonicalRedirect";

export default async function MobileVendorsPage({ searchParams }: { searchParams: Promise<MobileRedirectParams> }) {
  redirect(canonicalMobileRedirectTarget("/vendors", await searchParams));
}
