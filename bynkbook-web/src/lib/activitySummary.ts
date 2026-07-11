const SAFE_ACTIVITY_FIELDS: Record<string, string> = {
  month: "Month",
  through_date: "Through date",
  date: "Date",
  from: "From",
  to: "To",
  status: "Status",
  role: "Role",
  previous_role: "Previous role",
  new_role: "New role",
  count: "Count",
  reason: "Reason",
  account_name: "Account",
  vendor_name: "Vendor",
};

export type ActivitySummaryItem = { label: string; value: string };

export function summarizeActivityPayload(payload: unknown): ActivitySummaryItem[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];

  return Object.entries(payload as Record<string, unknown>).flatMap(([key, rawValue]) => {
    const label = SAFE_ACTIVITY_FIELDS[key];
    if (!label || rawValue === null || rawValue === undefined) return [];
    if (!["string", "number", "boolean"].includes(typeof rawValue)) return [];
    const value = String(rawValue).trim();
    if (!value) return [];
    return [{ label, value: value.slice(0, 160) }];
  });
}
