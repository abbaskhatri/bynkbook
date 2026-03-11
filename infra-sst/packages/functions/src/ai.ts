import { getPrisma } from "./lib/db";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { logActivity, type ActivityEventType } from "./lib/activityLog";

// -------------------- helpers --------------------
function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function safeJsonParse(s: any) {
  try {
    return JSON.parse(String(s ?? ""));
  } catch {
    return null;
  }
}

async function getSecretString(secretId: string) {
  const region = process.env.AWS_REGION || "us-east-1";
  const sm = new SecretsManagerClient({ region });
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!res.SecretString) throw new Error(`SecretString is empty for ${secretId}`);

  const raw = String(res.SecretString);

  // Repo pattern: secrets are often stored as Key/value with key "value"
  // In that case SecretString is JSON like {"value":"..."}.
  try {
    const obj: any = JSON.parse(raw);
    if (obj && typeof obj === "object" && typeof obj.value === "string" && obj.value.trim()) {
      return obj.value;
    }
  } catch {
    // not JSON; fall through
  }

  return raw;
}

let cachedApiKey: string | null = null;
let cachedModel: string | null = null;

async function getOpenAiConfig() {
  const keyId = process.env.OPENAI_API_KEY_SECRET_ID;
  const modelId = process.env.OPENAI_MODEL_SECRET_ID;

  if (!keyId) throw new Error("Missing env OPENAI_API_KEY_SECRET_ID");
  if (!modelId) throw new Error("Missing env OPENAI_MODEL_SECRET_ID");

  if (!cachedApiKey) cachedApiKey = (await getSecretString(keyId)).trim();
  if (!cachedModel) cachedModel = (await getSecretString(modelId)).trim();

  if (!cachedApiKey) throw new Error("OpenAI API key is empty");
  if (!cachedModel) throw new Error("OpenAI model is empty");

  return { apiKey: cachedApiKey, model: cachedModel };
}

// Best-effort per-instance short burst limiter (prevents spam storms)
const burst = new Map<string, { windowStart: number; count: number }>();
function burstAllowed(businessId: string) {
  const now = Date.now();
  const w = burst.get(businessId);
  if (!w || now - w.windowStart > 60_000) {
    burst.set(businessId, { windowStart: now, count: 1 });
    return true;
  }
  if (w.count >= 20) return false; // 20 requests/minute/business (best-effort)
  w.count += 1;
  return true;
}

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

async function enforceDailyLimit(prisma: any, businessId: string) {
  const limit = Number(process.env.AI_DAILY_LIMIT ?? "200");
  const from = startOfUtcDay(new Date());

  const used = await prisma.activityLog.count({
    where: {
      business_id: businessId,
      created_at: { gte: from },
      event_type: { in: ["AI_EXPLAIN_ENTRY", "AI_EXPLAIN_REPORT", "AI_SUGGEST_CATEGORY", "AI_CHAT"] },
    },
  });

  return { limit, used, remaining: Math.max(0, limit - used) };
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

// -------------------- OpenAI call (Chat Completions) --------------------
async function openAiText(args: {
  model: string;
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
}) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      temperature: 0.2,
      max_tokens: args.maxTokens,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI error ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data: any = await res.json();
  const out = data?.choices?.[0]?.message?.content ?? "";
  return String(out ?? "").trim();
}

function parseJsonModelOutput(raw: string) {
  const txt = String(raw ?? "").trim();
  const unfenced = txt.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return safeJsonParse(unfenced) ?? safeJsonParse(txt) ?? {};
}

function clampConfidence(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function shortReason(v: any) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length <= 140 ? s : `${s.slice(0, 137).trim()}...`;
}

