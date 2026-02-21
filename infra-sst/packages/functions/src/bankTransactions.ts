import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { authorizeWrite } from "./lib/authz";
import { assertNotClosedPeriod } from "./lib/closedPeriods";
import { randomUUID } from "node:crypto";

// Reuse the same auth-claims helper pattern used elsewhere
function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
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

// Phase 6A: deny-by-default write permissions
function canWrite(role: string | null) {
  const r = (role ?? "").toString().trim().toUpperCase();
  return r === "OWNER" || r === "ADMIN" || r === "BOOKKEEPER" || r === "ACCOUNTANT";
}

function parseLimit(q: any) {
  const raw = (q?.limit ?? "").toString().trim();

  const n = raw ? Number(raw) : 200;
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.min(Math.max(Math.floor(n), 1), 500);
}

function parseDateParam(s?: string | null): Date | null {
  if (!s) return null;
  const t = s.toString().trim();
  if (!t) return null;
  // Expect YYYY-MM-DD
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

function isoToYmd(iso: any): string {
  try {
    return new Date(String(iso)).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

/**
 * GET /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions?from=&to=&limit=
 * - scoped by businessId + accountId
 * - excludes is_removed=true
 * - ordered by posted_date desc
 */
export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = (event?.pathParameters?.businessId ?? "").toString().trim();
  const accountId = (event?.pathParameters?.accountId ?? "").toString().trim();
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });
  if (!accountId) return json(400, { ok: false, error: "Missing accountId" });

  const prisma = await getPrisma();

  const role = await requireMembership(prisma, businessId, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  // Phase 4D+ v1: bank txn POST actions
  const method = event?.requestContext?.http?.method;
  const rawPath = (event?.requestContext?.http?.path ?? "").toString();
  const bankTransactionId = (event?.pathParameters?.bankTransactionId ?? "").toString().trim();

  const isUnmatch = method === "POST" && bankTransactionId && rawPath.endsWith("/unmatch");
  const isCreateEntriesBatch = method === "POST" && rawPath.endsWith("/create-entries-batch");
  const isCreateEntry = method === "POST" && bankTransactionId && rawPath.endsWith("/create-entry");

  // -------------------------
  // POST /bank-transactions/{bankTransactionId}/unmatch
  // (legacy v1 unmatch remains)
  // -------------------------
  if (isUnmatch) {
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const az = await authorizeWrite(prisma, {
      businessId: businessId,
      scopeAccountId: accountId,
      actorUserId: sub,
      actorRole: role,
      actionKey: "reconcile.match.void",
      requiredLevel: "FULL",
      endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/{bankTransactionId}/unmatch",
    });

    if (!az.allowed) {
      return json(403, {
        ok: false,
        error: "Policy denied",
        code: "POLICY_DENIED",
        actionKey: "reconcile.match.void",
        requiredLevel: az.requiredLevel,
        policyValue: az.policyValue,
        policyKey: az.policyKey,
      });
    }

    const now = new Date();

    const updated = await prisma.bankMatch.updateMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        bank_transaction_id: bankTransactionId,
        voided_at: null,
      },
      data: {
        voided_at: now,
        voided_by_user_id: sub,
      },
    });

    await logActivity(prisma, {
      businessId: businessId,
      actorUserId: sub,
      scopeAccountId: accountId,
      eventType: "RECONCILE_MATCH_VOIDED",
      payloadJson: { account_id: accountId, bank_transaction_id: bankTransactionId, voided_count: updated.count },
    });

    return json(200, { ok: true, voidedCount: updated.count });
  }

  // -------------------------------------------------------------------
  // POST /bank-transactions/create-entries-batch
  // Best-effort: per-item created/skipped/failed. Idempotent via source_bank_transaction_id.
  // FULL-match only (no partial): if bank txn in any ACTIVE group -> SKIPPED/FAILED.
  // -------------------------------------------------------------------
  if (isCreateEntriesBatch) {
    try {
      if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

      const az = await authorizeWrite(prisma, {
        businessId: businessId,
        scopeAccountId: accountId,
        actorUserId: sub,
        actorRole: role,
        actionKey: "reconcile.entry.create.batch",
        requiredLevel: "FULL",
        endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/create-entries-batch",
      });

      if (!az.allowed) {
        return json(403, {
          ok: false,
          error: "Policy denied",
          code: "POLICY_DENIED",
          actionKey: "reconcile.entry.create.batch",
          requiredLevel: az.requiredLevel,
          policyValue: az.policyValue,
          policyKey: az.policyKey,
        });
      }

      let body: any = {};
      try {
        body = event?.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }

      const items: any[] = Array.isArray(body?.items) ? body.items : [];
      if (items.length === 0) return json(400, { ok: false, error: "Missing items[]" });

      const results: any[] = [];

      for (const it of items) {
        const bankId = String(it?.bank_transaction_id ?? "").trim();
        if (!bankId) {
          results.push({
            bank_transaction_id: "",
            status: "FAILED",
            code: "INVALID_ITEM",
            error: "Missing bank_transaction_id",
          });
          continue;
        }

        const autoMatch = it?.autoMatch === true;

        try {
          const bankTxn = await prisma.bankTransaction.findFirst({
            where: {
              business_id: businessId,
              account_id: accountId,
              id: bankId,
              is_removed: false,
            },
            select: { id: true, posted_date: true, name: true, amount_cents: true },
          });

          if (!bankTxn) {
            results.push({
              bank_transaction_id: bankId,
              status: "FAILED",
              code: "NOT_FOUND",
              error: "Bank transaction not found",
            });
            continue;
          }

          const entryDateYmd = isoToYmd(bankTxn.posted_date);

          // CLOSED_PERIOD based on ENTRY effective date basis
          const cp = await assertNotClosedPeriod({ prisma, businessId: businessId, dateInput: entryDateYmd });
          if (!cp.ok) {
            // Canonical cp.response already contains {ok:false, code:"CLOSED_PERIOD", error:"..."} with 409
            const parsed = (() => {
              try { return JSON.parse(cp.response.body); } catch { return { ok: false, code: "CLOSED_PERIOD", error: "This period is closed. Reopen period to modify." }; }
            })();

            results.push({
              bank_transaction_id: bankId,
              status: "FAILED",
              code: parsed?.code ?? "CLOSED_PERIOD",
              error: parsed?.error ?? "This period is closed. Reopen period to modify.",
            });
            continue;
          }

          // FULL-match only: if bank txn is in ANY ACTIVE group, we treat it as matched (no partial).
          const activeGroups = await prisma.matchGroup.findMany({
            where: { business_id: businessId, account_id: accountId, status: "ACTIVE" },
            select: { id: true },
          });
          const activeGroupIds = activeGroups.map((g: any) => g.id);

          let hasActive = false;
          if (activeGroupIds.length > 0) {
            const first = await prisma.matchGroupBank.findFirst({
              where: {
                business_id: businessId,
                account_id: accountId,
                bank_transaction_id: bankId,
                match_group_id: { in: activeGroupIds },
              },
              select: { match_group_id: true },
            });
            hasActive = !!first;
          }

          if (hasActive) {
            results.push({
              bank_transaction_id: bankId,
              status: "SKIPPED",
              code: "ALREADY_MATCHED",
              error: "Bank transaction is already fully matched.",
            });
            continue;
          }

          // Idempotency: real key (source_bank_transaction_id), soft-delete friendly
          const existing = await prisma.entry.findFirst({
            where: {
              business_id: businessId,
              account_id: accountId,
              deleted_at: null,
              sourceBankTransactionId: bankId,
            } as any,
            select: { id: true },
          });

          const bankAmt = BigInt(bankTxn.amount_cents);
          const bankAbs = absBig(bankAmt);
          const sign = bankAmt < 0n ? -1n : 1n;
          const entryType = sign > 0n ? "INCOME" : "EXPENSE";
          const entryAmountCents = sign > 0n ? bankAbs : -bankAbs;

          const rawMemo = it?.memo ? String(it.memo) : "";
          const memoOverride = rawMemo.trim() ? rawMemo.trim().slice(0, 400) : "";
          const defaultMemo = `Bank txn: ${(bankTxn.name ?? "").toString().trim() || "—"} • ${bankId}`;
          const memo = memoOverride || defaultMemo;

          const rawMethod = it?.method ? String(it.method) : "";
          const methodOverride = rawMethod.trim().toUpperCase();

          const rawCategoryId = it?.category_id ? String(it.category_id) : "";
          const categoryIdOverride = rawCategoryId.trim() ? rawCategoryId.trim() : "";

          const allowedMethods = new Set([
            "CASH","CARD","ACH","WIRE","CHECK","DIRECT_DEPOSIT","ZELLE","TRANSFER","OTHER",
          ]);
          const methodFinal = allowedMethods.has(methodOverride) ? methodOverride : "OTHER";
          const categoryIdFinal = categoryIdOverride || null;

          const now = new Date();

          // If already created, optionally allow autoMatch to create group (if requested and safe)
          if (existing?.id) {
            let createdMatchGroupId: string | null = null;

            if (autoMatch) {
              // Enforce one ACTIVE group per item
              if (activeGroupIds.length > 0) {
                const eFirst = await prisma.matchGroupEntry.findFirst({
                  where: {
                    business_id: businessId,
                    account_id: accountId,
                    entry_id: existing.id,
                    match_group_id: { in: activeGroupIds },
                  },
                  select: { match_group_id: true },
                });
                if (eFirst) {
                  results.push({
                    bank_transaction_id: bankId,
                    status: "FAILED",
                    code: "ALREADY_IN_GROUP",
                    error: "Entry is already matched.",
                    entry_id: existing.id,
                  });
                  continue;
                }
              }

              const groupId = randomUUID();

              await prisma.$transaction(async (tx: any) => {
                await tx.matchGroup.create({
                  data: ({
                    id: groupId,
                    business_id: businessId,
                    account_id: accountId,
                    status: "ACTIVE",
                    direction: bankAmt < 0n ? "OUTFLOW" : "INFLOW",
                    created_by_user_id: sub,
                    created_at: now,
                  } as any),
                  select: { id: true },
                });

                await tx.matchGroupBank.create({
                  data: {
                    business_id: businessId,
                    account_id: accountId,
                    match_group_id: groupId,
                    bank_transaction_id: bankId,
                    matched_amount_cents: bankAbs,
                  },
                });

                await tx.matchGroupEntry.create({
                  data: {
                    business_id: businessId,
                    account_id: accountId,
                    match_group_id: groupId,
                    entry_id: existing.id,
                    matched_amount_cents: bankAbs,
                  },
                });
              });

              createdMatchGroupId = groupId;
            }

            results.push({
              bank_transaction_id: bankId,
              status: "SKIPPED",
              code: "DUPLICATE",
              error: "Entry already exists for this bank transaction.",
              entry_id: existing.id,
              match_group_id: createdMatchGroupId,
              auto_matched: !!createdMatchGroupId,
            });
            continue;
          }

          const entryId = randomUUID();
          let createdMatchGroupId: string | null = null;

          await prisma.$transaction(async (tx: any) => {
            const createdEntry = await tx.entry.create({
              data: {
                id: entryId,
                business_id: businessId,
                account_id: accountId,
                date: new Date(`${entryDateYmd}T00:00:00Z`),
                payee: (bankTxn.name ?? "").toString().trim() || "Bank transaction",
                memo,
                amount_cents: entryAmountCents,
                type: entryType,
                method: methodFinal,
                status: "EXPECTED",
                category_id: categoryIdFinal,
                deleted_at: null,
                sourceBankTransactionId: bankId,
                created_at: now,
                updated_at: now,
              } as any,
              select: { id: true },
            });

            if (autoMatch) {
              // Still enforce bank txn not in any ACTIVE group (FULL-match only)
              if (activeGroupIds.length > 0) {
                const bFirst = await tx.matchGroupBank.findFirst({
                  where: {
                    business_id: businessId,
                    account_id: accountId,
                    bank_transaction_id: bankId,
                    match_group_id: { in: activeGroupIds },
                  },
                  select: { match_group_id: true },
                });
                if (bFirst) {
                  const err: any = new Error("Bank transaction already matched");
                  err.code = "ALREADY_IN_GROUP";
                  throw err;
                }
              }

              const groupId = randomUUID();

              await tx.matchGroup.create({
                data: ({
                  id: groupId,
                  business_id: businessId,
                  account_id: accountId,
                  status: "ACTIVE",
                  direction: bankAmt < 0n ? "OUTFLOW" : "INFLOW",
                  created_by_user_id: sub,
                  created_at: now,
                } as any),
                select: { id: true },
              });

              await tx.matchGroupBank.create({
                data: {
                  business_id: businessId,
                  account_id: accountId,
                  match_group_id: groupId,
                  bank_transaction_id: bankId,
                  matched_amount_cents: bankAbs,
                },
              });

              await tx.matchGroupEntry.create({
                data: {
                  business_id: businessId,
                  account_id: accountId,
                  match_group_id: groupId,
                  entry_id: createdEntry.id,
                  matched_amount_cents: bankAbs,
                },
              });

              createdMatchGroupId = groupId;
            }
          });

          results.push({
            bank_transaction_id: bankId,
            status: "CREATED",
            entry_id: entryId,
            match_group_id: createdMatchGroupId,
            auto_matched: !!createdMatchGroupId,
          });
        } catch (e: any) {
          const code = String(e?.code ?? "BATCH_CREATE_FAILED");
          const msg = String(e?.message ?? "Create failed");

          if (code === "ALREADY_IN_GROUP") {
            results.push({
              bank_transaction_id: String(it?.bank_transaction_id ?? ""),
              status: "FAILED",
              code: "ALREADY_IN_GROUP",
              error: "Bank transaction is already matched.",
            });
            continue;
          }

          results.push({
            bank_transaction_id: String(it?.bank_transaction_id ?? ""),
            status: "FAILED",
            code: "CREATE_FAILED",
            error: msg,
          });
        }
      }

      return json(200, { ok: true, results });
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Unknown error");
      return json(500, { ok: false, code: "BATCH_FAILED", error: "Batch create failed.", detail: msg });
    }
  }

  // -------------------------------------------------------
  // POST /bank-transactions/{bankTransactionId}/create-entry
  // - Creates a ledger entry derived from the bank txn
  // - Optional FULL auto-match via MatchGroups (v2)
  // -------------------------------------------------------
  if (isCreateEntry) {
    try {
      if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

      const az = await authorizeWrite(prisma, {
        businessId: businessId,
        scopeAccountId: accountId,
        actorUserId: sub,
        actorRole: role,
        actionKey: "reconcile.entry.create",
        requiredLevel: "FULL",
        endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/{bankTransactionId}/create-entry",
      });

      if (!az.allowed) {
        return json(403, {
          ok: false,
          error: "Policy denied",
          code: "POLICY_DENIED",
          actionKey: "reconcile.entry.create",
          requiredLevel: az.requiredLevel,
          policyValue: az.policyValue,
          policyKey: az.policyKey,
        });
      }

      let body: any = {};
      try {
        body = event?.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }

      const autoMatch = body?.autoMatch === true;

      const rawMemo = body?.memo ? String(body.memo) : "";
      const memoOverride = rawMemo.trim() ? rawMemo.trim().slice(0, 400) : "";

      const rawMethod = body?.method ? String(body.method) : "";
      const methodOverride = rawMethod.trim().toUpperCase();

      const rawCategoryId = body?.category_id ? String(body.category_id) : "";
      const categoryIdOverride = rawCategoryId.trim() ? rawCategoryId.trim() : "";

      const bankTxn = await prisma.bankTransaction.findFirst({
        where: {
          business_id: businessId,
          account_id: accountId,
          id: bankTransactionId,
          is_removed: false,
        },
        select: {
          id: true,
          posted_date: true,
          name: true,
          amount_cents: true,
        },
      });

      if (!bankTxn) return json(404, { ok: false, error: "Bank transaction not found" });

      const bankAmt = BigInt(bankTxn.amount_cents);
      const bankAbs = absBig(bankAmt);

      // ENTRY effective date basis (ymd used to set Entry.date)
      const entryDateYmd = isoToYmd(bankTxn.posted_date);

      // CLOSED_PERIOD based on ENTRY effective date basis
      const cp = await assertNotClosedPeriod({ prisma, businessId: businessId, dateInput: entryDateYmd });
      if (!cp.ok) return cp.response;

      // FULL-match only: if bank txn is in ANY ACTIVE group, treat as matched (no partial remaining calc).
      const activeGroups = await prisma.matchGroup.findMany({
        where: { business_id: businessId, account_id: accountId, status: "ACTIVE" },
        select: { id: true },
      });
      const activeGroupIds = activeGroups.map((g: any) => g.id);

      let hasActive = false;
      if (activeGroupIds.length > 0) {
        const first = await prisma.matchGroupBank.findFirst({
          where: {
            business_id: businessId,
            account_id: accountId,
            bank_transaction_id: bankTransactionId,
            match_group_id: { in: activeGroupIds },
          },
          select: { match_group_id: true },
        });
        hasActive = !!first;
      }

      if (hasActive) {
        return json(409, {
          ok: false,
          code: autoMatch ? "ALREADY_IN_GROUP" : "ALREADY_MATCHED",
          error: "Bank transaction is already fully matched.",
        });
      }

      // Idempotency via real key (soft-delete friendly)
      const existing = await prisma.entry.findFirst({
        where: {
          business_id: businessId,
          account_id: accountId,
          deleted_at: null,
          sourceBankTransactionId: bankTransactionId,
        } as any,
        select: { id: true },
      });

      const sign = bankAmt < 0n ? -1n : 1n;
      const entryType = sign > 0n ? "INCOME" : "EXPENSE";
      const entryAmountCents = sign > 0n ? bankAbs : -bankAbs;

      const defaultMemo = `Bank txn: ${(bankTxn.name ?? "").toString().trim() || "—"} • ${bankTransactionId}`;
      const memo = memoOverride || defaultMemo;

      const allowedMethods = new Set([
        "CASH",
        "CARD",
        "ACH",
        "WIRE",
        "CHECK",
        "DIRECT_DEPOSIT",
        "ZELLE",
        "TRANSFER",
        "OTHER",
      ]);

      const methodFinal = allowedMethods.has(methodOverride) ? methodOverride : "OTHER";
      const categoryIdFinal = categoryIdOverride || null;

      const now = new Date();
      const entryId = randomUUID();

      // If entry already exists for this bank txn, optionally allow autoMatch to create group (if safe).
      if (existing?.id) {
        let createdMatchGroupId: string | null = null;

        if (autoMatch) {
          // Enforce entry is not already in any ACTIVE group
          if (activeGroupIds.length > 0) {
            const eFirst = await prisma.matchGroupEntry.findFirst({
              where: {
                business_id: businessId,
                account_id: accountId,
                entry_id: existing.id,
                match_group_id: { in: activeGroupIds },
              },
              select: { match_group_id: true },
            });
            if (eFirst) {
              return json(409, { ok: false, code: "ALREADY_IN_GROUP", error: "Entry is already matched." });
            }
          }

          const groupId = randomUUID();

          await prisma.$transaction(async (tx: any) => {
            await tx.matchGroup.create({
              data: ({
                id: groupId,
                business_id: businessId,
                account_id: accountId,
                status: "ACTIVE",
                direction: bankAmt < 0n ? "OUTFLOW" : "INFLOW",
                created_by_user_id: sub,
                created_at: now,
              } as any),
              select: { id: true },
            });

            await tx.matchGroupBank.create({
              data: {
                business_id: businessId,
                account_id: accountId,
                match_group_id: groupId,
                bank_transaction_id: bankTransactionId,
                matched_amount_cents: bankAbs,
              },
            });

            await tx.matchGroupEntry.create({
              data: {
                business_id: businessId,
                account_id: accountId,
                match_group_id: groupId,
                entry_id: existing.id,
                matched_amount_cents: bankAbs,
              },
            });
          });

          createdMatchGroupId = groupId;
        }

        return json(200, {
          ok: true,
          entry_id: existing.id,
          match_group_id: createdMatchGroupId,
          auto_matched: !!createdMatchGroupId,
        });
      }

      const result = await prisma.$transaction(async (tx: any) => {
        const createdEntry = await tx.entry.create({
          data: {
            id: entryId,
            business_id: businessId,
            account_id: accountId,
            date: new Date(`${entryDateYmd}T00:00:00Z`),
            sourceBankTransactionId: bankTransactionId,
            payee: (bankTxn.name ?? "").toString().trim() || "Bank transaction",
            memo,
            amount_cents: entryAmountCents,
            type: entryType,
            method: methodFinal,
            status: "EXPECTED",
            category_id: categoryIdFinal,
            deleted_at: null,
            created_at: now,
            updated_at: now,
          },
          select: { id: true },
        });

        let createdMatchGroupId: string | null = null;

        if (autoMatch) {
          const groupId = randomUUID();

          await tx.matchGroup.create({
            data: ({
              id: groupId,
              business_id: businessId,
              account_id: accountId,
              status: "ACTIVE",
              direction: bankAmt < 0n ? "OUTFLOW" : "INFLOW",
              created_by_user_id: sub,
              created_at: now,
            } as any),
            select: { id: true },
          });

          // FULL-match only: POSITIVE abs cents invariants for MatchGroupBank/Entry
          await tx.matchGroupBank.create({
            data: {
              business_id: businessId,
              account_id: accountId,
              match_group_id: groupId,
              bank_transaction_id: bankTransactionId,
              matched_amount_cents: bankAbs,
            },
          });

          await tx.matchGroupEntry.create({
            data: {
              business_id: businessId,
              account_id: accountId,
              match_group_id: groupId,
              entry_id: createdEntry.id,
              matched_amount_cents: bankAbs,
            },
          });

          createdMatchGroupId = groupId;
        }

        return { createdEntryId: createdEntry.id, createdMatchGroupId };
      });

      await logActivity(prisma, {
        businessId: businessId,
        actorUserId: sub,
        scopeAccountId: accountId,
        eventType: "RECONCILE_MATCH_CREATED",
        payloadJson: {
          action: "BANK_TXN_CREATE_ENTRY",
          account_id: accountId,
          bank_transaction_id: bankTransactionId,
          entry_id: result.createdEntryId,
          auto_matched: !!result.createdMatchGroupId,
          match_group_id: result.createdMatchGroupId,
          remaining_abs_cents: result.createdMatchGroupId ? "0" : bankAbs.toString(),
        },
      });

      return json(201, {
        ok: true,
        entry_id: result.createdEntryId,
        match_group_id: result.createdMatchGroupId,
        auto_matched: !!result.createdMatchGroupId,
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Unknown error");
      return json(500, {
        ok: false,
        code: "CREATE_ENTRY_FAILED",
        error: "Create-entry failed.",
        detail: msg,
      });
    }
  }

  // -------------------------
  // GET list
  // -------------------------
  const q = event?.queryStringParameters ?? {};
  const limit = parseLimit(q);
  const from = parseDateParam(q?.from ?? null);
  const to = parseDateParam(q?.to ?? null);

  const where: any = {
    business_id: businessId,
    account_id: accountId,
    is_removed: false,
  };
  if (from || to) {
    where.posted_date = {};
    if (from) where.posted_date.gte = from;
    if (to) where.posted_date.lte = to;
  }

  const rows = await prisma.bankTransaction.findMany({
    where,
    orderBy: [{ posted_date: "desc" }, { created_at: "desc" }],
    take: limit,
    select: {
      id: true,
      posted_date: true,
      name: true,
      amount_cents: true,
      is_pending: true,
      iso_currency_code: true,
      source: true,
      source_parser: true,
      source_upload_id: true,
      import_hash: true,
      created_at: true,
    },
  });

  return json(200, { ok: true, items: rows });
}
