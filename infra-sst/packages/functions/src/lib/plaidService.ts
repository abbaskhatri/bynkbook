import { getPrisma } from "./db";
import { Products, CountryCode } from "plaid";
import { getPlaidClient } from "./plaidClient";
import { encryptAccessToken, decryptAccessToken } from "./plaidCrypto";
import { createHash, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function compactSafePlaidValue(value: any, fallback: string) {
  const raw = String(value ?? "").trim();
  const text = raw || fallback;
  return text
    .replace(/access[_ -]?token\s*[:=]?\s*["']?[^"',\s)]+/gi, "access_token [redacted]")
    .replace(/client[_ -]?id\s*[:=]?\s*["']?[^"',\s)]+/gi, "client_id [redacted]")
    .replace(/secret\s*[:=]?\s*["']?[^"',\s)]+/gi, "secret [redacted]")
    .slice(0, 240);
}

export function plaidErrorCode(error: any) {
  const data = error?.response?.data ?? {};
  return compactSafePlaidValue(data?.error_code ?? data?.error_type ?? error?.code, "PLAID_SYNC_FAILED").slice(0, 80);
}

export function plaidErrorMessage(error: any) {
  const data = error?.response?.data ?? {};
  return compactSafePlaidValue(data?.error_message ?? data?.display_message ?? error?.message, "Plaid sync failed");
}

function plaidWebhookUrl() {
  const url = String(process.env.PLAID_WEBHOOK_URL ?? "").trim();
  return url || undefined;
}

function reconnectStatusForPlaidFailure(code: string, message: string) {
  const text = `${code} ${message}`.toUpperCase();
  if (text.includes("NO_ACCOUNTS") || text.includes("INVALID_ACCOUNT")) {
    return "PLAID_ACCOUNT_MISSING";
  }
  if (text.includes("WRONG PLAID ENVIRONMENT") || text.includes("INVALID_ACCESS_TOKEN")) {
    return "ENV_MISMATCH_RECONNECT_REQUIRED";
  }
  if (
    text.includes("ITEM_LOGIN_REQUIRED") ||
    text.includes("LOGIN_REQUIRED") ||
    text.includes("PENDING_EXPIRATION") ||
    text.includes("USER_PERMISSION_REVOKED") ||
    text.includes("PERMISSION")
  ) {
    return "REAUTH_REQUIRED";
  }
  return "ERROR";
}

function plaidSyncFailureUserMessage(status: string, code: string) {
  const text = `${status} ${code}`.toUpperCase();
  if (text.includes("PLAID_ACCOUNT_MISSING") || text.includes("NO_ACCOUNTS") || text.includes("INVALID_ACCOUNT")) {
    return "The selected bank account is no longer available from Plaid. Reconnect the bank feed and choose the account again.";
  }

  if (
    text.includes("REAUTH_REQUIRED") ||
    text.includes("ITEM_LOGIN_REQUIRED") ||
    text.includes("LOGIN_REQUIRED") ||
    text.includes("USER_PERMISSION_REVOKED") ||
    text.includes("PENDING_EXPIRATION")
  ) {
    return "Your bank needs you to reconnect before BynkBook can sync transactions.";
  }

  if (text.includes("ENV_MISMATCH_RECONNECT_REQUIRED") || text.includes("INVALID_ACCESS_TOKEN")) {
    return "This bank connection needs to be reconnected before transactions can sync.";
  }

  return "Bank sync could not finish. Try again shortly; current transactions are unchanged.";
}

function canDeferPostReconnectSyncFailure(status: string, code: string) {
  const text = `${status} ${code}`.toUpperCase();
  if (
    text.includes("PLAID_ACCOUNT_MISSING") ||
    text.includes("NO_ACCOUNTS") ||
    text.includes("INVALID_ACCOUNT") ||
    text.includes("REAUTH_REQUIRED") ||
    text.includes("ITEM_LOGIN_REQUIRED") ||
    text.includes("LOGIN_REQUIRED") ||
    text.includes("USER_PERMISSION_REVOKED") ||
    text.includes("PENDING_EXPIRATION") ||
    text.includes("ENV_MISMATCH_RECONNECT_REQUIRED") ||
    text.includes("INVALID_ACCESS_TOKEN")
  ) {
    return false;
  }
  return true;
}

function accountCursorPrefix(plaidAccountId: string) {
  return `account:${plaidAccountId}:`;
}

function itemCursorPrefix() {
  return "item:";
}

function unpackAccountCursor(storedCursor: string | null | undefined, plaidAccountId: string) {
  const raw = String(storedCursor ?? "");
  if (!raw) return { cursor: null, scope: "account" as const, resetFromLegacyCursor: false };

  const prefix = accountCursorPrefix(plaidAccountId);
  if (raw.startsWith(prefix)) {
    const cursor = raw.slice(prefix.length);
    return { cursor: cursor || null, scope: "account" as const, resetFromLegacyCursor: false };
  }

  const itemPrefix = itemCursorPrefix();
  if (raw.startsWith(itemPrefix)) {
    const cursor = raw.slice(itemPrefix.length);
    return { cursor: cursor || null, scope: "item" as const, resetFromLegacyCursor: false };
  }

  return { cursor: null, scope: "account" as const, resetFromLegacyCursor: true };
}

function packSyncCursor(plaidAccountId: string, scope: "account" | "item", cursor: string | null | undefined) {
  const raw = String(cursor ?? "");
  if (!raw) return null;
  return scope === "account" ? `${accountCursorPrefix(plaidAccountId)}${raw}` : `${itemCursorPrefix()}${raw}`;
}

function isPlaidMutationDuringPagination(error: any) {
  const code = plaidErrorCode(error).toUpperCase();
  const message = plaidErrorMessage(error).toUpperCase();
  return code.includes("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") || message.includes("MUTATION_DURING_PAGINATION");
}

function isAccountScopedSyncUnavailable(error: any) {
  const code = plaidErrorCode(error).toUpperCase();
  const message = plaidErrorMessage(error).toUpperCase();
  return code.includes("NO_ACCOUNTS") || code.includes("INVALID_ACCOUNT") || message.includes("NO ACCOUNTS");
}

function isReconnectRequiredStatus(status: string) {
  const s = String(status ?? "").trim().toUpperCase();
  return (
    s === "REAUTH_REQUIRED" ||
    s === "LOGIN_REQUIRED" ||
    s === "ITEM_LOGIN_REQUIRED" ||
    s === "ENV_MISMATCH_RECONNECT_REQUIRED" ||
    s === "PLAID_ACCOUNT_MISSING" ||
    s === "DISCONNECTED" ||
    s === "INACTIVE" ||
    s === "EXPIRED"
  );
}

async function removePlaidItemBestEffort(plaid: any, accessToken: string) {
  try {
    await plaid.itemRemove?.({ access_token: accessToken });
  } catch {
    // Best-effort cleanup only. The access token is not stored if validation fails.
  }
}

async function verifySelectedPlaidAccount(params: {
  plaid: any;
  accessToken: string;
  plaidAccountId: string;
}) {
  const selectedAccountId = String(params.plaidAccountId ?? "").trim();
  if (!selectedAccountId) return null;

  const accountsRes = await params.plaid.accountsGet({ access_token: params.accessToken });
  const accounts = Array.isArray(accountsRes?.data?.accounts) ? accountsRes.data.accounts : [];
  return accounts.find((account: any) => String(account?.account_id ?? "") === selectedAccountId) ?? null;
}

function accountTypeFromPlaidValue(input?: { type?: string; subtype?: string }, fallback = "CHECKING") {
  const raw = `${input?.subtype ?? ""} ${input?.type ?? ""}`.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw.includes("credit")) return "CREDIT_CARD";
  if (raw.includes("saving")) return "SAVINGS";
  if (raw.includes("checking") || raw.includes("depository")) return "CHECKING";
  return "OTHER";
}

function normalizeAdditionalPlaidAccounts(rows: any[]) {
  const seen = new Set<string>();
  const out: Array<{
    plaidAccountId: string;
    name: string;
    type: string;
    subtype?: string;
    mask?: string;
    effectiveStartDate?: string;
  }> = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const plaidAccountId = String(row?.plaidAccountId ?? row?.id ?? "").trim();
    if (!plaidAccountId || seen.has(plaidAccountId)) continue;
    seen.add(plaidAccountId);

    const name = String(row?.name ?? "Bank Account").trim().slice(0, 120) || "Bank Account";
    const type = String(row?.type ?? accountTypeFromPlaidValue(row)).trim().toUpperCase();
    const subtype = String(row?.subtype ?? "").trim() || undefined;
    const mask = String(row?.mask ?? "").trim().slice(0, 8) || undefined;
    const effectiveStartDate = String(row?.effectiveStartDate ?? "").trim() || undefined;
    out.push({ plaidAccountId, name, type, subtype, mask, effectiveStartDate });
  }

  return out;
}

export async function recordPlaidConnectionFailure(params: {
  prisma: any;
  businessId: string;
  accountId: string;
  error: any;
}) {
  const code = plaidErrorCode(params.error);
  const message = plaidErrorMessage(params.error);
  const status = reconnectStatusForPlaidFailure(code, message);
  await params.prisma.bankConnection.updateMany({
    where: { business_id: params.businessId, account_id: params.accountId },
    data: {
      status,
      error_code: code,
      error_message: message,
      updated_at: new Date(),
    },
  });
  return { code, message, status };
}

async function recordPlaidSyncFailure(params: {
  prisma: any;
  businessId: string;
  accountId: string;
  error: any;
}) {
  const code = plaidErrorCode(params.error);
  const message = plaidErrorMessage(params.error);
  const classifiedStatus = reconnectStatusForPlaidFailure(code, message);
  const reconnectRequired = isReconnectRequiredStatus(classifiedStatus);
  const status = reconnectRequired ? classifiedStatus : "SYNC_ERROR";

  await params.prisma.bankConnection.updateMany({
    where: { business_id: params.businessId, account_id: params.accountId },
    data: {
      status,
      error_code: code,
      error_message: message,
      ...(reconnectRequired ? {} : { has_new_transactions: true }),
      updated_at: new Date(),
    },
  });

  return { code, message, status, reconnectRequired };
}

type PlaidWebhookRequest = {
  body: any;
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
};

const plaidWebhookKeyCache = new Map<string, any>();

function getHeader(headers: Record<string, string | string[] | undefined>, name: string) {
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() !== wanted) continue;
    return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function decodeJwtPart(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function timingSafeEqualString(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function verifyPlaidWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>) {
  const signedJwt = String(getHeader(headers, "plaid-verification") ?? "").trim();
  if (!signedJwt) return false;

  const parts = signedJwt.split(".");
  if (parts.length !== 3) return false;

  let header: any;
  let payload: any;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    return false;
  }

  const kid = String(header?.kid ?? "").trim();
  if (header?.alg !== "ES256" || !kid) return false;

  let jwk = plaidWebhookKeyCache.get(kid);
  if (!jwk) {
    try {
      const plaid = await getPlaidClient();
      const response = await plaid.webhookVerificationKeyGet({ key_id: kid });
      jwk = response.data.key;
      if (jwk) plaidWebhookKeyCache.set(kid, jwk);
    } catch {
      return false;
    }
  }

  if (!jwk || (jwk.expired_at && Number(jwk.expired_at) * 1000 <= Date.now())) return false;

  try {
    const publicKey = createPublicKey({ key: jwk as any, format: "jwk" as any });
    const signature = Buffer.from(parts[2], "base64url");
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
    const validSignature = cryptoVerify(
      "sha256",
      signingInput,
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature
    );
    if (!validSignature) return false;
  } catch {
    plaidWebhookKeyCache.delete(kid);
    return false;
  }

  const issuedAtMs = Number(payload?.iat ?? 0) * 1000;
  const now = Date.now();
  if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) return false;
  if (issuedAtMs > now + 60_000) return false;
  if (now - issuedAtMs > 5 * 60_000) return false;

  const claimedBodyHash = String(payload?.request_body_sha256 ?? "").trim();
  if (!claimedBodyHash) return false;

  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  return timingSafeEqualString(bodyHash, claimedBodyHash);
}

export function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

export async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

export async function requireAccountInBusiness(prisma: any, businessId: string, accountId: string) {
  const acct = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true },
  });
  return !!acct;
}

/**
 * Create link token (server-side).
 * Phase 4B: transactions product only.
 */
export async function createLinkTokenBusiness(params: {
  businessId: string;
  userId: string;
}) {
  const { businessId, userId } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const plaid = await getPlaidClient();

  const res = await plaid.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "BynkBook",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
    webhook: plaidWebhookUrl(),

    // Keep new-account Plaid connects aligned with existing-account connects:
    // the selected opening date is only useful if Link initializes enough
    // historical transaction data for sync to drain.
    transactions: { days_requested: 730 },
  });

  return json(200, { ok: true, link_token: res.data.link_token });
}