function normalizeReconcileSuggestions(args: {
  raw: any;
  allowedIds: Set<string>;
  idKey: "entryId" | "bankTransactionId";
}) {
  const arr = Array.isArray(args.raw?.suggestions) ? args.raw.suggestions : [];
  const seen = new Set<string>();
  const out: Array<Record<string, any>> = [];

  for (const item of arr) {
    const id = String(item?.[args.idKey] ?? "").trim();
    if (!id) continue;
    if (!args.allowedIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({
      [args.idKey]: id,
      confidence: clampConfidence(item?.confidence),
      reason: shortReason(item?.reason),
    });

    if (out.length >= 3) break;
  }

  return out;
}

function norm(s: any) {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function findCategoryId(categories: Array<{ id: string; name: string }>, names: string[]) {
  const wanted = names.map((x) => norm(x));

  for (const c of categories) {
    const n = norm(c.name);
    if (wanted.includes(n)) return String(c.id);
  }

  for (const c of categories) {
    const n = norm(c.name);
    if (wanted.some((w) => n.includes(w) || w.includes(n))) return String(c.id);
  }

  return "";
}

function deterministicCategorySuggestion(
  item: { id: string; payee_or_name: string; memo: string; amount_cents: number },
  categories: Array<{ id: string; name: string }>
) {
  const text = `${item.payee_or_name} ${item.memo}`.toLowerCase();
  const isNegative = Number(item.amount_cents) < 0;
  const isPositive = Number(item.amount_cents) > 0;

  const taxId = findCategoryId(categories, ["Tax", "Taxes", "Taxes & Licenses"]);
  const payrollId = findCategoryId(categories, ["Payroll", "Payroll Expense", "Wages"]);
  const bankChargesId = findCategoryId(categories, ["Bank Charges", "Service Charges", "Bank Fees"]);
  const utilitiesId = findCategoryId(categories, ["Utilities", "Internet", "Phone", "Communications", "Telecommunications"]);
  const loanId = findCategoryId(categories, ["Loan Payment", "Loans", "Credit Card Payment", "Owner Draw", "Transfers", "Transfer"]);
  const purchaseId = findCategoryId(categories, ["Purchase", "Purchases", "Supplies", "Office Expense", "Office Supplies"]);
  const saleId = findCategoryId(categories, ["Sale", "Sales", "Revenue", "Income", "Sales Income"]);
  const otherId = findCategoryId(categories, ["Other", "Misc", "Miscellaneous"]);

  if (/(irs|franchise tax|sales tax|comptroller|tax payment|tax pymt|usataxpymt|webfile tax)/i.test(text) && taxId) {
    return { category_id: taxId, confidence: 0.99, reason: "Matched tax authority / tax payment keywords." };
  }

  if (/(payroll|salary|wages|gusto|adp|employee pay|employee|paycheck|zelle payment to .*emp|payroll;)/i.test(text) && payrollId) {
    return { category_id: payrollId, confidence: 0.97, reason: "Matched payroll / employee payment keywords." };
  }

  if (/(spectrum|internet|phone|verizon|at&t|comcast|wireless|telecom|utility|utilities|electric|water|gas)/i.test(text) && utilitiesId) {
    return { category_id: utilitiesId, confidence: 0.95, reason: "Matched utility / communications keywords." };
  }

  if (/(bank fee|service charge|monthly fee|overdraft|fee charge|fee)/i.test(text) && bankChargesId) {
    return { category_id: bankChargesId, confidence: 0.97, reason: "Matched fee / service charge keywords." };
  }

  if (/(american express|amex|visa|mastercard|discover|credit card payment|loan payment|online banking transfer|transfer|payment to chk|card payment)/i.test(text)) {
    if (loanId) {
      return { category_id: loanId, confidence: 0.9, reason: "Matched transfer / card / liability payment keywords." };
    }
    if (otherId) {
      return { category_id: otherId, confidence: 0.55, reason: "Ambiguous transfer / card payment; sent to review bucket." };
    }
    return null;
  }

  if (/(bankcard|btot dep|dep id:)/i.test(text) && isPositive && saleId) {
    return { category_id: saleId, confidence: 0.95, reason: "Matched bankcard deposit / sales receipt pattern." };
  }

  if (/(bankcard)/i.test(text) && isNegative) {
    if (bankChargesId) {
      return { category_id: bankChargesId, confidence: 0.84, reason: "Matched negative bankcard / processing-fee pattern." };
    }
    if (otherId) {
      return { category_id: otherId, confidence: 0.55, reason: "Negative bankcard item is ambiguous; sent to review bucket." };
    }
    return null;
  }

  if (/\bcheck\b|\bchk\b/i.test(text) && isNegative) {
    if (otherId) {
      return { category_id: otherId, confidence: 0.5, reason: "Outgoing check can map to multiple categories; sent to review bucket." };
    }
    return null;
  }

  if (/(purchase|supplies|office depot|staples|amazon|home depot|lowe'?s)/i.test(text) && purchaseId) {
    return { category_id: purchaseId, confidence: 0.9, reason: "Matched purchasing / supplies keywords." };
  }

  return null;
}

// -------------------- handler --------------------
export async function handler(event: any) {
  const method = (event?.requestContext?.http?.method ?? "").toString().toUpperCase();
  const path = (event?.requestContext?.http?.path ?? "").toString();

  if (method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const body = safeJsonParse(event?.body) ?? {};
  const businessId = String(body.businessId ?? "").trim();
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });

  const prisma = await getPrisma();

  const role = await requireMembership(prisma, businessId, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  // burst + daily usage limits per business
  if (!burstAllowed(businessId)) {
    return json(429, { ok: false, error: "Too many requests. Try again in a moment." });
  }

  const quota = await enforceDailyLimit(prisma, businessId);
  if (quota.remaining <= 0) {
    return json(429, { ok: false, error: "AI daily limit reached for this business.", usage: quota });
  }

  const { apiKey, model } = await getOpenAiConfig();

  try {

        // /v1/ai/anomalies (deterministic; read-only; does NOT consume LLM quota)
    if (path.endsWith("/v1/ai/anomalies")) {
      const accountId = body.accountId ? String(body.accountId).trim() : null;
      const from = body.from ? String(body.from).slice(0, 10) : null;
      const to = body.to ? String(body.to).slice(0, 10) : null;

      // Deterministic dataset window: last 200 entries (filtered)
      const where: any = { business_id: businessId, deleted_at: null };
      if (accountId) where.account_id = accountId;
      if (from || to) {
        where.date = {};
        if (from) where.date.gte = new Date(from);
        if (to) where.date.lte = new Date(to);
      }

      const rows = await prisma.entry.findMany({
        where,
        take: 200,
        orderBy: { date: "desc" },
        select: { id: true, date: true, amount_cents: true, payee: true, memo: true },
      });

      // Simple deterministic anomaly rule:
      // Flag if abs(amount) >= $500 AND >= 3x median(abs(amount)) for same payee (within sample).
      const byPayee = new Map<string, number[]>();
      for (const r of rows) {
        const p = String(r.payee ?? "").trim().toLowerCase() || "(unknown)";
        const a = Math.abs(Number(r.amount_cents ?? 0));
        if (!byPayee.has(p)) byPayee.set(p, []);
        byPayee.get(p)!.push(a);
      }

      function median(vals: number[]) {
        const v = vals.slice().sort((a, b) => a - b);
        const n = v.length;
        if (!n) return 0;
        const mid = Math.floor(n / 2);
        return n % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
      }

      const anomalies: any[] = [];
      for (const r of rows) {
        const p = String(r.payee ?? "").trim().toLowerCase() || "(unknown)";
        const absAmt = Math.abs(Number(r.amount_cents ?? 0));
        const hist = byPayee.get(p) ?? [];
        const base = median(hist);
        const ratio = base > 0 ? absAmt / base : 0;

        const flagged = absAmt >= 50_000 && base > 0 && ratio >= 3; // >= $500 and >= 3x median
        if (!flagged) continue;

        const confidence = Math.min(0.95, Math.max(0.5, (ratio - 3) / 3 + 0.5));
        anomalies.push({
          entryId: r.id,
          title: "Unusual amount",
          reason: `Amount is ${ratio.toFixed(1)}× the typical amount for this merchant in the current sample.`,
          baseline: {
            median_abs_cents: Math.round(base),
            sample_size: hist.length,
          },
          confidence,
        });
      }

      // Most suspicious first
      anomalies.sort((a, b) => Number(b.confidence) - Number(a.confidence));

      return json(200, { ok: true, anomalies: anomalies.slice(0, 20) });
    }

        // /v1/ai/merchant-normalize (LLM; suggestion-only)
    if (path.endsWith("/v1/ai/merchant-normalize")) {
      const payee = String(body.payee ?? "").trim();
      const memo = String(body.memo ?? "").trim();

      if (!payee) return json(400, { ok: false, error: "Missing payee" });

      const { apiKey, model } = await getOpenAiConfig();

      const system =
        "You normalize merchant names for bookkeeping. Use ONLY the provided payee/memo. " +
        "Return JSON only: {\"merchant\":\"...\",\"confidence\":0.0,\"reason\":\"...\"}. " +
        "Do not invent facts. Prefer short canonical merchant name (e.g., 'Amazon', 'Uber', 'Costco').";

      const user = `Payee: ${payee}\nMemo: ${memo}`;

      const raw = await openAiText({ model, apiKey, system, user, maxTokens: 120 });
      const parsed = safeJsonParse(raw) ?? {};

      const merchant = String(parsed.merchant ?? "").trim();
      const confidence = Number(parsed.confidence ?? 0);
      const reason = String(parsed.reason ?? "").trim();

      await logActivity(prisma, {
        businessId,
        actorUserId: sub,
        eventType: "AI_CHAT" as ActivityEventType, // reuse quota bucket; optional to add dedicated type later
        payloadJson: { scope: "merchant-normalize", model },
        scopeAccountId: null,
      });

      return json(200, { ok: true, merchant, confidence, reason, usage: { ...quota, remaining: quota.remaining - 1 } });
    }

    // /v1/ai/explain-entry
    if (path.endsWith("/v1/ai/explain-entry")) {
      const entryId = String(body.entryId ?? "").trim();
      if (!entryId) return json(400, { ok: false, error: "Missing entryId" });

      const row = await prisma.entry.findFirst({
        where: { id: entryId, business_id: businessId, deleted_at: null },
        select: {
          id: true,
          date: true,
          amount_cents: true,
          payee: true,
          memo: true,
          category_id: true,
          account_id: true,
        },
      });

      if (!row) return json(404, { ok: false, error: "Entry not found" });

      const [cat, acct] = await Promise.all([
        row.category_id
          ? prisma.category.findFirst({ where: { id: row.category_id, business_id: businessId }, select: { name: true } })
          : null,
        prisma.account.findFirst({ where: { id: row.account_id, business_id: businessId }, select: { name: true } }),
      ]);

      const context = {
        date: String(row.date).slice(0, 10),
        amount_cents: Number(row.amount_cents),
        payee: String(row.payee ?? ""),
        memo: String(row.memo ?? ""),
        category: String(cat?.name ?? "Uncategorized"),
        account: String(acct?.name ?? ""),
      };

      const system =
        "You are a CPA-safe bookkeeping assistant. Explain using ONLY the provided fields. " +
        "Do not fabricate. If data is missing, say Unknown. Keep it concise (3-6 sentences). " +
        "At the end, include a short 'Used fields:' list.";

      const user =
        `Explain why this entry may have its current category and what it likely represents.\n\n` +
        `Entry context:\n${JSON.stringify(context, null, 2)}`;

      const answer = await openAiText({ model, apiKey, system, user, maxTokens: 320 });

      await logActivity(prisma, {
        businessId,
        actorUserId: sub,
        eventType: "AI_EXPLAIN_ENTRY" as ActivityEventType,
        payloadJson: { entryId, scope: "entry", model },
        scopeAccountId: row.account_id,
      });

      return json(200, { ok: true, answer, usage: { ...quota, remaining: quota.remaining - 1 } });
    }

    // /v1/ai/explain-report
    if (path.endsWith("/v1/ai/explain-report")) {
      const reportTitle = String(body.reportTitle ?? "Report").trim();
      const period = body.period ?? null;
      const summary = body.summary ?? null;

      const system =
        "You are a CPA-safe bookkeeping assistant. Explain using ONLY the provided report summary. " +
        "Do not fabricate. If something isn't present, say Unknown. " +
        "Be concise and business-friendly. End with 'Used fields:' listing what you relied on.";

      const user =
        `Explain this report in plain language.\n\n` +
        `Title: ${reportTitle}\n` +
        `Period: ${JSON.stringify(period)}\n` +
        `Summary: ${JSON.stringify(summary, null, 2)}`;

      const answer = await openAiText({ model, apiKey, system, user, maxTokens: 420 });

      await logActivity(prisma, {
        businessId,
        actorUserId: sub,
        eventType: "AI_EXPLAIN_REPORT" as ActivityEventType,
        payloadJson: { reportTitle, scope: "report", model },
        scopeAccountId: null,
      });

      return json(200, { ok: true, answer, usage: { ...quota, remaining: quota.remaining - 1 } });
    }

    // /v1/ai/suggest-category
    if (path.endsWith("/v1/ai/suggest-category")) {
      const accountId = String(body.accountId ?? "").trim();
      const items = Array.isArray(body.items) ? body.items : [];
      const limitPerItem = Math.max(1, Math.min(3, Number(body.limitPerItem ?? 3)));

      if (!accountId) return json(400, { ok: false, error: "Missing accountId" });
      if (!items.length) return json(200, { ok: true, suggestionsById: {}, usage: { ...quota, remaining: quota.remaining - 1 } });

      const acctOk = await prisma.account.findFirst({
        where: { id: accountId, business_id: businessId },
        select: { id: true },
      });
      if (!acctOk) return json(404, { ok: false, error: "Account not found" });

      const categories = await prisma.category.findMany({
        where: { business_id: businessId, archived_at: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });

      const shapedItems: Array<{
        id: string;
        date: string;
        amount_cents: number;
        payee_or_name: string;
        memo: string;
      }> = items.slice(0, 200).map((it: any) => ({
        id: String(it.id ?? ""),
        date: String(it.date ?? "").slice(0, 10),
        amount_cents: Number(it.amount_cents ?? 0),
        payee_or_name: String(it.payee_or_name ?? ""),
        memo: String(it.memo ?? ""),
      }));

            const categorizedHistory = await prisma.entry.findMany({
        where: {
          business_id: businessId,
          account_id: accountId,
          deleted_at: null,
          category_id: { not: null },
        },
        select: {
          payee: true,
          memo: true,
          category_id: true,
          date: true,
        },
        orderBy: { date: "desc" },
        take: 500,
      });

      const categoryNameMap = new Map<string, string>();
      for (const c of categories) {
        categoryNameMap.set(String(c.id), String(c.name));
      }

      function findHistoryCategoryIdForPayee(payee: string) {
        const target = norm(payee);
        if (!target) return "";

        const matches = categorizedHistory.filter((r: any) => {
          const rp = norm(r.payee);
          return rp && (rp === target || rp.includes(target) || target.includes(rp));
        });

        if (!matches.length) return "";

        const counts = new Map<string, number>();
        for (const r of matches) {
          const cid = String(r.category_id ?? "").trim();
          if (!cid) continue;
          counts.set(cid, (counts.get(cid) ?? 0) + 1);
        }

        const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
        const top = ranked[0];
        if (!top) return "";
        if (top[1] < 2) return ""; // require repeat usage before trusting memory

        return top[0];
      }

      const deterministicById: Record<string, any[]> = {};

      for (const it of shapedItems) {
        const historyCategoryId = findHistoryCategoryIdForPayee(it.payee_or_name);

        if (historyCategoryId) {
          deterministicById[it.id] = [{
            category_id: historyCategoryId,
            confidence: 0.93,
            reason: `Matched prior accepted categorization history for this payee.`,
          }];
          continue;
        }

        const hit = deterministicCategorySuggestion(it, categories as any);
        if (hit) {
          deterministicById[it.id] = [hit];
        }
      }

      const llmItems = shapedItems.filter((it: (typeof shapedItems)[number]) => !deterministicById[it.id]);

      const historyRows = await prisma.entry.findMany({
        where: {
          business_id: businessId,
          account_id: accountId,
          deleted_at: null,
          category_id: { not: null },
        },
        select: {
          payee: true,
          memo: true,
          category_id: true,
          date: true,
        },
        orderBy: { date: "desc" },
        take: 300,
      });

      const historyByCategoryId = new Map<string, string>();
      for (const c of categories) {
        historyByCategoryId.set(String(c.id), String(c.name));
      }

      const historyHintsById: Record<string, any[]> = {};
      for (const it of llmItems) {
        const payeeNorm = norm(it.payee_or_name);
        const hits = historyRows
          .filter((r: any) => {
            const rp = norm(r.payee);
            return rp && payeeNorm && (rp.includes(payeeNorm) || payeeNorm.includes(rp));
          })
          .slice(0, 5)
          .map((r: any) => ({
            payee: String(r.payee ?? ""),
            memo: String(r.memo ?? ""),
            category_id: String(r.category_id ?? ""),
            category_name: historyByCategoryId.get(String(r.category_id ?? "")) ?? "Unknown",
          }));

        historyHintsById[it.id] = hits;
      }

      const system =
        "You are a CPA-safe bookkeeping assistant classifying ledger entries into the user's allowed categories only. " +
        "Return JSON only. Never invent categories. If unsure, return an empty list for that id. " +
        "Use bookkeeping logic, not generic consumer-label logic.\n\n" +

        "Important classification rules:\n" +
        "- IRS, franchise tax, sales tax, comptroller, tax payment, tax deposit => prefer Tax.\n" +
        "- Payroll, paycheck, salary, wages, employee pay, ADP, Gusto, payroll service, Zelle to staff => prefer Payroll.\n" +
        "- Bank fee, monthly fee, overdraft, service charge => prefer Bank Charges or Service Charges if available.\n" +
        "- Internet, phone, cable, Spectrum, AT&T, Verizon business service => prefer Utilities, Communications, or the closest operating-expense category; never Payroll.\n" +
        "- American Express payment, credit card payment, loan payment, transfer, online banking transfer, owner transfer, card payoff => do not confidently guess a normal expense category unless the allowed list clearly includes a liability/payment category. If ambiguous, lower confidence or return empty.\n" +
        "- Transfers, checks, card payments, balance-sheet style movements, and unclear merchant strings should not be forced into Payroll or Sale.\n" +
        "- If more than one category is plausible and the evidence is weak, prefer Other/Misc if present; otherwise return empty.\n" +
        "- Never force Payroll unless the text clearly indicates payroll, employee pay, wages, salary, paycheck, ADP, Gusto, or employee/Zelle payroll wording.\n" +
        "- Never force Tax unless the text clearly indicates IRS, tax, comptroller, franchise tax, sales tax, or tax payment wording.\n" +
        "- Never force Sale for a negative amount.\n" +
        "- Use payee, memo, amount sign, and bookkeeping context together.\n" +

        "Output JSON schema:\n" +
        "{ \"suggestionsById\": { \"<id>\": [ {\"category_id\":\"...\",\"confidence\":0.0,\"reason\":\"...\"} ] } }\n" +
        `Return at most ${limitPerItem} suggestions per id. ` +
        "Reasons must be short, concrete, and mention the matched clue.";

      const user =
        `Allowed categories:\n${JSON.stringify(categories, null, 2)}\n\n` +
        `Recent accepted history for similar merchants/payees:\n${JSON.stringify(historyHintsById, null, 2)}\n\n` +
        `Items:\n${JSON.stringify(llmItems, null, 2)}`;

      const raw = llmItems.length
        ? await openAiText({ model, apiKey, system, user, maxTokens: 900 })
        : "{}";

      const parsed = safeJsonParse(raw) ?? {};
      const llmSuggestionsById =
        parsed?.suggestionsById && typeof parsed.suggestionsById === "object"
          ? parsed.suggestionsById
          : {};

      const suggestionsById = {
        ...llmSuggestionsById,
        ...deterministicById,
      };

      await logActivity(prisma, {
        businessId,
        actorUserId: sub,
        eventType: "AI_SUGGEST_CATEGORY" as ActivityEventType,
        payloadJson: { count: shapedItems.length, scope: "category", model },
        scopeAccountId: accountId,
      });

      return json(200, { ok: true, suggestionsById, usage: { ...quota, remaining: quota.remaining - 1 } });
    }

    // /v1/ai/suggest-reconcile-bank
    if (path.endsWith("/v1/ai/suggest-reconcile-bank")) {
      const bankTransaction = body.bankTransaction ?? null;
      const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 12) : [];

      const bankTxnId = String(bankTransaction?.id ?? "").trim();
      if (!bankTxnId) return json(400, { ok: false, error: "Missing bankTransaction.id" });
      if (!candidates.length) return json(200, { ok: true, suggestions: [], usage: { ...quota, remaining: quota.remaining - 1 } });

      const shapedBank = {
        id: bankTxnId,
        posted_date: String(bankTransaction?.posted_date ?? "").slice(0, 10),
        amount_cents: Number(bankTransaction?.amount_cents ?? 0),
        name: String(bankTransaction?.name ?? ""),
      };

      const shapedCandidates = candidates.map((it: any) => ({
        entryId: String(it?.entryId ?? "").trim(),
        date: String(it?.date ?? "").slice(0, 10),
        amount_cents: Number(it?.amount_cents ?? 0),
        payee: String(it?.payee ?? ""),
        amount_delta_cents: Number(it?.amount_delta_cents ?? 0),
        date_delta_days: Number(it?.date_delta_days ?? 0),
        text_similarity: Number(it?.text_similarity ?? 0),
        exact_amount: Boolean(it?.exact_amount),
        heuristic_score: Number(it?.heuristic_score ?? 0),
      })).filter((it: any) => it.entryId);

      const allowedIds = new Set<string>(shapedCandidates.map((it: any) => it.entryId));
      if (!allowedIds.size) return json(200, { ok: true, suggestions: [], usage: { ...quota, remaining: quota.remaining - 1 } });

      const system =
        "You rerank bookkeeping reconcile candidates. Use ONLY the provided bank transaction and candidate entries. " +
        "Never invent ids. Never suggest matching actions, posting actions, or mutations. Return JSON only.\n\n" +
        "Schema:\n" +
        '{"suggestions":[{"entryId":"...","confidence":0.0,"reason":"short reason"}]}\n' +
        "Return at most 3 suggestions sorted best-first. Prefer exact amount match, smaller date delta, stronger text similarity, and realistic bookkeeping matches.";

      const user =
        `Bank transaction:\n${JSON.stringify(shapedBank, null, 2)}\n\n` +
        `Candidate entries:\n${JSON.stringify(shapedCandidates, null, 2)}`;

      const raw = await openAiText({ model, apiKey, system, user, maxTokens: 420 });
      const parsed = parseJsonModelOutput(raw);
      const suggestions = normalizeReconcileSuggestions({ raw: parsed, allowedIds, idKey: "entryId" });

      await logActivity(prisma, {
        businessId,
        actorUserId: sub,
        eventType: "AI_CHAT" as ActivityEventType,
        payloadJson: { scope: "suggest-reconcile-bank", bankTxnId, count: shapedCandidates.length, model },
        scopeAccountId: null,
      });

      return json(200, { ok: true, suggestions, usage: { ...quota, remaining: quota.remaining - 1 } });
    }

    // /v1/ai/suggest-reconcile-entry
    if (path.endsWith("/v1/ai/suggest-reconcile-entry")) {
      const entry = body.entry ?? null;
      const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 12) : [];

      const entryId = String(entry?.id ?? "").trim();
      if (!entryId) return json(400, { ok: false, error: "Missing entry.id" });
      if (!candidates.length) return json(200, { ok: true, suggestions: [], usage: { ...quota, remaining: quota.remaining - 1 } });

      const shapedEntry = {
        id: entryId,
        date: String(entry?.date ?? "").slice(0, 10),
        amount_cents: Number(entry?.amount_cents ?? 0),
        payee: String(entry?.payee ?? ""),
      };

      const shapedCandidates = candidates.map((it: any) => ({
        bankTransactionId: String(it?.bankTransactionId ?? "").trim(),
        posted_date: String(it?.posted_date ?? "").slice(0, 10),
        amount_cents: Number(it?.amount_cents ?? 0),
        name: String(it?.name ?? ""),
        amount_delta_cents: Number(it?.amount_delta_cents ?? 0),
        date_delta_days: Number(it?.date_delta_days ?? 0),
        text_similarity: Number(it?.text_similarity ?? 0),
        exact_amount: Boolean(it?.exact_amount),
        heuristic_score: Number(it?.heuristic_score ?? 0),
      })).filter((it: any) => it.bankTransactionId);

      const allowedIds = new Set<string>(shapedCandidates.map((it: any) => it.bankTransactionId));
      if (!allowedIds.size) return json(200, { ok: true, suggestions: [], usage: { ...quota, remaining: quota.remaining - 1 } });

      const system =
        "You rerank bookkeeping reconcile candidates. Use ONLY the provided entry and candidate bank transactions. " +
        "Never invent ids. Never suggest matching actions, posting actions, or mutations. Return JSON only.\n\n" +
        "Schema:\n" +
        '{"suggestions":[{"bankTransactionId":"...","confidence":0.0,"reason":"short reason"}]}\n' +
        "Return at most 3 suggestions sorted best-first. Prefer exact amount match, smaller date delta, stronger text similarity, and realistic bookkeeping matches.";

      const user =
        `Entry:\n${JSON.stringify(shapedEntry, null, 2)}\n\n` +
        `Candidate bank transactions:\n${JSON.stringify(shapedCandidates, null, 2)}`;

      const raw = await openAiText({ model, apiKey, system, user, maxTokens: 420 });
      const parsed = parseJsonModelOutput(raw);
      const suggestions = normalizeReconcileSuggestions({ raw: parsed, allowedIds, idKey: "bankTransactionId" });

      await logActivity(prisma, {
        businessId,
        actorUserId: sub,
        eventType: "AI_CHAT" as ActivityEventType,
        payloadJson: { scope: "suggest-reconcile-entry", entryId, count: shapedCandidates.length, model },
        scopeAccountId: null,
      });

      return json(200, { ok: true, suggestions, usage: { ...quota, remaining: quota.remaining - 1 } });
    }

    // /v1/ai/chat (F4: aggregates-only; no raw ledger dump)
    if (path.endsWith("/v1/ai/chat")) {
      const question = String(body.question ?? "").trim();
      if (!question) return json(400, { ok: false, error: "Missing question" });

      const aggregates = body.aggregates ?? null;

      const system =
        "You are a CPA-safe bookkeeping assistant. Answer using ONLY the provided aggregates dataset. " +
        "Do not invent numbers. If you cannot answer from aggregates, say Unknown and suggest where to look. " +
        "Include a short 'Links:' section with app-relative URLs for follow-up. End with 'Used fields:'.";

      const user =
        `Question: ${question}\n\n` +
        `Aggregates:\n${JSON.stringify(aggregates, null, 2)}`;

      const answer = await openAiText({ model, apiKey, system, user, maxTokens: 600 });

      await logActivity(prisma, {
        businessId,
        actorUserId: sub,
        eventType: "AI_CHAT" as ActivityEventType,
        payloadJson: { scope: "chat-aggregates", model },
        scopeAccountId: null,
      });

      return json(200, { ok: true, answer, usage: { ...quota, remaining: quota.remaining - 1 } });
    }

    return json(404, { ok: false, error: "Unknown AI route" });
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message ?? "AI failed") });
  }
}