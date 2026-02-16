import { apiFetch } from "./client";

export type Bill = {
  id: string;
  business_id: string;
  vendor_id: string;
  invoice_date: string;
  due_date: string;
  amount_cents: string;
  applied_cents: string;
  outstanding_cents: string;
  status: "OPEN" | "PARTIAL" | "PAID" | "VOID";
  memo?: string | null;
  terms?: string | null;
  upload_id?: string | null;
};

export async function listBillsByVendor(args: {
  businessId: string;
  vendorId: string;
  status?: "open" | "paid" | "all";
  limit?: number;
}): Promise<{ ok: true; bills: Bill[] }> {
  const qs = new URLSearchParams();
  qs.set("status", args.status ?? "all");
  qs.set("limit", String(Math.max(1, Math.min(200, args.limit ?? 200))));
  return apiFetch(`/v1/businesses/${args.businessId}/vendors/${args.vendorId}/bills?${qs.toString()}`);
}

export async function createBill(args: {
  businessId: string;
  vendorId: string;
  invoice_date: string;
  due_date: string;
  amount_cents: number;
  memo?: string;
  terms?: string;
  upload_id?: string;
}): Promise<{ ok: true; bill: Bill }> {
  return apiFetch(`/v1/businesses/${args.businessId}/vendors/${args.vendorId}/bills`, {
    method: "POST",
    body: JSON.stringify({
      invoice_date: args.invoice_date,
      due_date: args.due_date,
      amount_cents: args.amount_cents,
      memo: args.memo,
      terms: args.terms,
      upload_id: args.upload_id,
    }),
  });
}

export async function updateBill(args: {
  businessId: string;
  vendorId: string;
  billId: string;
  invoice_date?: string;
  due_date?: string;
  amount_cents?: number;
  memo?: string;
  terms?: string;
  upload_id?: string | null;
}): Promise<{ ok: true; bill: Bill }> {
  return apiFetch(`/v1/businesses/${args.businessId}/vendors/${args.vendorId}/bills/${args.billId}`, {
    method: "PATCH",
    body: JSON.stringify({
      invoice_date: args.invoice_date,
      due_date: args.due_date,
      amount_cents: args.amount_cents,
      memo: args.memo,
      terms: args.terms,
      upload_id: args.upload_id,
    }),
  });
}

export async function voidBill(args: {
  businessId: string;
  vendorId: string;
  billId: string;
  reason?: string;
}): Promise<{ ok: true; bill_id: string; status: "VOID" }> {
  return apiFetch(`/v1/businesses/${args.businessId}/vendors/${args.vendorId}/bills/${args.billId}/void`, {
    method: "POST",
    body: JSON.stringify({ reason: args.reason }),
  });
}

export type VendorApSummary = {
  as_of: string;
  total_open_cents: string;
  aging: { current: string; days_30: string; days_60: string; days_90: string };
};

export async function getVendorApSummary(args: {
  businessId: string;
  vendorId: string;
  asOf?: string;
}): Promise<{ ok: true; summary: VendorApSummary }> {
  const qs = new URLSearchParams();
  if (args.asOf) qs.set("asOf", args.asOf);
  return apiFetch(`/v1/businesses/${args.businessId}/vendors/${args.vendorId}/ap/summary?${qs.toString()}`);
}

export async function getVendorsApSummary(args: {
  businessId: string;
  asOf?: string;
  limit?: number;
  vendorIds?: string[];
}): Promise<{
  ok: true;
  as_of: string;
  vendors: Array<{
    vendor_id: string;
    vendor_name: string;
    total_open_cents: string;
    aging: { current: string; days_30: string; days_60: string; days_90: string };
  }>;
}> {
  const qs = new URLSearchParams();
  if (args.asOf) qs.set("asOf", args.asOf);
  qs.set("limit", String(Math.max(1, Math.min(200, args.limit ?? 200))));
  if (args.vendorIds?.length) qs.set("vendor_ids", args.vendorIds.slice(0, 200).join(","));
  return apiFetch(`/v1/businesses/${args.businessId}/ap/vendors-summary?${qs.toString()}`);
}

export async function applyVendorPayment(args: {
  businessId: string;
  accountId: string;
  entryId: string;
  applications: Array<{ bill_id: string; applied_amount_cents: number }>;
}): Promise<any> {
  return apiFetch(`/v1/businesses/${args.businessId}/accounts/${args.accountId}/entries/${args.entryId}/ap/apply`, {
    method: "POST",
    body: JSON.stringify({ applications: args.applications }),
  });
}

export async function unapplyVendorPayment(args: {
  businessId: string;
  accountId: string;
  entryId: string;
  bill_ids?: string[];
  all?: boolean;
  reason?: string;
}): Promise<any> {
  return apiFetch(`/v1/businesses/${args.businessId}/accounts/${args.accountId}/entries/${args.entryId}/ap/unapply`, {
    method: "POST",
    body: JSON.stringify({ bill_ids: args.bill_ids, all: args.all, reason: args.reason }),
  });
}