export async function createLinkToken(params: {
  businessId: string;
  accountId: string;
  userId: string;
  mode?: "connect" | "update";
}) {
  const { businessId, accountId, userId, mode = "connect" } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const plaid = await getPlaidClient();

  if (mode === "update") {
    const conn = await prisma.bankConnection.findFirst({
      where: { business_id: businessId, account_id: accountId },
    });
    if (!conn) return json(400, { ok: false, error: "No bank connection to reconnect" });

    const accessToken = await decryptAccessToken(conn.access_token_ciphertext);
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: "BynkBook",
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: plaidWebhookUrl(),
      access_token: accessToken,
    });

    return json(200, { ok: true, link_token: res.data.link_token, mode: "update" });
  }

  const res = await plaid.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "BynkBook",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
    webhook: plaidWebhookUrl(),

    // Production-grade: request up to 24 months instead of Plaid's default (~90 days)
    transactions: { days_requested: 730 },
  });

  return json(200, { ok: true, link_token: res.data.link_token });
}

async function derivePlaidEffectiveStartDate(prisma: any, businessId: string, accountId: string, provided?: string) {
  const raw = String(provided ?? "").trim();
  if (raw) {
    const start = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(start.getTime())) return null;
    return start;
  }

  const latestBankTxn = await prisma.bankTransaction.findFirst({
    where: {
      business_id: businessId,
      account_id: accountId,
      is_removed: false,
    },
    select: { posted_date: true },
    orderBy: [{ posted_date: "desc" as any }, { created_at: "desc" as any }],
  });
  if (latestBankTxn?.posted_date) return latestBankTxn.posted_date;

  const account = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { opening_balance_date: true },
  });
  if (account?.opening_balance_date) return account.opening_balance_date;

  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
}

