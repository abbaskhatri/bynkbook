import { apiFetch } from "./client";

export type Vendor = {
  id: string;
  business_id: string;
  name: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export async function listVendors(args: {
  businessId: string;
  q?: string;
  sort?: "name_asc" | "name_desc" | "updated_desc";
}): Promise<{ ok: true; vendors: Vendor[] }> {
  const qs = new URLSearchParams();
  if (args.q) qs.set("q", args.q);
  qs.set("sort", args.sort ?? "name_asc");
  return apiFetch(`/v1/businesses/${args.businessId}/vendors?${qs.toString()}`);
}

export async function createVendor(args: {
  businessId: string;
  name: string;
  notes?: string;
}): Promise<{ ok: true; vendor: Vendor }> {
  return apiFetch(`/v1/businesses/${args.businessId}/vendors`, {
    method: "POST",
    body: JSON.stringify({ name: args.name, notes: args.notes }),
  });
}

export async function getVendor(args: {
  businessId: string;
  vendorId: string;
}): Promise<{ ok: true; vendor: Vendor }> {
  return apiFetch(`/v1/businesses/${args.businessId}/vendors/${args.vendorId}`);
}

export async function updateVendor(args: {
  businessId: string;
  vendorId: string;
  name?: string;
  notes?: string;
}): Promise<{ ok: true; vendor: Vendor }> {
  return apiFetch(`/v1/businesses/${args.businessId}/vendors/${args.vendorId}`, {
    method: "PATCH",
    body: JSON.stringify({ name: args.name, notes: args.notes }),
  });
}
