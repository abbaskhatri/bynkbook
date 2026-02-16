import { apiFetch } from "@/lib/api/client";

/**
 * We normalize the API response because implementations may vary slightly.
 */
export type Entry = {
  id: string;
  business_id: string;
  account_id: string;
  date: string; // YYYY-MM-DD
  payee: string | null;
  memo: string | null;
  amount_cents: string; // integer string (safe for BigInt)
  type: string;
  method: string | null;
  status: string;

  category_id?: string | null;
  category_name?: string | null;

  vendor_id?: string | null;
  vendor_name?: string | null;

  transfer_id?: string | null;
  transfer_other_account_id?: string | null;
  transfer_other_account_name?: string | null;
  transfer_direction?: "IN" | "OUT" | null;

  is_adjustment?: boolean;

  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

function pick(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined) return v;
  }
  return undefined;
}

function asString(v: any): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object") {
    const inner =
      v.$bigint ?? v.bigint ?? v.value ?? v.amount_cents ?? v.amountCents ?? v.amount;
    if (inner !== undefined) return asString(inner);
  }
  try {
    return String(v);
  } catch {
    return null;
  }
}

function asCentsString(v: any): string {
  const s = asString(v);
  if (!s) return "0";
  const trimmed = s.trim();
  if (/^-?\d+$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^-?\d+/);
  if (m) return m[0];
  return "0";
}

function normalizeEntry(raw: any): Entry {
  const id = asString(pick(raw, ["id", "entry_id", "entryId"])) ?? "";
  const business_id = asString(pick(raw, ["business_id", "businessId"])) ?? "";
  const account_id = asString(pick(raw, ["account_id", "accountId"])) ?? "";

  const date = (asString(pick(raw, ["date"])) ?? "").slice(0, 10);

  const payee =
    asString(pick(raw, ["payee", "payee_name", "payeeName", "description", "merchant"])) ?? null;

  const memo = asString(pick(raw, ["memo", "note", "notes"])) ?? null;

  const amount_cents = asCentsString(pick(raw, ["amount_cents", "amountCents", "amount"]));

  const type = asString(pick(raw, ["type", "entry_type", "entryType"])) ?? "";
  const method = asString(pick(raw, ["method", "entry_method", "entryMethod"])) ?? null;
  const status = asString(pick(raw, ["status"])) ?? "";

  const category_id = asString(pick(raw, ["category_id", "categoryId"])) ?? null;
  const category_name = asString(pick(raw, ["category_name", "categoryName"])) ?? null;

  const vendor_id = asString(pick(raw, ["vendor_id", "vendorId"])) ?? null;
  const vendor_name = asString(pick(raw, ["vendor_name", "vendorName"])) ?? null;

  const transfer_id = asString(pick(raw, ["transfer_id", "transferId"])) ?? null;
  const transfer_other_account_id =
    asString(pick(raw, ["transfer_other_account_id", "transferOtherAccountId"])) ?? null;
  const transfer_other_account_name =
    asString(pick(raw, ["transfer_other_account_name", "transferOtherAccountName"])) ?? null;

  const transfer_direction_raw = asString(pick(raw, ["transfer_direction", "transferDirection"])) ?? null;
  const transfer_direction =
    transfer_direction_raw && (transfer_direction_raw.toUpperCase() === "IN" || transfer_direction_raw.toUpperCase() === "OUT")
      ? (transfer_direction_raw.toUpperCase() as "IN" | "OUT")
      : null;

  const is_adjustment_raw = pick(raw, ["is_adjustment", "isAdjustment"]);
  const is_adjustment = !!(
    is_adjustment_raw === true ||
    is_adjustment_raw === 1 ||
    String(is_adjustment_raw ?? "").toLowerCase() === "true"
  );

  const deleted_at = asString(pick(raw, ["deleted_at", "deletedAt"])) ?? null;
  const created_at = asString(pick(raw, ["created_at", "createdAt"])) ?? new Date().toISOString();
  const updated_at = asString(pick(raw, ["updated_at", "updatedAt"])) ?? created_at;

  return {
    id,
    business_id,
    account_id,
    date,
    payee,
    memo,
    amount_cents,
    type,
    method,
    status,
    category_id,
    category_name,
    vendor_id,
    vendor_name,
    transfer_id,
    transfer_other_account_id,
    transfer_other_account_name,
    transfer_direction,
    is_adjustment,
    deleted_at,
    created_at,
    updated_at,
  };
}