/**
 * Exchange public token + store mapping and retention start date.
 * effectiveStartDate is optional for existing BynkBook accounts. If omitted,
 * start from the latest existing bank transaction, then account opening date,
 * then today.
 */
export async function exchangePublicToken(params: {
  businessId: string;
  accountId: string;
  userId: string;
  publicToken: string;
  effectiveStartDate?: string;
  endDate?: string; // optional YYYY-MM-DD (end defaults to today)
  institution?: { name?: string; institution_id?: string };
  plaidAccountId: string;
  mask?: string; // last 4 digits (Plaid account mask)
  allowOpeningAdjustment?: boolean;
  additionalAccounts?: Array<{
    plaidAccountId?: string;
    id?: string;
    name?: string;
    type?: string;
    subtype?: string;
    mask?: string;
    effectiveStartDate?: string;
  }>;
}) {
  const {
    businessId,
    accountId,
    userId,
    publicToken,
    effectiveStartDate,
    institution,
    plaidAccountId,
    mask,
    allowOpeningAdjustment = false,
    additionalAccounts,
  } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const start = await derivePlaidEffectiveStartDate(prisma, businessId, accountId, effectiveStartDate);
  if (!start) return json(400, { ok: false, error: "Invalid effectiveStartDate (YYYY-MM-DD required)" });

  const plaid = await getPlaidClient();
  const ex = await plaid.itemPublicTokenExchange({ public_token: publicToken });

  const accessToken = ex.data.access_token;
  const itemId = ex.data.item_id;
  const accountsRes = await plaid.accountsGet({ access_token: accessToken });
  const verifiedPlaidAccounts = Array.isArray(accountsRes?.data?.accounts) ? accountsRes.data.accounts : [];
  const verifiedAccount =
    verifiedPlaidAccounts.find((account: any) => String(account?.account_id ?? "") === plaidAccountId) ?? null;
  if (!verifiedAccount) {
    await removePlaidItemBestEffort(plaid, accessToken);
    return json(400, {
      ok: false,
      error: "Selected Plaid account was not found on the exchanged Item",
      code: "PLAID_ACCOUNT_SELECTION_MISMATCH",
    });
  }

  const additional = normalizeAdditionalPlaidAccounts(additionalAccounts ?? [])
    .filter((row) => row.plaidAccountId !== plaidAccountId);
  const verifiedByPlaidId = new Map(
    verifiedPlaidAccounts.map((account: any) => [String(account?.account_id ?? ""), account]),
  );
  const invalidAdditional = additional.find((row) => !verifiedByPlaidId.has(row.plaidAccountId));
  if (invalidAdditional) {
    await removePlaidItemBestEffort(plaid, accessToken);
    return json(400, {
      ok: false,
      error: "One or more selected Plaid accounts were not found on the exchanged Item",
      code: "PLAID_ACCOUNT_SELECTION_MISMATCH",
    });
  }

  const selectedPlaidIds = additional.map((row) => row.plaidAccountId);
  const duplicateConnections = selectedPlaidIds.length
    ? await prisma.bankConnection.findMany({
        where: {
          business_id: businessId,
          plaid_account_id: { in: selectedPlaidIds } as any,
        },
        select: { account_id: true, plaid_account_id: true },
      })
    : [];
  const conflictingConnection = duplicateConnections.find(
    (row: any) => String(row.account_id) !== String(accountId) || String(row.plaid_account_id) !== String(plaidAccountId),
  );
  if (conflictingConnection) {
    await removePlaidItemBestEffort(plaid, accessToken);
    return json(409, {
      ok: false,
      error: "One of the selected Plaid accounts is already connected to another BynkBook account",
      code: "PLAID_ACCOUNT_ALREADY_CONNECTED",
    });
  }

  const verifiedMask = verifiedAccount?.mask ? String(verifiedAccount.mask) : mask ?? null;
  const ciphertext = await encryptAccessToken(accessToken);
  const openingAdjustmentCreatedAt = allowOpeningAdjustment ? null : new Date();
  const openingPolicy = allowOpeningAdjustment ? "AUTO" : "MANUAL";

  // Upsert one connection per account
  await prisma.bankConnection.upsert({
    where: { business_id_account_id: { business_id: businessId, account_id: accountId } },
    create: {
      business_id: businessId,
      account_id: accountId,
      plaid_item_id: itemId,
      plaid_account_id: plaidAccountId,
      access_token_ciphertext: ciphertext,
      effective_start_date: start,
      institution_name: institution?.name ?? null,
      institution_id: institution?.institution_id ?? null,
      plaid_mask: verifiedMask,
      status: "CONNECTED",
      sync_cursor: null,
      has_new_transactions: false,
      opening_policy: openingPolicy,
      opening_adjustment_created_at: openingAdjustmentCreatedAt,
    },
    update: {
      plaid_item_id: itemId,
      plaid_account_id: plaidAccountId,
      access_token_ciphertext: ciphertext,
      effective_start_date: start,
      institution_name: institution?.name ?? null,
      institution_id: institution?.institution_id ?? null,
      plaid_mask: verifiedMask,
      status: "CONNECTED",
      sync_cursor: null,
      error_code: null,
      error_message: null,
      has_new_transactions: false,
      opening_policy: openingPolicy,
      opening_adjustment_created_at: openingAdjustmentCreatedAt,
      updated_at: new Date(),
    },
  });

  const createdAdditionalAccounts: any[] = [];
  for (const row of additional) {
    const verified = verifiedByPlaidId.get(row.plaidAccountId) as any;
    const extraStart = await derivePlaidEffectiveStartDate(
      prisma,
      businessId,
      accountId,
      row.effectiveStartDate ?? effectiveStartDate,
    );
    if (!extraStart) {
      await removePlaidItemBestEffort(plaid, accessToken);
      return json(400, { ok: false, error: "Invalid effectiveStartDate (YYYY-MM-DD required)" });
    }

    const extraAccountId = (await import("node:crypto")).randomUUID();
    const extraMask = verified?.mask ? String(verified.mask) : row.mask ?? null;
    const extraType = accountTypeFromPlaidValue(
      { type: verified?.type ?? row.type, subtype: verified?.subtype ?? row.subtype },
      row.type || "CHECKING",
    );

    await prisma.$transaction([
      prisma.account.create({
        data: {
          id: extraAccountId,
          business_id: businessId,
          name: row.name,
          type: extraType,
          opening_balance_cents: 0n,
          opening_balance_date: extraStart,
          institution_name: institution?.name ?? null,
          last4: extraMask,
        } as any,
      }),
      prisma.bankConnection.create({
        data: {
          business_id: businessId,
          account_id: extraAccountId,
          plaid_item_id: itemId,
          plaid_account_id: row.plaidAccountId,
          access_token_ciphertext: ciphertext,
          effective_start_date: extraStart,
          institution_name: institution?.name ?? null,
          institution_id: institution?.institution_id ?? null,
          plaid_mask: extraMask,
          status: "CONNECTED",
          sync_cursor: null,
          has_new_transactions: false,
          opening_policy: "AUTO",
          opening_adjustment_created_at: null,
        } as any,
      }),
    ]);

    createdAdditionalAccounts.push({
      accountId: extraAccountId,
      plaidAccountId: row.plaidAccountId,
      name: row.name,
      type: extraType,
      last4: extraMask,
      effectiveStartDate: extraStart.toISOString().slice(0, 10),
    });
  }

  return json(200, {
    ok: true,
    connected: true,
    effectiveStartDate: start.toISOString().slice(0, 10),
    additionalAccounts: createdAdditionalAccounts,
  });
}

