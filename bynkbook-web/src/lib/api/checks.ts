import { apiFetch } from "./client";

export type CheckStatus = "DRAFT" | "OUTSTANDING" | "CLEARED" | "VOIDED";

export type CheckBillAllocation = {
  bill_id: string;
  invoice_date: string;
  due_date: string;
  memo?: string | null;
  bill_amount_cents: string;
  applied_amount_cents: string;
};

export type CheckPayment = {
  id: string;
  business_id: string;
  account_id: string;
  account_name?: string | null;
  entry_id?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  check_number: string;
  issued_date: string;
  payee_name: string;
  payee_address?: string | null;
  amount_cents: string;
  memo?: string | null;
  purpose: "GENERAL" | "VENDOR_PAYMENT" | "BILL_PAYMENT";
  bill_allocations: CheckBillAllocation[];
  template_code: "SSLT104";
  status: CheckStatus;
  stored_status: "DRAFT" | "PRINTED" | "VOIDED";
  print_count: number;
  last_printed_at?: string | null;
  confirmed_at?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  created_at: string;
  updated_at: string;
};

export type CheckPrintSetting = {
  account_id: string;
  template_code: "SSLT104";
  next_check_number: string;
  offset_x_mils: number;
  offset_y_mils: number;
};

export async function listChecks(businessId: string): Promise<{
  ok: true;
  checks: CheckPayment[];
  settings: CheckPrintSetting[];
  template: { code: "SSLT104"; label: string; paper: "Letter"; check_position: "TOP" };
}> {
  return apiFetch(`/v1/businesses/${businessId}/checks`);
}

export async function saveCheckPrintSetting(args: {
  businessId: string;
  accountId: string;
  next_check_number: string;
  offset_x_mils: number;
  offset_y_mils: number;
}) {
  return apiFetch(`/v1/businesses/${args.businessId}/checks/settings/${args.accountId}`, {
    method: "PUT",
    body: JSON.stringify({
      next_check_number: args.next_check_number,
      offset_x_mils: args.offset_x_mils,
      offset_y_mils: args.offset_y_mils,
      template_code: "SSLT104",
    }),
  });
}

export async function createCheckDraft(args: {
  businessId: string;
  account_id: string;
  vendor_id?: string | null;
  category_id?: string | null;
  check_number: string;
  issued_date: string;
  payee_name: string;
  payee_address?: string | null;
  amount_cents: number;
  memo?: string | null;
  bill_allocations?: Array<{ bill_id: string; applied_amount_cents: number }>;
}): Promise<{ ok: true; check: CheckPayment }> {
  return apiFetch(`/v1/businesses/${args.businessId}/checks`, {
    method: "POST",
    body: JSON.stringify(args),
  });
}

export async function confirmCheckPrint(businessId: string, checkId: string): Promise<{ ok: true; check: CheckPayment }> {
  return apiFetch(`/v1/businesses/${businessId}/checks/${checkId}/confirm-print`, { method: "POST" });
}

export async function voidCheck(businessId: string, checkId: string, reason: string): Promise<{ ok: true; check: CheckPayment }> {
  return apiFetch(`/v1/businesses/${businessId}/checks/${checkId}/void`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
