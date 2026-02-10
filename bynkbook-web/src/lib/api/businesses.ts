import { apiFetch } from "@/lib/api/client";

export type Business = {
  id: string;
  name: string;
  role?: string;
  created_at?: string;

  // Optional profile fields (Settings)
  address?: string | null;
  phone?: string | null;
  logo_url?: string | null;
  industry?: string | null;
  currency?: string;
  timezone?: string;
  fiscal_year_start_month?: number;
};

export async function listBusinesses(): Promise<Business[]> {
  const res: any = await apiFetch("/v1/businesses");
  return res?.businesses ?? [];
}

export async function createBusiness(input: {
  name: string;
  address?: string | null;
  phone?: string | null;
  logo_url?: string | null;
  industry?: string | null;
  currency?: string;
  timezone?: string;
  fiscal_year_start_month?: number;
}): Promise<Business> {
  const res: any = await apiFetch("/v1/businesses", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res?.business;
}

export async function patchBusiness(
  businessId: string,
  patch: Partial<Pick<
    Business,
    "address" | "phone" | "logo_url" | "industry" | "currency" | "timezone" | "fiscal_year_start_month"
  >>
): Promise<Business> {
  const res: any = await apiFetch(`/v1/businesses/${businessId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return res?.business;
}