export async function listEntries(params: {
  businessId: string;
  accountId: string;
  limit: number;
  includeDeleted?: boolean;
  type?: string; // e.g. "EXPENSE" or "EXPENSE,INCOME"
  vendorId?: string;
  date_from?: string;
  date_to?: string;
}): Promise<Entry[]> {
  const { businessId, accountId, limit, includeDeleted } = params;

  const qs = new URLSearchParams();
  qs.set("limit", String(Math.max(1, Math.min(200, limit))));
  if (includeDeleted) qs.set("include_deleted", "true");
  if (params.type) qs.set("type", params.type);
  if (params.vendorId) qs.set("vendorId", params.vendorId);
  if (params.date_from) qs.set("date_from", params.date_from);
  if (params.date_to) qs.set("date_to", params.date_to);

  const url = `/v1/businesses/${businessId}/accounts/${accountId}/entries?${qs.toString()}`;

  const res: any = await apiFetch(url);

  const rows = res?.entries ?? [];
  return Array.isArray(rows) ? rows.map(normalizeEntry) : [];
}

export async function createEntry(params: {
  businessId: string;
  accountId: string;
  input: {
    date: string; // YYYY-MM-DD
    payee: string;
    memo?: string;
    category_id?: string | null;
    vendor_id?: string | null;
    amount_cents: number; // signed integer cents
    type: string; // EXPENSE | INCOME | ADJUSTMENT | ...
    method: string; // CARD | ...
    status: string; // EXPECTED | ...
  };
}): Promise<Entry> {
  const { businessId, accountId, input } = params;

  // Send both snake_case and camelCase aliases (compat safe)
  const payload: any = {
    date: input.date,

    payee: input.payee,
    payeeName: input.payee,

    memo: input.memo ?? null,
    notes: input.memo ?? null,

    category_id: input.category_id ?? null,
    categoryId: input.category_id ?? null,

    vendor_id: input.vendor_id ?? null,
    vendorId: input.vendor_id ?? null,

    amount_cents: input.amount_cents,
    amountCents: input.amount_cents,

    type: input.type,
    entry_type: input.type,
    entryType: input.type,

    method: input.method,
    entry_method: input.method,
    entryMethod: input.method,

    status: input.status,
  };

  const res: any = await apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/entries`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const rawEntry = res?.entry ?? res?.data?.entry ?? null;

  if (rawEntry) {
    return normalizeEntry({
      ...payload,
      ...rawEntry,
      business_id: businessId,
      account_id: accountId,
    });
  }

  return normalizeEntry({
    ...payload,
    business_id: businessId,
    account_id: accountId,
    id: res?.id ?? "",
  });
}

export async function updateEntry(params: {
  businessId: string;
  accountId: string;
  entryId: string;
  updates: {
    date?: string; // YYYY-MM-DD
    payee?: string;
    memo?: string;
    amount_cents?: number; // signed integer cents
    type?: string;
    method?: string;
    status?: string;
    category_id?: string | null;
    vendor_id?: string | null;
  };
}): Promise<Entry> {
  const { businessId, accountId, entryId, updates } = params;

  const res: any = await apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/entries/${entryId}`,
    {
      method: "PUT",
      body: JSON.stringify(updates),
    }
  );

  // Handler returns { ok: true, entry: {...} }
  const row = res?.entry ?? res;
  return normalizeEntry(row);
}

export async function hardDeleteEntry(params: {
  businessId: string;
  accountId: string;
  entryId: string;
}): Promise<{ hardDeleted: boolean }> {
  const { businessId, accountId, entryId } = params;

  const res: any = await apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/entries/${entryId}/hard`,
    { method: "DELETE" }
  );

  return { hardDeleted: !!res?.hard_deleted || res?.ok === true };
}

export async function deleteEntry(params: {
  businessId: string;
  accountId: string;
  entryId: string;
}): Promise<{ deleted: boolean }> {
  const { businessId, accountId, entryId } = params;
  const res: any = await apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/entries/${entryId}`,
    { method: "DELETE" }
  );
  return { deleted: !!res?.deleted || res?.ok === true };
}

export async function restoreEntry(params: {
  businessId: string;
  accountId: string;
  entryId: string;
}): Promise<{ restored: boolean }> {
  const { businessId, accountId, entryId } = params;
  const res: any = await apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/entries/${entryId}/restore`,
    { method: "POST" }
  );
  return { restored: !!res?.restored || res?.ok === true };
}
