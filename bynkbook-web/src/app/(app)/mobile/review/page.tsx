import { redirect } from "next/navigation";
import { canonicalMobileRedirectTarget, type MobileRedirectParams } from "@/lib/mobile/canonicalRedirect";

export default async function MobileReviewPage({ searchParams }: { searchParams: Promise<MobileRedirectParams> }) {
  redirect(canonicalMobileRedirectTarget("/category-review", await searchParams));
}