export async function getStatus(params: { businessId: string; accountId: string; userId: string }) {
  const { businessId, accountId, userId } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const conn = await prisma.bankConnection.findFirst({
    where: { business_id: businessId, account_id: accountId },
  });

  if (!conn)
    return json(200, {
      ok: true,
      connected: false,
      status: null,
      needsAttention: false,
      errorMessage: null,
      institutionName: null,
      last4: null,
      lastSyncAt: null,
      hasNewTransactions: false,
      effectiveStartDate: null,
      lastKnownBalanceCents: null,
      lastKnownBalanceAt: null,
      error: null,
    });
    
  // TS guard: keep a non-null reference for the rest of this function (incl. nested helpers).
  // Status is the app's active Plaid health probe: the local DB row is not enough
  // to prove the selected Plaid account still exists on the Item.
  const connRow = conn;
  let plaidAccountLive: boolean | null = null;
  let plaidHealthErrorCode: string | null = null;
  let plaidHealthErrorMessage: string | null = null;

  try {
    const plaid = await getPlaidClient();
    const accessToken = await decryptAccessToken(connRow.access_token_ciphertext);
    const accountsRes = await plaid.accountsGet({ access_token: accessToken });
    const accounts = Array.isArray(accountsRes?.data?.accounts) ? accountsRes.data.accounts : [];
    let acct = accounts.find((a) => a.account_id === connRow.plaid_account_id);

    if (!acct && accounts.length === 1) {
      acct = accounts[0];
      const repairedMask = acct?.mask ? String(acct.mask) : connRow.plaid_mask ?? null;
      await prisma.bankConnection.updateMany({
        where: { business_id: businessId, account_id: accountId },
        data: {
          plaid_account_id: String(acct.account_id),
          plaid_mask: repairedMask,
          status: "CONNECTED",
          error_code: null,
          error_message: null,
          sync_cursor: null,
          updated_at: new Date(),
        },
      });
      (connRow as any).plaid_account_id = String(acct.account_id);
      (connRow as any).plaid_mask = repairedMask;
      (connRow as any).status = "CONNECTED";
      (connRow as any).error_code = null;
      (connRow as any).error_message = null;
    }

    if (acct) {
      plaidAccountLive = true;
      const mask = acct?.mask ? String(acct.mask) : null;
      if (mask && mask !== connRow.plaid_mask) {
        await prisma.bankConnection.updateMany({
          where: { business_id: businessId, account_id: accountId },
          data: { plaid_mask: mask, updated_at: new Date() },
        });
        (connRow as any).plaid_mask = mask;
      }
    } else {
      plaidAccountLive = false;
      plaidHealthErrorCode = "PLAID_ACCOUNT_MISSING";
      plaidHealthErrorMessage = "The selected bank account is no longer available from Plaid.";
      await prisma.bankConnection.updateMany({
        where: { business_id: businessId, account_id: accountId },
        data: {
          status: "PLAID_ACCOUNT_MISSING",
          error_code: plaidHealthErrorCode,
          error_message: plaidHealthErrorMessage,
          updated_at: new Date(),
        },
      });
      (connRow as any).status = "PLAID_ACCOUNT_MISSING";
      (connRow as any).error_code = plaidHealthErrorCode;
      (connRow as any).error_message = plaidHealthErrorMessage;
    }
  } catch (healthError: any) {
    plaidHealthErrorCode = plaidErrorCode(healthError);
    plaidHealthErrorMessage = plaidErrorMessage(healthError);
    const healthStatus = reconnectStatusForPlaidFailure(plaidHealthErrorCode, plaidHealthErrorMessage);

    if (isReconnectRequiredStatus(healthStatus)) {
      await prisma.bankConnection.updateMany({
        where: { business_id: businessId, account_id: accountId },
        data: {
          status: healthStatus,
          error_code: plaidHealthErrorCode,
          error_message: plaidHealthErrorMessage,
          updated_at: new Date(),
        },
      });
      (connRow as any).status = healthStatus;
      (connRow as any).error_code = plaidHealthErrorCode;
      (connRow as any).error_message = plaidHealthErrorMessage;
      plaidAccountLive = false;
    }
    // Transient Plaid/API failures should not make the status endpoint fail or
    // flip a healthy feed into a reconnect-required state.
  }

  const rawStatus = (connRow.status ?? "").toString();
  const statusNorm = rawStatus.trim().toUpperCase();

  // Guardrail: needsAttention means user action is required, not merely that the
  // latest Plaid transaction sync failed. Generic sync failures keep the feed connected.
  const UNHEALTHY_STATUSES = new Set<string>([
    "DISCONNECTED",
    "REAUTH_REQUIRED",
    "LOGIN_REQUIRED",
    "ITEM_LOGIN_REQUIRED",
    "ENV_MISMATCH_RECONNECT_REQUIRED",
    "PLAID_ACCOUNT_MISSING",
    "INACTIVE",
    "EXPIRED",
  ]);

  const TRANSITIONAL_STATUSES = new Set<string>([
    "CONNECTING",
    "PENDING",
    "SYNCING",
    "UPDATING",
    "INITIALIZING",
    "PENDING_SYNC",
  ]);

  const isUnhealthyStatus = UNHEALTHY_STATUSES.has(statusNorm);
  const isTransitionalStatus = TRANSITIONAL_STATUSES.has(statusNorm);

  const needsAttention = isUnhealthyStatus && !isTransitionalStatus;

  function shortDetailFromStatusOrError() {
    // Prefer status-based short copy (user-friendly), then fallback to error_code/message.
    if (statusNorm === "REAUTH_REQUIRED") return "Re-authentication required";
    if (statusNorm === "LOGIN_REQUIRED" || statusNorm === "ITEM_LOGIN_REQUIRED") return "Login required";
    if (statusNorm === "PLAID_ACCOUNT_MISSING") return "Selected Plaid account unavailable";
    if (statusNorm === "DISCONNECTED") return "Connection disconnected";
    if (statusNorm === "SYNC_ERROR" || statusNorm === "ERROR") return "Bank sync issue";

    const code = (connRow.error_code ?? "").toString().trim();
    if (code) {
      // Turn ITEM_LOGIN_REQUIRED -> "Login required", etc (basic normalization)
      const c = code.toUpperCase();
      if (c.includes("LOGIN")) return "Login required";
      if (c.includes("REAUTH")) return "Re-authentication required";
      if (c.includes("DISCONNECT")) return "Connection disconnected";
      return code.length > 40 ? code.slice(0, 40) + "…" : code;
    }

    const msg = (connRow.error_message ?? "").toString().trim();
    if (msg) {
      // Keep the tooltip short: first sentence-ish, capped.
      const first = msg.split("\n")[0]?.split(". ")[0] ?? msg;
      const clean = first.trim();
      return clean.length > 80 ? clean.slice(0, 80) + "…" : clean;
    }

    return "";
  }

  const errorMessage = needsAttention
    ? (() => {
      const d = shortDetailFromStatusOrError();
      return d ? `Reconnect required — ${d}` : "Reconnect required";
    })()
    : null;

  return json(200, {
    ok: true,
    connected: connRow.status === "CONNECTED" || statusNorm === "PENDING_SYNC" || statusNorm === "SYNC_ERROR" || statusNorm === "ERROR",
    status: connRow.status,
    institutionName: connRow.institution_name,
    last4: connRow.plaid_mask ?? null,
    lastSyncAt: connRow.last_sync_at ? connRow.last_sync_at.toISOString() : null,
    needsAttention,
    errorMessage,
    hasNewTransactions: !!connRow.has_new_transactions,
    effectiveStartDate: connRow.effective_start_date.toISOString().slice(0, 10),
    lastKnownBalanceCents: connRow.last_known_balance_cents?.toString?.() ?? null,
    lastKnownBalanceAt: connRow.last_known_balance_at ? connRow.last_known_balance_at.toISOString() : null,
    error: connRow.error_message ?? null,
    plaidAccountLive,
    plaidHealthErrorCode,
    plaidHealthErrorMessage,
  });
}

