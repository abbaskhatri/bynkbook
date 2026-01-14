import { apiFetch } from "@/lib/api/client";

export type Business = {
  id: string;
  name: string;
  role?: string;
  created_at?: string;
};

export async function listBusinesses(): Promise<Business[]> {
  const res: any = await apiFetch("/v1/businesses");
  return res?.businesses ?? [];
}

export async function createBusiness(name: string): Promise<Business> {
  const res: any = await apiFetch("/v1/businesses", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return res?.business;
}
