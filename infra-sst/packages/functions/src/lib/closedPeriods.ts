export function normalizeToYmd(input: any): string | null {
  if (!input) return null;

  // Date object -> YYYY-MM-DD using ISO (no month math)
  if (input instanceof Date) {
    const iso = input.toISOString();
    return iso.slice(0, 10);
  }

  const s = String(input).trim();
  if (!s) return null;

  // If ISO-like, take first 10 chars
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);

  // Plain YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  return null;
}

export function ymdToMonth(ymd: string): string {
  // ymd must be normalized YYYY-MM-DD
  return ymd.slice(0, 7);
}

export function closedPeriod409(_month: string) {
  return {
    statusCode: 409,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: false,
      code: "CLOSED_PERIOD",
      error: "This period is closed. Reopen period to modify.",
    }),
  };
}

export async function isMonthClosed(prisma: any, businessId: string, month: string): Promise<boolean> {
  const row = await prisma.closedPeriod.findFirst({
    where: { business_id: businessId, month },
    select: { id: true },
  });
  return !!row;
}

export async function assertNotClosedPeriod(args: {
  prisma: any;
  businessId: string;
  dateInput: any; // string YYYY-MM-DD or Date or ISO string
}): Promise<{ ok: true; ymd: string; month: string } | { ok: false; response: any }> {
  const ymd = normalizeToYmd(args.dateInput);
  if (!ymd) {
    // If date is missing/invalid, we don't enforce here; caller should validate payload separately
    return { ok: true, ymd: "0000-00-00", month: "0000-00" };
  }

  const month = ymdToMonth(ymd);
  const closed = await isMonthClosed(args.prisma, args.businessId, month);
  if (closed) return { ok: false, response: closedPeriod409(month) };

  return { ok: true, ymd, month };
}

/**
 * Closed period enforcement for mutations that affect entries.
 * Rule: if ANY involved stored entry.date falls in a closed month -> 409 CLOSED_PERIOD.
 */
export async function assertNotClosedPeriodForEntryIds(args: {
  prisma: any;
  businessId: string;
  entryIds: any; // string[] (tolerate unknown input)
}): Promise<{ ok: true } | { ok: false; response: any }> {
  const idsIn = Array.isArray(args.entryIds) ? args.entryIds : [];
  const ids = idsIn.map((x: any) => String(x ?? "").trim()).filter(Boolean);
  if (!ids.length) return { ok: true };

  const rows = await args.prisma.entry.findMany({
    where: { business_id: args.businessId, id: { in: ids }, deleted_at: null },
    select: { date: true },
  });

  const months = new Set<string>();
  for (const r of rows) {
    const ymd = normalizeToYmd(r?.date);
    if (ymd) months.add(ymdToMonth(ymd));
  }
  if (!months.size) return { ok: true };

  const closed = await args.prisma.closedPeriod.findFirst({
    where: { business_id: args.businessId, month: { in: Array.from(months) } },
    select: { month: true },
  });

  if (closed?.month) return { ok: false, response: closedPeriod409(String(closed.month)) };
  return { ok: true };
}