export async function repairPlaidAccountMapping(params: {
  businessId: string;
  accountId: string;
  userId: string;
  plaidAccountId: string;
  institution?: { name?: string; institution_id?: string };
  mask?: string;
}) {
  const { businessId, accountId, userId, plaidAccountId, institution, mask } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const conn = await prisma.bankConnection.findFirst({
    where: { business_id: businessId, account_id: accountId },
  });
  if (!conn) return json(400, { ok: false, error: "No bank connection to repair" });

  const selectedPlaidAccountId = String(plaidAccountId ?? "").trim();
  if (!selectedPlaidAccountId) return json(400, { ok: false, error: "Missing plaidAccountId" });

  const duplicate = await prisma.bankConnection.findMany({
    where: {
      business_id: businessId,
      plaid_account_id: selectedPlaidAccountId,
    },
    select: { account_id: true, plaid_account_id: true },
  });
  const conflict = duplicate.find((row: any) => String(row.account_id) !== String(accountId));
  if (conflict) {
    return json(409, {
      ok: false,
      error: "Selected Plaid account is already connected to another BynkBook account",
      code: "PLAID_ACCOUNT_ALREADY_CONNECTED",
    });
  }

  const plaid = await getPlaidClient();
  const accessToken = await decryptAccessToken(conn.access_token_ciphertext);
  const accountsRes = await plaid.accountsGet({ access_token: accessToken });
  const accounts = Array.isArray(accountsRes?.data?.accounts) ? accountsRes.data.accounts : [];
  const selected = accounts.find((account: any) => String(account?.account_id ?? "") === selectedPlaidAccountId);
  if (!selected) {
    return json(400, {
      ok: false,
      error: "Selected Plaid account was not found on the existing Item",
      code: "PLAID_ACCOUNT_SELECTION_MISMATCH",
      accounts: accounts.map((account: any) => ({
        id: String(account?.account_id ?? ""),
        name: account?.name ? String(account.name) : undefined,
        mask: account?.mask ? String(account.mask) : undefined,
        type: account?.type ? String(account.type) : undefined,
        subtype: account?.subtype ? String(account.subtype) : undefined,
      })).filter((account: any) => account.id),
    });
  }

  const verifiedMask = selected?.mask ? String(selected.mask) : mask ?? null;
  await prisma.bankConnection.updateMany({
    where: { business_id: businessId, account_id: accountId },
    data: {
      plaid_account_id: selectedPlaidAccountId,
      plaid_mask: verifiedMask,
      institution_name: institution?.name ?? conn.institution_name ?? null,
      institution_id: institution?.institution_id ?? conn.institution_id ?? null,
      status: "CONNECTED",
      error_code: null,
      error_message: null,
      sync_cursor: null,
      has_new_transactions: true,
      updated_at: new Date(),
    },
  });

  return json(200, {
    ok: true,
    connected: true,
    plaidAccountId: selectedPlaidAccountId,
    last4: verifiedMask,
    institutionName: institution?.name ?? conn.institution_name ?? null,
  });
}

