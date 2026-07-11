import { redirect } from "next/navigation";
import { canonicalMobileRedirectTarget, type MobileRedirectParams } from "@/lib/mobile/canonicalRedirect";

export default async function MobilePage({ searchParams }: { searchParams: Promise<MobileRedirectParams> }) {
  redirect(canonicalMobileRedirectTarget("/dashboard", await searchParams));
}
