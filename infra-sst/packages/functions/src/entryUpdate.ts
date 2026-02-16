  import { getPrisma } from "./lib/db";
  import { assertNotClosedPeriod } from "./lib/closedPeriods";

  const ENTRY_TYPES = ["EXPENSE", "INCOME", "TRANSFER", "ADJUSTMENT"] as const;
  const ENTRY_STATUS = ["EXPECTED", "CLEARED"] as const;
  const ENTRY_KIND = ["GENERAL", "VENDOR_PAYMENT"] as const;

  function json(statusCode: number, body: any) {
    return {
      statusCode,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  function getClaims(event: any) {
    const auth = event?.requestContext?.authorizer ?? {};
    return auth?.jwt?.claims ?? auth?.claims ?? {};
  }

  function pp(event: any) {
    return event?.pathParameters ?? {};
  }

  async function requireMembership(prisma: any, businessId: string, userId: string) {
    const row = await prisma.userBusinessRole.findFirst({
      where: { business_id: businessId, user_id: userId },
      select: { role: true },
    });
    return row?.role ?? null;
  }

  async function requireAccountInBusiness(prisma: any, businessId: string, accountId: string) {
    const acct = await prisma.account.findFirst({
      where: { id: accountId, business_id: businessId },
      select: { id: true },
    });
    return !!acct;
  }

  function toIso(d: any) {
    if (!d) return null;
    try {
      return typeof d === "string" ? d : d.toISOString();
    } catch {
      return String(d);
    }
  }

  function serializeEntry(e: any) {
    return {
      id: e.id,
      business_id: e.business_id,
      account_id: e.account_id,
      date: e.date ? e.date.toISOString().slice(0, 10) : null,
      payee: e.payee ?? null,
      memo: e.memo ?? null,
      amount_cents: e.amount_cents?.toString?.() ?? String(e.amount_cents),
      type: e.type,
      method: e.method ?? null,
      status: e.status,
      entry_kind: (e as any).entry_kind ?? "GENERAL",
      deleted_at: e.deleted_at ? toIso(e.deleted_at) : null,
      created_at: toIso(e.created_at),
      updated_at: toIso(e.updated_at),
    };
  }

  function parseDateYmd(dateStr: string) {
    const s = (dateStr || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return new Date(s + "T00:00:00.000Z");
  }

  function parseBigInt(val: any) {
    if (val === undefined) return { ok: true as const, value: undefined as any };
    try {
      return { ok: true as const, value: BigInt(val) };
    } catch {
      return { ok: false as const, value: undefined };
    }
  }

  export async function handler(event: any) {
    const method = event?.requestContext?.http?.method;
    const path = event?.requestContext?.http?.path;

    // This function is only for the update routes.
    if (method !== "PUT" && method !== "PATCH") {
      return json(404, { ok: false, error: "Not Found", method, path });
    }

    try {
      const claims = getClaims(event);
      const sub = (claims.sub as string | undefined) ?? "";
      if (!sub) return json(401, { ok: false, error: "Unauthorized" });

      const { businessId = "", accountId = "", entryId = "" } = pp(event);
      const biz = businessId.toString().trim();
      const acct = accountId.toString().trim();
      const ent = entryId.toString().trim();

      if (!biz || !acct || !ent) {
        return json(400, { ok: false, error: "Missing businessId/accountId/entryId" });
      }

      let body: any = {};
      try {
        body = event?.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }

      const prisma = await getPrisma();

      // Permission checks consistent with entries.handler
      const role = await requireMembership(prisma, biz, sub);
      if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

      const acctOk = await requireAccountInBusiness(prisma, biz, acct);
      if (!acctOk) return json(404, { ok: false, error: "Account not found in this business" });

      // Stage 2A: closed period enforcement (409 CLOSED_PERIOD)
      // If body.date provided, enforce on the new date (string). Otherwise enforce on existing entry date.
      if (body.date !== undefined) {
        const ymd = String(body.date ?? "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return json(400, { ok: false, error: "date must be YYYY-MM-DD" });
        const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: ymd });
        if (!cp.ok) return cp.response;
      } else {
        const existing = await prisma.entry.findFirst({
          where: { id: ent, business_id: biz, account_id: acct },
          select: { date: true },
        });
        if (!existing) return json(404, { ok: false, error: "Entry not found" });

        const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: existing.date });
        if (!cp.ok) return cp.response;
      }

      // AP invariant: If this entry has ACTIVE bill applications, it becomes immutable for key fields.
      // Block editing: amount_cents, vendor_id, account_id, type, method.
      const hasActiveApps = await prisma.billPaymentApplication.count({
        where: { business_id: biz, entry_id: ent, is_active: true },
      });

      if (hasActiveApps > 0) {
        const touchesImmutable =
          body.amount_cents !== undefined ||
          body.vendor_id !== undefined ||
          body.account_id !== undefined ||
          body.type !== undefined ||
          body.method !== undefined;

        if (touchesImmutable) {
          return json(409, { ok: false, error: "APPLIED_PAYMENT_IMMUTABLE" });
        }
      }

      // Build update payload (PATCH-like behavior for both PUT and PATCH)
      const data: any = { updated_at: new Date() };

      if (body.date !== undefined) {
        const d = parseDateYmd(String(body.date ?? ""));
        if (!d) return json(400, { ok: false, error: "date must be YYYY-MM-DD" });
        data.date = d;
      }

      if (body.payee !== undefined) {
        const p = String(body.payee ?? "").trim();
        data.payee = p ? p : null;
      }

      if (body.memo !== undefined) {
        const m = String(body.memo ?? "").trim();
        data.memo = m ? m : null;
      }

      if (body.amount_cents !== undefined) {
        const amt = parseBigInt(body.amount_cents);
        if (!amt.ok) return json(400, { ok: false, error: "amount_cents must be an integer" });
        data.amount_cents = amt.value;
      }

      if (body.type !== undefined) {
        const t = String(body.type ?? "").trim();
        if (!ENTRY_TYPES.includes(t as any)) {
          return json(400, { ok: false, error: `type must be one of ${ENTRY_TYPES.join(", ")}` });
        }
        data.type = t;
      }

      if (body.method !== undefined) {
        const m = String(body.method ?? "").trim();
        data.method = m ? m : null;
      }

      if (body.status !== undefined) {
        const s = String(body.status ?? "").trim();
        if (!ENTRY_STATUS.includes(s as any)) {
          return json(400, { ok: false, error: `status must be one of ${ENTRY_STATUS.join(", ")}` });
        }
        data.status = s;
      }

// Category System v2: allow category_id updates (nullable)
if (body.category_id !== undefined) {
      const catIdRaw = body.category_id;

      if (catIdRaw === null || catIdRaw === "") {
        data.category_id = null;
      } else {
        const catId = String(catIdRaw).trim();
        if (!catId) {
          data.category_id = null;
        } else {
          const hit = await prisma.category.findFirst({
            where: { id: catId, business_id: biz, archived_at: null },
            select: { id: true },
          });
          if (!hit) return json(400, { ok: false, error: "Invalid category" });
          data.category_id = catId;
        }
      }
    }

    // Payment marker: allow entry_kind updates (GENERAL | VENDOR_PAYMENT)
    if (body.entry_kind !== undefined) {
      const k = String(body.entry_kind ?? "").trim().toUpperCase();
      if (!(ENTRY_KIND as readonly string[]).includes(k)) {
        return json(400, { ok: false, error: `entry_kind must be one of ${ENTRY_KIND.join(", ")}` });
      }
      (data as any).entry_kind = k;

      // If marking as vendor payment, force category = Purchase (create if missing).
      if (k === "VENDOR_PAYMENT") {
        const purchase = await prisma.category.findFirst({
          where: { business_id: biz, name: { equals: "Purchase", mode: "insensitive" }, archived_at: null },
          select: { id: true },
        });

        let purchaseId = purchase?.id ?? null;

        if (!purchaseId) {
          const created = await prisma.category.create({
            data: { business_id: biz, name: "Purchase" },
            select: { id: true },
          });
          purchaseId = created.id;
        }

        (data as any).category_id = purchaseId;
      }
    }
    // Vendor link: allow vendor_id updates (nullable)
    if (body.vendor_id !== undefined) {
      const vendorRaw = body.vendor_id;

      if (vendorRaw === null || vendorRaw === "") {
        (data as any).vendor_id = null;
      } else {
        const vendorId = String(vendorRaw).trim();
        if (!vendorId) {
          (data as any).vendor_id = null;
        } else {
          const hit = await prisma.vendor.findFirst({
            where: { id: vendorId, business_id: biz },
            select: { id: true },
          });
          if (!hit) return json(400, { ok: false, error: "Invalid vendor" });
          (data as any).vendor_id = vendorId;
        }
      }
    }

      // Enforce entry-type rules & sign normalization (backend is source of truth)
      // - TRANSFER cannot be updated via generic entry update; use /transfers
      // - INCOME: +abs(amount)
      // - EXPENSE: -abs(amount)
      // - ADJUSTMENT: keep sign exactly as provided
      {
        // Load the latest version for normalization decisions
        const current = await prisma.entry.findFirst({
          where: { id: ent, business_id: biz, account_id: acct },
          select: { type: true, amount_cents: true, is_adjustment: true },
        });
        if (!current) return json(404, { ok: false, error: "Entry not found" });

        const nextType = (data.type ?? current.type) as string;
        if (nextType === "TRANSFER") {
          return json(400, { ok: false, error: "Use /transfers for TRANSFER entries" });
        }

        const nextAmount = (data.amount_cents ?? current.amount_cents) as bigint;

        let normalizedAmount: bigint = nextAmount;

        if (nextType === "INCOME") normalizedAmount = nextAmount < 0n ? -nextAmount : nextAmount;
        if (nextType === "EXPENSE") normalizedAmount = nextAmount > 0n ? -nextAmount : nextAmount;
        // ADJUSTMENT keeps sign

        if (data.amount_cents !== undefined || data.type !== undefined) {
          data.amount_cents = normalizedAmount;
        }

        // Keep legacy adjustment flags in sync for backwards compatibility
        if (nextType === "ADJUSTMENT") {
          data.is_adjustment = true;
          data.adjusted_at = new Date();
          data.adjusted_by_user_id = sub;
          if (data.adjustment_reason === undefined) data.adjustment_reason = current.is_adjustment ? undefined : "Manual adjustment";
        } else if (current.is_adjustment) {
          // if moving away from ADJUSTMENT, clear flags
          if (data.type !== undefined) {
            data.is_adjustment = false;
            data.adjusted_at = null;
            data.adjusted_by_user_id = null;
            data.adjustment_reason = null;
          }
        }
      }

      // Must have at least one real field besides updated_at
      if (Object.keys(data).length === 1) {
        return json(400, { ok: false, error: "No updatable fields provided" });
      }
      
      const res = await prisma.entry.updateMany({
        where: {
          id: ent,
          business_id: biz,
          account_id: acct,
          deleted_at: null,
        },
        data,
      });

      if (!res?.count) {
        return json(404, { ok: false, error: "Entry not found" });
      }

      const updated = await prisma.entry.findFirst({
        where: { id: ent, business_id: biz, account_id: acct },
      });

      if (!updated) {
        return json(404, { ok: false, error: "Entry not found after update" });
      }

      return json(200, { ok: true, entry: serializeEntry(updated) });
    } catch (err: any) {
      console.error("entryUpdate error:", err);
      return json(500, { ok: false, error: "Internal Server Error" });
    }
  }