export async function disconnectBankConnection(params: { businessId: string; accountId: string; userId: string }) {
  const { businessId, accountId, userId } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  // Idempotent disconnect:
  // Remove ONLY the bank connection mapping/cursor/token for this account.
  // Do NOT delete bank transaction history (BankTransaction is NOT FK-linked to BankConnection).
  await prisma.bankConnection.deleteMany({
    where: { business_id: businessId, account_id: accountId },
  });

  return json(200, { ok: true, disconnected: true });
}

/**
 * Sync transactions (cursor-based) + retention + balance + webhook flag clearing + opening adjustment entry.
 * Returns: newCount, upgradedCount, duplicateCount, pendingCount, lastSyncAt
 */
export async function syncTransactions(params: {
  businessId: string;
  accountId: string;
  userId: string;
  requestRefresh?: boolean;
  afterReconnect?: boolean;
}) {
  const { businessId, accountId, userId, requestRefresh, afterReconnect } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const conn = await prisma.bankConnection.findFirst({
    where: { business_id: businessId, account_id: accountId },
  });
  if (!conn) return json(400, { ok: false, error: "No bank connection for this account" });

  const recordSyncFailure = async (error: any) => {
    const { code, status, reconnectRequired } = await recordPlaidSyncFailure({ prisma, businessId, accountId, error });
    if (afterReconnect && canDeferPostReconnectSyncFailure(status, code)) {
      const now = new Date();
      await prisma.bankConnection.updateMany({
        where: { business_id: businessId, account_id: accountId },
        data: {
          status: "PENDING_SYNC",
          error_code: code,
          error_message: plaidErrorMessage(error),
          has_new_transactions: true,
          updated_at: now,
        },
      });
      return json(200, {
        ok: true,
        pendingSync: true,
        newCount: 0,
        upgradedCount: 0,
        duplicateCount: 0,
        pendingCount: 0,
        message: "Bank reconnected. Transactions are still being prepared by the bank and will sync shortly.",
      });
    }
    return json(502, {
      ok: false,
      error: "Plaid sync failed",
      errorCode: code,
      status,
      message: plaidSyncFailureUserMessage(status, code),
      reconnectRequired,
    });
  };

  try {
    const plaid = await getPlaidClient();
    const accessToken = await decryptAccessToken(conn.access_token_ciphertext);
    let refreshRequested = false;
    let refreshSucceeded = false;
    let refreshErrorCode: string | null = null;
    let refreshErrorMessage: string | null = null;

    if (requestRefresh) {
      refreshRequested = true;
      try {
        await plaid.transactionsRefresh({ access_token: accessToken });
        refreshSucceeded = true;
      } catch (refreshError: any) {
        refreshErrorCode = plaidErrorCode(refreshError);
        refreshErrorMessage = plaidErrorMessage(refreshError);
      }
    }

    // Initial backfill deletion rule (only delete PLAID-sourced rows older than effectiveStartDate)
    // Because Phase 4B has no CSV parsing, PLAID is the only source inserted here.
    await prisma.bankTransaction.deleteMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        posted_date: { lt: conn.effective_start_date },

        // Critical: do NOT delete CSV-imported history.
        // Only delete Plaid-sourced rows (source="PLAID" or null legacy Plaid rows) that have plaid_transaction_id.
        plaid_transaction_id: { not: null },
        OR: [{ source: "PLAID" }, { source: null }],
      },
    });

    const plaidAccountId = conn.plaid_account_id;
    const effectiveStartDate = conn.effective_start_date;
    let currentBalanceCents: bigint | null = null;
    let balanceLookupSucceeded = false;
    let balanceErrorCode: string | null = null;
    let balanceErrorMessage: string | null = null;

    // Balance is helpful UI metadata, but it must never block transaction sync.
    // Plaid can return NO_ACCOUNTS for balance/account lookups while transaction
    // sync is still the authoritative source for new bank rows.
    try {
      const balRes = await plaid.accountsBalanceGet({ access_token: accessToken });
      const acct = balRes.data.accounts.find((a) => a.account_id === plaidAccountId);
      const currentBalance = acct?.balances?.current ?? null;
      if (currentBalance != null) {
        currentBalanceCents = BigInt(Math.round(currentBalance * 100));
        balanceLookupSucceeded = true;
      }
    } catch (balanceError: any) {
      balanceErrorCode = plaidErrorCode(balanceError);
      balanceErrorMessage = plaidErrorMessage(balanceError);
      console.warn("Plaid balance lookup skipped during transaction sync", {
        businessId,
        accountId,
        plaidAccountId,
        errorCode: balanceErrorCode,
        errorMessage: balanceErrorMessage,
      });
    }

    const initialCursorInfo = unpackAccountCursor(conn.sync_cursor ?? null, plaidAccountId);
    let cursorScope: "account" | "item" = initialCursorInfo.scope;
    let drainStartCursor = initialCursorInfo.cursor;
    let cursor = drainStartCursor;
    let hasMore = true;
    let accountScopedFallback = false;
    let accountScopedFallbackCode: string | null = null;

  // Drain safety (production hardening)
  const MAX_PAGES = 20;          // safety cap
  const MAX_TOTAL = 5000;        // safety cap
  const RETRY_MAX = 3;
  const BACKOFF_BASE_MS = 350;
  const MAX_DRAIN_RESTARTS = 3;

  let pageN = 0;
  let totalSeen = 0;
  let drainRestartCount = 0;

  let newCount = 0;
  let upgradedCount = 0;
  let duplicateCount = 0;

  // pendingCount will be computed from DB at end (accurate), not guessed during loop
  let pendingCount = 0;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function syncPage() {
    for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
      try {
        const request: any = {
          access_token: accessToken,
          cursor: cursor ?? undefined,
          count: 500,
        };
        if (cursorScope === "account") request.options = { account_id: plaidAccountId };
        return await plaid.transactionsSync(request);
      } catch (e: any) {
        if (isPlaidMutationDuringPagination(e)) throw e;
        if (cursorScope === "account" && isAccountScopedSyncUnavailable(e)) throw e;
        // light backoff for transient errors / rate limiting
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt);
        if (attempt < RETRY_MAX - 1) await sleep(backoff);
        else throw e;
      }
    }
    throw new Error("Plaid transactions/sync failed");
  }

  let drainedUpserts: any[] = [];
  let drainedRemoved: any[] = [];

  while (true) {
    cursor = drainStartCursor;
    hasMore = true;
    pageN = 0;
    totalSeen = 0;
    const candidateUpserts: any[] = [];
    const candidateRemoved: any[] = [];

    try {
      while (hasMore) {
        if (pageN >= MAX_PAGES) break;
        if (totalSeen >= MAX_TOTAL) break;

        const r = await syncPage();
        pageN += 1;

        const data = r.data;
        cursor = data.next_cursor;
        hasMore = data.has_more;

        // Count seen for safety caps
        const pageSeen = (data.added?.length ?? 0) + (data.modified?.length ?? 0) + (data.removed?.length ?? 0);
        totalSeen += pageSeen;
        if (totalSeen >= MAX_TOTAL) hasMore = false;

        // Plaid is already account-filtered. Keep this guard for legacy or unexpected responses.
        candidateUpserts.push(...[...data.added, ...data.modified].filter((t) => t.account_id === plaidAccountId));
        candidateRemoved.push(...data.removed);
      }

      drainedUpserts = candidateUpserts;
      drainedRemoved = candidateRemoved;
      break;
    } catch (error) {
      if (cursorScope === "account" && isAccountScopedSyncUnavailable(error)) {
        accountScopedFallback = true;
        accountScopedFallbackCode = plaidErrorCode(error);
        cursorScope = "item";
        drainStartCursor = null;
        cursor = null;
        continue;
      }
      if (isPlaidMutationDuringPagination(error) && drainRestartCount < MAX_DRAIN_RESTARTS) {
        drainRestartCount += 1;
        await sleep(BACKOFF_BASE_MS * Math.pow(2, drainRestartCount));
        continue;
      }
      throw error;
    }
  }

  const now = new Date();

  for (const t of drainedUpserts) {
    // Retention: do not retain anything older than effectiveStartDate
    const posted = t.date ? new Date(`${t.date}T00:00:00Z`) : null;
    if (!posted) continue;
    if (posted < effectiveStartDate) continue;

    // Plaid: amount is positive for outflows (debits). Our BankTransaction uses negative for outflows.
    const cents = -BigInt(Math.round(Number(t.amount) * 100));
    const isPending = !!t.pending;

    // Pending -> posted upgrade:
    // If Plaid provides pending_transaction_id, update that existing row to become this posted txn.
    if (!isPending && t.pending_transaction_id) {
      const pendingId = String(t.pending_transaction_id);
      if (pendingId) {
        const upgraded = await prisma.bankTransaction.updateMany({
          where: {
            business_id: businessId,
            account_id: accountId,
            plaid_transaction_id: pendingId,
            plaid_account_id: plaidAccountId,
          },
          data: {
            plaid_transaction_id: t.transaction_id,
            posted_date: posted,
            authorized_date: t.authorized_date ? new Date(`${t.authorized_date}T00:00:00Z`) : null,
            amount_cents: cents,
            name: (t.name ?? t.merchant_name ?? "Transaction").toString(),
            is_pending: false,
            iso_currency_code: t.iso_currency_code ?? null,
            is_removed: false,
            removed_at: null,
            source: "PLAID",
            plaid_account_id: plaidAccountId,
            raw: t as any,
            updated_at: now,
          },
        });
        if (upgraded.count > 0) {
          upgradedCount += upgraded.count;
          continue;
        }
      }
    }

    try {
      await prisma.bankTransaction.create({
        data: {
          business_id: businessId,
          account_id: accountId,
          plaid_transaction_id: t.transaction_id,
          plaid_account_id: plaidAccountId,
          source: "PLAID",
          posted_date: posted,
          authorized_date: t.authorized_date ? new Date(`${t.authorized_date}T00:00:00Z`) : null,
          amount_cents: cents,
          name: (t.name ?? t.merchant_name ?? "Transaction").toString(),
          is_pending: isPending,
          iso_currency_code: t.iso_currency_code ?? null,
          is_removed: false,
          raw: t as any,
        },
      });
      newCount += 1;
    } catch {
      duplicateCount += 1;
      await prisma.bankTransaction.updateMany({
        where: {
          business_id: businessId,
          account_id: accountId,
          plaid_transaction_id: t.transaction_id,
          plaid_account_id: plaidAccountId,
        },
        data: {
          posted_date: posted,
          authorized_date: t.authorized_date ? new Date(`${t.authorized_date}T00:00:00Z`) : null,
          amount_cents: cents,
          name: (t.name ?? t.merchant_name ?? "Transaction").toString(),
          is_pending: isPending,
          iso_currency_code: t.iso_currency_code ?? null,
          is_removed: false,
          removed_at: null,
          source: "PLAID",
          plaid_account_id: plaidAccountId,
          raw: t as any,
          updated_at: now,
        },
      });
    }
  }

  for (const removed of drainedRemoved) {
    await prisma.bankTransaction.updateMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        plaid_transaction_id: removed.transaction_id,
        plaid_account_id: plaidAccountId,
      },
      data: { is_removed: true, removed_at: now, updated_at: now },
    });
  }

  // Accurate pending count after sync (not guesswork)
  pendingCount = await prisma.bankTransaction.count({
    where: {
      business_id: businessId,
      account_id: accountId,
      is_removed: false,
      is_pending: true,
      posted_date: { gte: effectiveStartDate },
    },
  });

  // Opening adjustment rule (create exactly once per account on initial connect/backfill)
  // opening_adjustment = current_bank_balance − sum(posted_transactions_in_retained_window)
  if (conn.opening_adjustment_created_at == null && currentBalanceCents != null) {
    const sum = await prisma.bankTransaction.aggregate({
      where: {
        business_id: businessId,
        account_id: accountId,
        is_removed: false,
        is_pending: false,
        posted_date: { gte: effectiveStartDate },
      },
      _sum: { amount_cents: true as any },
    });

    const sumCents = BigInt((sum as any)._sum?.amount_cents ?? 0);
    const openingAdjustment = currentBalanceCents - sumCents;

    // Create ledger Entry (Phase 3 rule: INCOME/EXPENSE only; enforce sign)
    const abs = openingAdjustment < 0n ? -openingAdjustment : openingAdjustment;
    const entryType = openingAdjustment >= 0n ? "INCOME" : "EXPENSE";
    const signed = entryType === "INCOME" ? abs : -abs;

    // Professional rule:
    // - If the account already has user-entered entries, DO NOT create a synthetic opening.
    // - If the only entry is an auto-created zero "Opening Balance", UPDATE it instead of creating a second one.
    const existing = await prisma.entry.findMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        deleted_at: null,
      },
      select: { id: true, payee: true, amount_cents: true },
      orderBy: { created_at: "asc" as any },
      take: 20,
    });

    const lower = (s: any) => String(s ?? "").trim().toLowerCase();
    const isOpeningLike = (p: any) => {
      const x = lower(p);
      return x === "opening balance" || x === "opening balance (estimated)" || x.startsWith("opening balance");
    };

    const openingLike = existing.filter((e) => isOpeningLike(e.payee));
    const nonOpening = existing.filter((e) => !isOpeningLike(e.payee));

    const hasNonOpeningEntries = nonOpening.length > 0;
    const zeroOpening = openingLike.find((e) => BigInt(e.amount_cents ?? 0) === 0n);

    // Canonical opening enforcement (data-level):
    // If we have multiple opening-like entries and no other entries, keep the earliest and void the rest.
    if (!hasNonOpeningEntries && openingLike.length > 1) {
      const keep = openingLike[0];
      const extras = openingLike.slice(1);
      await prisma.entry.updateMany({
        where: { id: { in: extras.map((x) => x.id) } as any },
        data: {
          deleted_at: now,
          memo: "Voided duplicate opening balance entry (system cleanup).",
          updated_at: now,
        } as any,
      });

      // If the kept opening is zero placeholder, our logic below will update it to estimated.
      // If kept opening is non-zero, we do NOT overwrite (guardrail).
    }

    if (!hasNonOpeningEntries) {
      if (zeroOpening) {
        // Replace the placeholder opening with the Plaid-estimated opening (no duplicates)
        await prisma.$transaction([
          prisma.entry.update({
            where: { id: zeroOpening.id },
            data: {
              payee: "Opening balance (estimated)",
              memo: "Estimated from current balance and synced transactions (Plaid).",
              amount_cents: signed,
              type: entryType,
              method: null,
              category_id: null,
              vendor_id: null,
              status: "EXPECTED",
              date: effectiveStartDate,
              updated_at: now,
            } as any,
          }),

          // Option A (strict guardrail): only because we are replacing a ZERO placeholder
          // and there are no non-opening entries. Settings must match Ledger.
          prisma.account.update({
            where: { id: accountId },
            data: {
              opening_balance_cents: abs,
              opening_balance_date: effectiveStartDate,
              updated_at: now,
            } as any,
          }),
        ]);
      } else if (existing.length === 0) {
        // Truly empty account => create the estimated opening once (and update account opening fields)
        await prisma.$transaction([
          prisma.entry.create({
            data: {
              id: (await import("node:crypto")).randomUUID(),
              business_id: businessId,
              account_id: accountId,
              date: effectiveStartDate,
              payee: "Opening balance (estimated)",
              memo: "Estimated from current balance and synced transactions (Plaid).",
              amount_cents: signed,
              type: entryType,
              method: null,
              category_id: null,
              vendor_id: null,
              status: "EXPECTED",
            },
          }),

          prisma.account.update({
            where: { id: accountId },
            data: {
              opening_balance_cents: abs,
              opening_balance_date: effectiveStartDate,
              updated_at: now,
            } as any,
          }),
        ]);
      }
    }

    await prisma.bankConnection.updateMany({
      where: { business_id: businessId, account_id: accountId },
      data: { opening_adjustment_created_at: now, updated_at: now },
    });
  }

  const connectionUpdateData: any = {
    sync_cursor: packSyncCursor(plaidAccountId, cursorScope, cursor),
    last_sync_at: now,
    has_new_transactions: false,
    status: "CONNECTED",
    error_code: null,
    error_message: null,
    updated_at: now,
  };

  if (balanceLookupSucceeded) {
    connectionUpdateData.last_known_balance_cents = currentBalanceCents;
    connectionUpdateData.last_known_balance_at = now;
  }

  await prisma.bankConnection.updateMany({
    where: { business_id: businessId, account_id: accountId },
    data: connectionUpdateData,
  });

  return json(200, {
    ok: true,
    newCount,
    upgradedCount,
    duplicateCount,
    pendingCount,
    lastSyncAt: now.toISOString(),
    refreshRequested,
    refreshSucceeded,
    refreshErrorCode,
    refreshErrorMessage,
    balanceLookupSucceeded,
    balanceErrorCode,
    balanceErrorMessage,

    // Progress metadata (useful for UI)
    pages: pageN,
    totalSeen,
    capped: pageN >= MAX_PAGES || totalSeen >= MAX_TOTAL,
    hasMore: hasMore,
    drainRestartCount,
    cursorScope,
    accountScopedFallback,
    accountScopedFallbackCode,
    cursorResetFromLegacyScope: initialCursorInfo.resetFromLegacyCursor,
  });
  } catch (error) {
    return recordSyncFailure(error);
  }
}

