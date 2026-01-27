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

export function closedPeriod409(month: string) {
  return {
    statusCode: 409,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: false,
      code: "CLOSED_PERIOD",
      error: "This period is closed.",
      month,
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
