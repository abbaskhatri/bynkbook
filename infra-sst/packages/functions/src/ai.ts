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

      const shapedItems = items.slice(0, 200).map((it: any) => ({
        id: String(it.id ?? ""),
        date: String(it.date ?? "").slice(0, 10),
        amount_cents: Number(it.amount_cents ?? 0),
        payee_or_name: String(it.payee_or_name ?? ""),
        memo: String(it.memo ?? ""),
      }));

      const system =
        "You are a CPA-safe bookkeeping assistant. Suggest categories from the allowed list ONLY. " +
        "Return JSON only. Do not invent categories. If unsure, return an empty list for that id.\n\n" +
        "Output JSON schema:\n" +
        "{ \"suggestionsById\": { \"<id>\": [ {\"category_id\":\"...\",\"confidence\":0.0,\"reason\":\"...\"} ] } }\n" +
        `Return at most ${limitPerItem} suggestions per id.`;

      const user =
        `Allowed categories:\n${JSON.stringify(categories, null, 2)}\n\n` +
        `Items:\n${JSON.stringify(shapedItems, null, 2)}`;

      const raw = await openAiText({ model, apiKey, system, user, maxTokens: 900 });

      const parsed = safeJsonParse(raw) ?? {};
      const suggestionsById = parsed?.suggestionsById && typeof parsed.suggestionsById === "object" ? parsed.suggestionsById : {};

      await logActivity(prisma, {
        businessId,
        actorUserId: sub,
        eventType: "AI_SUGGEST_CATEGORY" as ActivityEventType,
        payloadJson: { count: shapedItems.length, scope: "category", model },
        scopeAccountId: accountId,
      });

      return json(200, { ok: true, suggestionsById, usage: { ...quota, remaining: quota.remaining - 1 } });
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