export async function handleWebhook(request: PlaidWebhookRequest) {
  const verified = await verifyPlaidWebhook(request.rawBody, request.headers);
  if (!verified) return json(401, { ok: false, error: "Invalid Plaid webhook signature" });

  const body = request.body;
  const prisma = await getPrisma();

  const itemId = (body?.item_id ?? "").toString();
  const webhookType = (body?.webhook_type ?? "").toString();
  const webhookCode = (body?.webhook_code ?? "").toString();

  if (!itemId) return json(400, { ok: false, error: "Missing item_id" });

  const typeNorm = webhookType.toUpperCase();
  const codeNorm = webhookCode.toUpperCase();

  if (typeNorm === "TRANSACTIONS") {
    await prisma.bankConnection.updateMany({
      where: { plaid_item_id: itemId },
      data: { has_new_transactions: true, updated_at: new Date() },
    });

    return json(200, { ok: true, webhookType, webhookCode });
  }

  if (typeNorm === "ITEM") {
    const rawError = body?.error ?? {};
    const code = compactSafePlaidValue(rawError?.error_code ?? webhookCode, webhookCode || "PLAID_ITEM_WEBHOOK").slice(0, 80);
    const message = compactSafePlaidValue(
      rawError?.error_message ?? rawError?.display_message ?? webhookCode,
      webhookCode || "Plaid item webhook"
    );
    const status =
      codeNorm === "ERROR"
        ? reconnectStatusForPlaidFailure(code, message)
        : codeNorm === "PENDING_EXPIRATION" || codeNorm === "USER_PERMISSION_REVOKED"
          ? "REAUTH_REQUIRED"
          : null;

    if (status) {
      await prisma.bankConnection.updateMany({
        where: { plaid_item_id: itemId },
        data: {
          status,
          error_code: code,
          error_message: message,
          updated_at: new Date(),
        },
      });

      return json(200, { ok: true, webhookType, webhookCode, updated: true });
    }

    return json(200, { ok: true, webhookType, webhookCode, ignored: true });
  }

  return json(200, { ok: true, webhookType, webhookCode, ignored: true });
}
