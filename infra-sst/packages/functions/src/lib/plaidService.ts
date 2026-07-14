import { getPrisma } from "./db";
import { Products, CountryCode } from "plaid";
import type { TransactionsGetRequest, TransactionsSyncRequest } from "plaid";
import { getPlaidClient } from "./plaidClient";
import { encryptAccessToken, decryptAccessToken } from "./plaidCrypto";
import { createHash, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import { authorizeWrite } from "./authz";
import { CASH_ACCOUNT_BANKING_ERROR, isCashAccountType } from "./accountCapabilities";

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

type PlaidItemFreshness = {
  lastSuccessfulUpdateAt: string | null;
  lastFailedUpdateAt: string | null;
  transactionsRefreshProductActive: boolean | null;
  lookupErrorCode: string | null;
};

function plaidTimestamp(value: any) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function getPlaidItemFreshness(plaid: any, accessToken: string): Promise<PlaidItemFreshness> {
  if (typeof plaid?.itemGet !== "function") {
    return {
      lastSuccessfulUpdateAt: null,
      lastFailedUpdateAt: null,
      transactionsRefreshProductActive: null,
      lookupErrorCode: null,
    };
  }

  try {
    const response = await plaid.itemGet({ access_token: accessToken });
    const item = response?.data?.item ?? {};
    const transactionStatus = response?.data?.status?.transactions ?? item?.status?.transactions ?? {};
    const productLists = [item?.products, item?.billed_products].filter(Array.isArray);
    const products = productLists.flat().map((value: any) => String(value ?? "").trim().toLowerCase());

    return {
      lastSuccessfulUpdateAt: plaidTimestamp(transactionStatus?.last_successful_update),
      lastFailedUpdateAt: plaidTimestamp(transactionStatus?.last_failed_update),
      transactionsRefreshProductActive: productLists.length > 0 ? products.includes("transactions_refresh") : null,
      lookupErrorCode: null,
    };
  } catch (error: any) {
    return {
      lastSuccessfulUpdateAt: null,
      lastFailedUpdateAt: null,
      transactionsRefreshProductActive: null,
      lookupErrorCode: plaidErrorCode(error),
    };
  }
}

function isTransactionsRefreshUnavailable(code: string | null | undefined) {
  const normalized = String(code ?? "").trim().toUpperCase();
  return normalized === "INVALID_PRODUCT" || normalized === "PRODUCT_NOT_ENABLED";
}

function plaidWebhookUrl() {
  const url = String(process.env.PLAID_WEBHOOK_URL ?? "").trim();
  return url || undefined;
}

type PlaidWebhookRepairResult = {
  configured: boolean;
  updated: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

async function ensurePlaidItemWebhook(plaid: any, accessToken: string): Promise<PlaidWebhookRepairResult> {
  const configuredWebhook = plaidWebhookUrl();
  if (!configuredWebhook) {
    return { configured: false, updated: false, errorCode: null, errorMessage: null };
  }

  try {
    const itemResponse = await plaid.itemGet({ access_token: accessToken });
    const currentWebhook = String(itemResponse?.data?.item?.webhook ?? "").trim();
    if (currentWebhook === configuredWebhook) {
      return { configured: true, updated: false, errorCode: null, errorMessage: null };
    }

    await plaid.itemWebhookUpdate({
      access_token: accessToken,
      webhook: configuredWebhook,
    });
    return { configured: true, updated: true, errorCode: null, errorMessage: null };
  } catch (error: any) {
    return {
      configured: true,
      updated: false,
      errorCode: plaidErrorCode(error),
      errorMessage: plaidErrorMessage(error),
    };
  }
}

function plaidLinkCustomizationName() {
  // Link tokens must name the exact published Dashboard customization. The
  // default fallback exists for local/dev/test only; production deployment
  // requires PLAID_LINK_CUSTOMIZATION_NAME through the SST stage config.
  const name = String(process.env.PLAID_LINK_CUSTOMIZATION_NAME ?? "default").trim();
  return name || "default";
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

  if (text.includes("PRODUCT_NOT_READY")) {
    return "Plaid is still preparing this bank's transaction data. No changes were applied; try Sync again shortly.";
  }

  if (text.includes("INSTITUTION_ERROR") || text.includes("INSTITUTION_NOT_RESPONDING")) {
    return "Your bank is temporarily unavailable through Plaid. No changes were applied; try Sync again shortly.";
  }

  if (text.includes("RATE_LIMIT") || text.includes("INTERNAL_SERVER_ERROR") || text.includes("API_ERROR")) {
    return "Plaid could not complete this check right now. No changes were applied; try Sync again shortly.";
  }

  if (text.includes("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")) {
    return "Plaid updated the transaction stream while this check was running. No changes were applied; try Sync again.";
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
  // v2 means the cursor came from Plaid's top-level account_id stream.
  // Older `account:` cursors were produced while account_id was incorrectly
  // nested under options and must be restarted once from null.
  return `account-v2:${plaidAccountId}:`;
}

const PLAID_REPLAY_IDENTITY_KEYS = new Set([
  "account_id",
  "transaction_id",
  "pending_transaction_id",
]);

function canonicalPlaidReplayValue(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalPlaidReplayValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PLAID_REPLAY_IDENTITY_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalPlaidReplayValue(nested)]),
  );
}

function plaidReplayFingerprint(value: any) {
  if (!value || typeof value !== "object") return null;
  return createHash("sha256")
    .update(JSON.stringify(canonicalPlaidReplayValue(value)))
    .digest("hex");
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

function isRetryablePlaidSyncFailure(error: any) {
  const text = `${plaidErrorCode(error)} ${plaidErrorMessage(error)}`.toUpperCase();
  return (
    text.includes("PRODUCT_NOT_READY") ||
    text.includes("INSTITUTION_ERROR") ||
    text.includes("INSTITUTION_NOT_RESPONDING") ||
    text.includes("RATE_LIMIT") ||
    text.includes("INTERNAL_SERVER_ERROR") ||
    text.includes("API_ERROR") ||
    text.includes("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")
  );
}

function isAccountScopedSyncUnavailable(error: any) {
  const code = plaidErrorCode(error).toUpperCase();
  const message = plaidErrorMessage(error).toUpperCase();
  return (
    code.includes("NO_ACCOUNTS") ||
    code.includes("INVALID_ACCOUNT") ||
    message.includes("NO ACCOUNTS") ||
    ((code.includes("INVALID_FIELD") || code.includes("INVALID_INPUT") || code.includes("UNKNOWN_FIELDS")) &&
      message.includes("ACCOUNT_ID"))
  );
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

function plaidCurrencyCode(account: any) {
  const value = account?.balances?.iso_currency_code ?? account?.balances?.unofficial_currency_code ?? null;
  return value ? String(value).trim().toUpperCase() : null;
}

function plaidAccountIdentityMismatch(params: {
  localAccount: any;
  existingConnection?: any;
  selectedPlaidAccount: any;
}) {
  const { localAccount, existingConnection, selectedPlaidAccount } = params;
  const localType = String(localAccount?.type ?? "").trim().toUpperCase();
  const selectedType = accountTypeFromPlaidValue({
    type: selectedPlaidAccount?.type,
    subtype: selectedPlaidAccount?.subtype,
  }, "OTHER");
  if (localType && localType !== "OTHER" && selectedType !== localType) {
    return `Plaid account type ${selectedType} does not match local account type ${localType}`;
  }

  const selectedCurrency = plaidCurrencyCode(selectedPlaidAccount);
  const expectedCurrency = String(
    existingConnection?.plaid_currency_code ?? localAccount?.currency_code ?? "",
  ).trim().toUpperCase();
  if (expectedCurrency && selectedCurrency && expectedCurrency !== selectedCurrency) {
    return `Plaid account currency ${selectedCurrency} does not match local account currency ${expectedCurrency}`;
  }

  const storedPlaidType = String(existingConnection?.plaid_type ?? "").trim().toLowerCase();
  const selectedPlaidType = String(selectedPlaidAccount?.type ?? "").trim().toLowerCase();
  if (storedPlaidType && selectedPlaidType && storedPlaidType !== selectedPlaidType) {
    return "Selected Plaid account product type does not match the original connection";
  }

  const changingPlaidAccount =
    existingConnection?.plaid_account_id &&
    String(existingConnection.plaid_account_id) !== String(selectedPlaidAccount?.account_id ?? "");
  const storedMask = String(existingConnection?.plaid_mask ?? "").trim();
  const selectedMask = String(selectedPlaidAccount?.mask ?? "").trim();
  if (changingPlaidAccount && storedMask && selectedMask && storedMask !== selectedMask) {
    return "Selected Plaid account mask does not match the original connection";
  }

  return null;
}

type ReusablePlaidSiblingMapping = {
  connection: any;
  plaidAccount: any;
};

async function findReusablePlaidSiblingMappings(params: {
  prisma: any;
  businessId: string;
  primaryAccountId: string;
  primaryPlaidAccountId: string;
  institutionId?: string | null;
  institutionName?: string | null;
  livePlaidAccounts: any[];
}) {
  const siblings = await params.prisma.bankConnection.findMany({
    where: {
      business_id: params.businessId,
      account_id: { not: params.primaryAccountId },
    },
    select: {
      account_id: true,
      plaid_item_id: true,
      plaid_account_id: true,
      plaid_mask: true,
      plaid_type: true,
      plaid_subtype: true,
      plaid_currency_code: true,
      institution_id: true,
      institution_name: true,
      effective_start_date: true,
      account: { select: { id: true, type: true, currency_code: true, name: true } },
    },
  });

  const expectedInstitutionId = String(params.institutionId ?? "").trim();
  const expectedInstitutionName = String(params.institutionName ?? "").trim().toLowerCase();
  const usedLocalAccountIds = new Set<string>();
  const reusable: ReusablePlaidSiblingMapping[] = [];

  for (const plaidAccount of params.livePlaidAccounts) {
    const liveId = String(plaidAccount?.account_id ?? "").trim();
    if (!liveId || liveId === params.primaryPlaidAccountId) continue;
    const liveMask = String(plaidAccount?.mask ?? "").trim();
    if (!liveMask) continue;

    const candidates = siblings.filter((connection: any) => {
      const localId = String(connection?.account_id ?? "").trim();
      if (!localId || usedLocalAccountIds.has(localId)) return false;
      if (String(connection?.plaid_mask ?? "").trim() !== liveMask) return false;

      const siblingInstitutionId = String(connection?.institution_id ?? "").trim();
      const siblingInstitutionName = String(connection?.institution_name ?? "").trim().toLowerCase();
      if (expectedInstitutionId && siblingInstitutionId && siblingInstitutionId !== expectedInstitutionId) return false;
      if (!expectedInstitutionId && expectedInstitutionName && siblingInstitutionName !== expectedInstitutionName) return false;

      return !plaidAccountIdentityMismatch({
        localAccount: connection?.account,
        existingConnection: connection,
        selectedPlaidAccount: plaidAccount,
      });
    });

    // Mask plus institution and account identity must resolve uniquely. Never
    // guess when two local accounts could represent the same live bank account.
    if (candidates.length !== 1) continue;
    usedLocalAccountIds.add(String(candidates[0].account_id));
    reusable.push({ connection: candidates[0], plaidAccount });
  }

  return reusable;
}

function repairedSiblingConnectionData(params: {
  itemId: string;
  accessTokenCiphertext: string;
  plaidAccount: any;
  institution?: { name?: string; institution_id?: string };
  fallbackInstitutionName?: string | null;
  fallbackInstitutionId?: string | null;
}) {
  const { plaidAccount } = params;
  return {
    plaid_item_id: params.itemId,
    plaid_account_id: String(plaidAccount.account_id),
    access_token_ciphertext: params.accessTokenCiphertext,
    plaid_mask: plaidAccount?.mask ? String(plaidAccount.mask) : null,
    plaid_type: plaidAccount?.type ? String(plaidAccount.type) : null,
    plaid_subtype: plaidAccount?.subtype ? String(plaidAccount.subtype) : null,
    plaid_currency_code: plaidCurrencyCode(plaidAccount),
    institution_name: params.institution?.name ?? params.fallbackInstitutionName ?? null,
    institution_id: params.institution?.institution_id ?? params.fallbackInstitutionId ?? null,
    status: "CONNECTED",
    error_code: null,
    error_message: null,
    sync_cursor: null,
    has_new_transactions: true,
    new_accounts_available: false,
    updated_at: new Date(),
  };
}

/**
 * Convert Plaid's product-facing current balance into Bynkbook's signed
 * accounting balance. Plaid reports credit balances as a positive amount
 * owed; Bynkbook represents liabilities as negative balances.
 */
export function normalizePlaidCurrentBalanceCents(current: unknown, accountType: unknown) {
  const numeric = Number(current);
  if (!Number.isFinite(numeric)) throw new Error("Invalid Plaid current balance");
  const cents = BigInt(Math.round(numeric * 100));
  return String(accountType ?? "").trim().toUpperCase() === "CREDIT_CARD" ? -cents : cents;
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

async function activeMatchedBankTransactionIdsForPlaidSync(
  prisma: any,
  businessId: string,
  accountId: string,
) {
  const [groupBanks, legacyMatches] = await Promise.all([
    prisma.matchGroupBank.findMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        matchGroup: { status: "ACTIVE" },
      },
      select: { bank_transaction_id: true },
    }),
    prisma.bankMatch.findMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        voided_at: null,
      },
      select: { bank_transaction_id: true },
    }),
  ]);

  return Array.from(new Set(
    [...groupBanks, ...legacyMatches]
      .map((row: any) => String(row?.bank_transaction_id ?? "").trim())
      .filter(Boolean),
  ));
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
      updated_at: new Date(),
    },
  });

  return { code, message, status, reconnectRequired };
}

type PlaidWebhookRequest = {
  body: any;
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  enqueueSync?: (target: { businessId: string; accountId: string; itemId: string }) => Promise<void>;
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

export type PlaidCapability = "MANAGE" | "SYNC";

export async function requirePlaidCapability(
  prisma: any,
  businessId: string,
  userId: string,
  capability: PlaidCapability,
) {
  const role = String(await requireMembership(prisma, businessId, userId) ?? "").trim().toUpperCase();
  if (!role) return null;
  const roleAllowed = capability === "MANAGE"
    ? role === "OWNER" || role === "ADMIN"
    : ["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"].includes(role);
  if (!roleAllowed) return null;

  const actionKey = capability === "MANAGE" ? "bank_connections.manage" : "bank_connections.sync";
  const az = await authorizeWrite(prisma, {
    businessId,
    actorUserId: userId,
    actorRole: role,
    actionKey,
    requiredLevel: "FULL",
    endpointForLog: `PLAID_${capability}`,
  });
  return az.allowed ? role : null;
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
  const role = await requirePlaidCapability(prisma, businessId, userId, "MANAGE");
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const plaid = await getPlaidClient();

  const res = await plaid.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "BynkBook",
    link_customization_name: plaidLinkCustomizationName(),
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
  sourceAccountId?: string;
  listOptions?: boolean;
}) {
  const { businessId, accountId, userId, mode = "connect", sourceAccountId, listOptions = false } = params;

  const prisma = await getPrisma();
  const role = await requirePlaidCapability(prisma, businessId, userId, "MANAGE");
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const localAccount = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true, name: true, type: true, currency_code: true, institution_name: true, last4: true },
  });
  if (!localAccount) return json(404, { ok: false, error: "Account not found in business" });
  if (isCashAccountType(localAccount.type)) {
    return json(409, { ok: false, ...CASH_ACCOUNT_BANKING_ERROR });
  }

  const plaid = await getPlaidClient();

  if (mode === "connect" && listOptions) {
    const reusableConnections = await prisma.bankConnection.findMany({
      where: { business_id: businessId, status: "CONNECTED" },
      include: { account: { select: { id: true, name: true } } },
      orderBy: [{ updated_at: "desc" }],
    });
    const seenItems = new Set<string>();
    const options = reusableConnections
      .filter((connection: any) => {
        const itemId = String(connection?.plaid_item_id ?? "").trim();
        if (!itemId || seenItems.has(itemId)) return false;
        seenItems.add(itemId);
        return true;
      })
      .map((connection: any) => ({
        sourceAccountId: String(connection.account_id),
        institutionName: connection.institution_name ?? "Connected bank",
        accountName: connection.account?.name ?? null,
        last4: connection.plaid_mask ?? null,
      }));
    return json(200, { ok: true, mode: "connect", options });
  }

  if (mode === "connect" && sourceAccountId) {
    const sourceConnection = await prisma.bankConnection.findFirst({
      where: { business_id: businessId, account_id: sourceAccountId },
      include: { account: { select: { id: true, name: true } } },
    });
    if (!sourceConnection) {
      return json(400, { ok: false, error: "Existing Plaid connection was not found" });
    }

    const sourceAccessToken = await decryptAccessToken(sourceConnection.access_token_ciphertext);
    let sourceAccounts: any[] = [];
    try {
      const sourceAccountsRes = await plaid.accountsGet({ access_token: sourceAccessToken });
      sourceAccounts = Array.isArray(sourceAccountsRes?.data?.accounts) ? sourceAccountsRes.data.accounts : [];
    } catch {
      return json(409, {
        ok: false,
        error: "The selected shared bank login needs to be reconnected before another account can be added",
        code: "PLAID_SHARED_ITEM_UNAVAILABLE",
      });
    }
    if (!sourceAccounts.some(
      (account: any) => String(account?.account_id ?? "") === String(sourceConnection.plaid_account_id ?? ""),
    )) {
      return json(409, {
        ok: false,
        error: "The selected shared bank login is not currently exposing its mapped account",
        code: "PLAID_SHARED_ITEM_UNAVAILABLE",
      });
    }

    const itemConnections = await prisma.bankConnection.findMany({
      where: { business_id: businessId, plaid_item_id: sourceConnection.plaid_item_id },
      include: { account: { select: { id: true, name: true } } },
    });
    const requiredPreservedAccounts = itemConnections
      .filter((connection: any) => sourceAccounts.some((account: any) =>
        String(account?.account_id ?? "") === String(connection.plaid_account_id ?? ""),
      ))
      .map((connection: any) => {
        const live = sourceAccounts.find((account: any) =>
          String(account?.account_id ?? "") === String(connection.plaid_account_id ?? ""),
        );
        return {
          accountId: String(connection.account_id),
          plaidAccountId: String(connection.plaid_account_id),
          mask: live?.mask ?? connection.plaid_mask ?? null,
          plaidType: live?.type ?? connection.plaid_type ?? null,
          plaidSubtype: live?.subtype ?? connection.plaid_subtype ?? null,
          name: connection.account?.name ?? null,
        };
      });

    const res = await plaid.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: "BynkBook",
      link_customization_name: plaidLinkCustomizationName(),
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: plaidWebhookUrl(),
      access_token: sourceAccessToken,
      update: { account_selection_enabled: true },
    });
    return json(200, {
      ok: true,
      link_token: res.data.link_token,
      mode: "update",
      attachToExistingItem: true,
      repairSourceAccountId: String(sourceConnection.account_id),
      usingSharedItem: true,
      institutionName: sourceConnection.institution_name ?? null,
      targetPlaidMask: localAccount.last4 ?? null,
      targetAccountName: localAccount.name ?? null,
      targetAccountType: localAccount.type ?? null,
      requiredPreservedAccounts,
      relatedInstitutionAccounts: itemConnections.map((connection: any) => ({
        accountId: String(connection.account_id),
        plaidAccountId: connection.plaid_account_id ? String(connection.plaid_account_id) : null,
        name: connection.account?.name ?? null,
        mask: connection.plaid_mask ?? null,
        plaidType: connection.plaid_type ?? null,
        plaidSubtype: connection.plaid_subtype ?? null,
      })),
    });
  }

  if (mode === "update") {
    const conn = await prisma.bankConnection.findFirst({
      where: { business_id: businessId, account_id: accountId },
    });
    if (!conn) return json(400, { ok: false, error: "No bank connection to reconnect" });

    const institutionId = String(conn.institution_id ?? "").trim();
    const institutionName = String(conn.institution_name ?? "").trim();
    const siblingConnections = institutionId || institutionName
      ? await prisma.bankConnection.findMany({
        where: {
          business_id: businessId,
          account_id: { not: accountId },
          ...(institutionId
            ? { institution_id: institutionId }
            : { institution_name: institutionName }),
        },
        include: { account: { select: { id: true, name: true } } },
      })
      : [];

    // A bank login is one Plaid Item that can expose several bank accounts.
    // If the target's old one-account Item is empty, continue the update on a
    // healthy sibling Item from the same institution. This prevents sequential
    // per-ledger reconnects from repeatedly invalidating the previous account.
    let updateConnection = conn;
    let updateAccessToken: string | null = null;
    let updateLiveAccounts: any[] = [];
    let updateConnectionMappingLive = false;
    for (const candidate of [conn, ...siblingConnections]) {
      try {
        const candidateAccessToken = await decryptAccessToken(candidate.access_token_ciphertext);
        const candidateAccountsRes = await plaid.accountsGet({ access_token: candidateAccessToken });
        const candidateAccounts = Array.isArray(candidateAccountsRes?.data?.accounts)
          ? candidateAccountsRes.data.accounts
          : [];
        const mappedAccountIsLive = candidateAccounts.some(
          (account: any) => String(account?.account_id ?? "") === String(candidate.plaid_account_id ?? ""),
        );
        const targetMask = String(conn.plaid_mask ?? "").trim();
        const targetAccountIsLive = !!targetMask && candidateAccounts.some(
          (account: any) => String(account?.mask ?? "").trim() === targetMask,
        );
        if (!mappedAccountIsLive && !targetAccountIsLive) continue;
        updateConnection = candidate;
        updateAccessToken = candidateAccessToken;
        updateLiveAccounts = candidateAccounts;
        updateConnectionMappingLive = mappedAccountIsLive;
        break;
      } catch {
        // An unhealthy target may throw before Link update mode repairs it.
        // Continue looking for a healthy same-institution sibling Item.
      }
    }

    if (!updateAccessToken) {
      updateConnection = conn;
      updateAccessToken = await decryptAccessToken(conn.access_token_ciphertext);
    }

    const res = await plaid.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: "BynkBook",
      link_customization_name: plaidLinkCustomizationName(),
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: plaidWebhookUrl(),
      access_token: updateAccessToken,
      update: { account_selection_enabled: true },
    });

    const usingSharedItem = String(updateConnection.account_id) !== String(accountId);
    const knownConnections = [
      { ...conn, account: { id: accountId, name: localAccount.name ?? null } },
      ...siblingConnections,
    ];
    const requiredPreservedAccounts = usingSharedItem
      ? knownConnections
        .filter((connection: any) => String(connection.plaid_item_id) === String(updateConnection.plaid_item_id))
        .filter((connection: any) => updateLiveAccounts.some((account: any) =>
          String(account?.account_id ?? "") === String(connection.plaid_account_id ?? ""),
        ))
        .map((connection: any) => {
          const live = updateLiveAccounts.find((account: any) =>
            String(account?.account_id ?? "") === String(connection.plaid_account_id ?? ""),
          );
          return {
            accountId: String(connection.account_id),
            plaidAccountId: String(connection.plaid_account_id),
            mask: live?.mask ?? connection.plaid_mask ?? null,
            plaidType: live?.type ?? connection.plaid_type ?? null,
            plaidSubtype: live?.subtype ?? connection.plaid_subtype ?? null,
            name: connection.account?.name ?? null,
          };
        })
      : updateConnectionMappingLive
        ? [{
          accountId,
          plaidAccountId: String(conn.plaid_account_id),
          mask: updateLiveAccounts.find((account: any) =>
            String(account?.account_id ?? "") === String(conn.plaid_account_id ?? ""),
          )?.mask ?? conn.plaid_mask ?? null,
          plaidType: updateLiveAccounts.find((account: any) =>
            String(account?.account_id ?? "") === String(conn.plaid_account_id ?? ""),
          )?.type ?? conn.plaid_type ?? null,
          plaidSubtype: updateLiveAccounts.find((account: any) =>
            String(account?.account_id ?? "") === String(conn.plaid_account_id ?? ""),
          )?.subtype ?? conn.plaid_subtype ?? null,
          name: localAccount.name ?? null,
        }]
        : [];
    const relatedInstitutionAccounts = knownConnections
      .filter((connection: any, index: number, all: any[]) =>
        all.findIndex((candidate: any) => String(candidate.account_id) === String(connection.account_id)) === index,
      )
      .map((connection: any) => ({
        accountId: String(connection.account_id),
        plaidAccountId: connection.plaid_account_id ? String(connection.plaid_account_id) : null,
        name: connection.account?.name ?? null,
        mask: connection.plaid_mask ?? null,
        plaidType: connection.plaid_type ?? null,
        plaidSubtype: connection.plaid_subtype ?? null,
      }));
    return json(200, {
      ok: true,
      link_token: res.data.link_token,
      mode: "update",
      repairSourceAccountId: String(updateConnection.account_id),
      usingSharedItem,
      institutionName: updateConnection.institution_name ?? conn.institution_name ?? null,
      targetPlaidMask: conn.plaid_mask ?? null,
      targetAccountName: localAccount.name ?? null,
      targetAccountType: localAccount.type ?? null,
      requiredPreservedAccounts,
      relatedInstitutionAccounts,
    });
  }

  const res = await plaid.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "BynkBook",
    link_customization_name: plaidLinkCustomizationName(),
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
    webhook: plaidWebhookUrl(),

    // Production-grade: request up to 24 months instead of Plaid's default (~90 days)
    transactions: { days_requested: 730 },
  });

  return json(200, {
    ok: true,
    link_token: res.data.link_token,
    targetPlaidMask: localAccount.last4 ?? null,
    targetAccountName: localAccount.name ?? null,
    targetAccountType: localAccount.type ?? null,
  });
}

type PlaidConnectionMode = "NEW_ACCOUNT" | "EXISTING_ACCOUNT";

function parseDateOnly(raw: string) {
  const start = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(start.getTime()) ? null : start;
}

async function derivePlaidEffectiveStartDate(
  prisma: any,
  businessId: string,
  accountId: string,
  provided?: string,
  mode: PlaidConnectionMode = "EXISTING_ACCOUNT",
) {
  const raw = String(provided ?? "").trim();
  if (mode === "NEW_ACCOUNT") {
    if (!raw) return null;
    return parseDateOnly(raw);
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

  const [account, earliestEntry] = await Promise.all([
    prisma.account.findFirst({
      where: { id: accountId, business_id: businessId },
      select: { opening_balance_date: true },
    }),
    prisma.entry.findFirst({
      where: {
        business_id: businessId,
        account_id: accountId,
        deleted_at: null,
      },
      select: { date: true },
      orderBy: [{ date: "asc" as any }, { created_at: "asc" as any }],
    }),
  ]);

  if (earliestEntry?.date && account?.opening_balance_date) {
    return earliestEntry.date < account.opening_balance_date ? earliestEntry.date : account.opening_balance_date;
  }
  if (earliestEntry?.date) return earliestEntry.date;
  if (account?.opening_balance_date) return account.opening_balance_date;
  if (raw) return parseDateOnly(raw);

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
  connectionMode?: PlaidConnectionMode;
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
    connectionMode = "EXISTING_ACCOUNT",
    additionalAccounts,
  } = params;

  const prisma = await getPrisma();
  const role = await requirePlaidCapability(prisma, businessId, userId, "MANAGE");
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const localAccount = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true, type: true, currency_code: true, last4: true },
  });
  if (!localAccount) return json(404, { ok: false, error: "Account not found in business" });
  if (isCashAccountType(localAccount.type)) {
    return json(409, { ok: false, ...CASH_ACCOUNT_BANKING_ERROR });
  }

  const start = await derivePlaidEffectiveStartDate(prisma, businessId, accountId, effectiveStartDate, connectionMode);
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

  const primaryIdentityMismatch = plaidAccountIdentityMismatch({
    localAccount,
    selectedPlaidAccount: verifiedAccount,
  });
  if (primaryIdentityMismatch) {
    await removePlaidItemBestEffort(plaid, accessToken);
    return json(409, {
      ok: false,
      error: primaryIdentityMismatch,
      code: "PLAID_ACCOUNT_IDENTITY_MISMATCH",
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

  const reusableSiblings = await findReusablePlaidSiblingMappings({
    prisma,
    businessId,
    primaryAccountId: accountId,
    primaryPlaidAccountId: plaidAccountId,
    institutionId: institution?.institution_id,
    institutionName: institution?.name,
    livePlaidAccounts: verifiedPlaidAccounts,
  });
  const reusableByPlaidId = new Map(
    reusableSiblings.map((row) => [String(row.plaidAccount.account_id), row]),
  );
  const selectedPlaidIds = Array.from(new Set([
    plaidAccountId,
    ...additional.map((row) => row.plaidAccountId),
    ...reusableSiblings.map((row) => String(row.plaidAccount.account_id)),
  ]));
  const duplicateConnections = await prisma.bankConnection.findMany({
    where: {
      business_id: businessId,
      plaid_account_id: { in: selectedPlaidIds } as any,
    },
    select: { account_id: true, plaid_account_id: true },
  });
  const expectedAccountByPlaidId = new Map<string, string>([[plaidAccountId, accountId]]);
  for (const row of reusableSiblings) {
    expectedAccountByPlaidId.set(String(row.plaidAccount.account_id), String(row.connection.account_id));
  }
  const conflictingConnection = duplicateConnections.find(
    (row: any) => {
      const expectedAccountId = expectedAccountByPlaidId.get(String(row.plaid_account_id));
      return !expectedAccountId || String(row.account_id) !== expectedAccountId;
    },
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

  // Build all writes before executing them so a multi-account connection is
  // committed atomically instead of one sibling at a time.
  const databaseWrites: any[] = [];
  databaseWrites.push(prisma.bankConnection.upsert({
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
      plaid_type: verifiedAccount?.type ? String(verifiedAccount.type) : null,
      plaid_subtype: verifiedAccount?.subtype ? String(verifiedAccount.subtype) : null,
      plaid_currency_code: plaidCurrencyCode(verifiedAccount),
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
      plaid_type: verifiedAccount?.type ? String(verifiedAccount.type) : null,
      plaid_subtype: verifiedAccount?.subtype ? String(verifiedAccount.subtype) : null,
      plaid_currency_code: plaidCurrencyCode(verifiedAccount),
      status: "CONNECTED",
      sync_cursor: null,
      error_code: null,
      error_message: null,
      has_new_transactions: false,
      opening_policy: openingPolicy,
      opening_adjustment_created_at: openingAdjustmentCreatedAt,
      updated_at: new Date(),
    },
  }));

  const repairedExistingAccounts: any[] = [];
  for (const reusable of reusableSiblings) {
    const livePlaidAccountId = String(reusable.plaidAccount.account_id);
    databaseWrites.push(prisma.bankConnection.updateMany({
      where: {
        business_id: businessId,
        account_id: reusable.connection.account_id,
        plaid_account_id: reusable.connection.plaid_account_id,
      },
      data: repairedSiblingConnectionData({
        itemId,
        accessTokenCiphertext: ciphertext,
        plaidAccount: reusable.plaidAccount,
        institution,
        fallbackInstitutionName: reusable.connection.institution_name,
        fallbackInstitutionId: reusable.connection.institution_id,
      }),
    }));
    repairedExistingAccounts.push({
      accountId: reusable.connection.account_id,
      accountName: reusable.connection.account?.name ?? null,
      plaidAccountId: livePlaidAccountId,
      last4: reusable.plaidAccount?.mask ? String(reusable.plaidAccount.mask) : null,
    });
  }

  const createdAdditionalAccounts: any[] = [];
  for (const row of additional) {
    if (reusableByPlaidId.has(row.plaidAccountId)) continue;
    const verified = verifiedByPlaidId.get(row.plaidAccountId) as any;
    const extraStart = await derivePlaidEffectiveStartDate(
      prisma,
      businessId,
      accountId,
      row.effectiveStartDate ?? effectiveStartDate,
      "NEW_ACCOUNT",
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

    databaseWrites.push(
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
          currency_code: plaidCurrencyCode(verified),
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
          plaid_type: verified?.type ? String(verified.type) : null,
          plaid_subtype: verified?.subtype ? String(verified.subtype) : null,
          plaid_currency_code: plaidCurrencyCode(verified),
          status: "CONNECTED",
          sync_cursor: null,
          has_new_transactions: false,
          opening_policy: "AUTO",
          opening_adjustment_created_at: null,
        } as any,
      }),
    );

    createdAdditionalAccounts.push({
      accountId: extraAccountId,
      plaidAccountId: row.plaidAccountId,
      name: row.name,
      type: extraType,
      last4: extraMask,
      effectiveStartDate: extraStart.toISOString().slice(0, 10),
    });
  }

  try {
    await prisma.$transaction(databaseWrites);
  } catch (error) {
    await removePlaidItemBestEffort(plaid, accessToken);
    throw error;
  }

  return json(200, {
    ok: true,
    connected: true,
    effectiveStartDate: start.toISOString().slice(0, 10),
    repairedExistingAccounts,
    additionalAccounts: createdAdditionalAccounts,
  });
}

export async function getStatus(params: { businessId: string; accountId: string; userId: string }) {
  const { businessId, accountId, userId } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const localAccount = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true, type: true, currency_code: true, last4: true },
  });
  if (!localAccount) return json(404, { ok: false, error: "Account not found in business" });
  if (isCashAccountType(localAccount.type)) {
    return json(200, {
      ok: true,
      connected: false,
      status: "NOT_APPLICABLE",
      needsAttention: false,
      errorMessage: null,
      institutionName: null,
      last4: null,
      lastSyncAt: null,
      hasNewTransactions: false,
      newAccountsAvailable: false,
      effectiveStartDate: null,
      lastKnownBalanceCents: null,
      lastKnownBalanceAt: null,
      plaidLastSuccessfulUpdateAt: null,
      plaidLastFailedUpdateAt: null,
      transactionsRefreshProductActive: false,
      error: null,
      bankingApplicable: false,
    });
  }

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
      newAccountsAvailable: false,
      effectiveStartDate: null,
      lastKnownBalanceCents: null,
      lastKnownBalanceAt: null,
      plaidLastSuccessfulUpdateAt: null,
      plaidLastFailedUpdateAt: null,
      transactionsRefreshProductActive: null,
      error: null,
    });
    
  // TS guard: keep a non-null reference for the rest of this function (incl. nested helpers).
  // Status is the app's active Plaid health probe: the local DB row is not enough
  // to prove the selected Plaid account still exists on the Item.
  const connRow = conn;
  let plaidAccountLive: boolean | null = null;
  let plaidHealthErrorCode: string | null = null;
  let plaidHealthErrorMessage: string | null = null;
  let plaidItemFreshness: PlaidItemFreshness = {
    lastSuccessfulUpdateAt: null,
    lastFailedUpdateAt: null,
    transactionsRefreshProductActive: null,
    lookupErrorCode: null,
  };
  let webhookRepair: PlaidWebhookRepairResult = {
    configured: Boolean(plaidWebhookUrl()),
    updated: false,
    errorCode: null,
    errorMessage: null,
  };

  try {
    const plaid = await getPlaidClient();
    const accessToken = await decryptAccessToken(connRow.access_token_ciphertext);
    webhookRepair = await ensurePlaidItemWebhook(plaid, accessToken);
    const accountsRes = await plaid.accountsGet({ access_token: accessToken });
    const accounts = Array.isArray(accountsRes?.data?.accounts) ? accountsRes.data.accounts : [];
    const acct = accounts.find((a) => a.account_id === connRow.plaid_account_id);
    plaidItemFreshness = await getPlaidItemFreshness(plaid, accessToken);

    if (acct) {
      plaidAccountLive = true;
      const mask = acct?.mask ? String(acct.mask) : null;
      const staleReconnectState = isReconnectRequiredStatus(connRow.status);
      if ((mask && mask !== connRow.plaid_mask) || staleReconnectState) {
        await prisma.bankConnection.updateMany({
          where: { business_id: businessId, account_id: accountId },
          data: {
            ...(mask ? { plaid_mask: mask } : {}),
            ...(staleReconnectState
              ? { status: "CONNECTED", error_code: null, error_message: null }
              : {}),
            updated_at: new Date(),
          },
        });
        if (mask) (connRow as any).plaid_mask = mask;
        if (staleReconnectState) {
          (connRow as any).status = "CONNECTED";
          (connRow as any).error_code = null;
          (connRow as any).error_message = null;
        }
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
    newAccountsAvailable: !!(connRow as any).new_accounts_available,
    effectiveStartDate: connRow.effective_start_date.toISOString().slice(0, 10),
    lastKnownBalanceCents: connRow.last_known_balance_cents?.toString?.() ?? null,
    lastKnownBalanceAt: connRow.last_known_balance_at ? connRow.last_known_balance_at.toISOString() : null,
    plaidLastSuccessfulUpdateAt: plaidItemFreshness.lastSuccessfulUpdateAt,
    plaidLastFailedUpdateAt: plaidItemFreshness.lastFailedUpdateAt,
    transactionsRefreshProductActive: plaidItemFreshness.transactionsRefreshProductActive,
    plaidFreshnessErrorCode: plaidItemFreshness.lookupErrorCode,
    webhookConfigured: webhookRepair.configured,
    webhookUpdated: webhookRepair.updated,
    webhookErrorCode: webhookRepair.errorCode,
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
  sourceAccountId?: string;
  institution?: { name?: string; institution_id?: string };
  mask?: string;
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
    plaidAccountId,
    sourceAccountId,
    institution,
    mask,
    additionalAccounts,
  } = params;

  const prisma = await getPrisma();
  const role = await requirePlaidCapability(prisma, businessId, userId, "MANAGE");
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const localAccount = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true, type: true, currency_code: true, last4: true },
  });
  if (!localAccount) return json(404, { ok: false, error: "Account not found in business" });
  if (isCashAccountType(localAccount.type)) {
    return json(409, { ok: false, ...CASH_ACCOUNT_BANKING_ERROR });
  }

  const conn = await prisma.bankConnection.findFirst({
    where: { business_id: businessId, account_id: accountId },
  });

  const normalizedSourceAccountId = String(sourceAccountId ?? accountId).trim() || accountId;
  if (!conn && normalizedSourceAccountId === accountId) {
    return json(400, { ok: false, error: "No bank connection to repair" });
  }
  const sourceConn = normalizedSourceAccountId === accountId
    ? conn
    : await prisma.bankConnection.findFirst({
      where: { business_id: businessId, account_id: normalizedSourceAccountId },
    });
  if (!sourceConn) {
    return json(400, { ok: false, error: "Shared Plaid connection source was not found" });
  }

  if (conn && normalizedSourceAccountId !== accountId) {
    const targetInstitutionId = String(conn.institution_id ?? "").trim();
    const sourceInstitutionId = String(sourceConn.institution_id ?? "").trim();
    const targetInstitutionName = String(conn.institution_name ?? "").trim().toLowerCase();
    const sourceInstitutionName = String(sourceConn.institution_name ?? "").trim().toLowerCase();
    const institutionMismatch = targetInstitutionId && sourceInstitutionId
      ? targetInstitutionId !== sourceInstitutionId
      : !targetInstitutionName || targetInstitutionName !== sourceInstitutionName;
    if (institutionMismatch) {
      return json(409, {
        ok: false,
        error: "Shared Plaid connection belongs to a different institution",
        code: "PLAID_INSTITUTION_MISMATCH",
      });
    }
  }

  const selectedPlaidAccountId = String(plaidAccountId ?? "").trim();
  if (!selectedPlaidAccountId) return json(400, { ok: false, error: "Missing plaidAccountId" });

  const plaid = await getPlaidClient();
  const accessToken = await decryptAccessToken(sourceConn.access_token_ciphertext);
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

  const identityMismatch = plaidAccountIdentityMismatch({
    localAccount,
    existingConnection: conn ?? (localAccount.last4 ? { plaid_mask: localAccount.last4 } : null),
    selectedPlaidAccount: selected,
  });
  if (identityMismatch) {
    return json(409, {
      ok: false,
      error: identityMismatch,
      code: "PLAID_ACCOUNT_IDENTITY_MISMATCH",
    });
  }

  const requestedAdditional = normalizeAdditionalPlaidAccounts(additionalAccounts ?? [])
    .filter((row) => row.plaidAccountId !== selectedPlaidAccountId);
  const liveByPlaidId = new Map(
    accounts.map((account: any) => [String(account?.account_id ?? ""), account]),
  );
  const invalidAdditional = requestedAdditional.find((row) => !liveByPlaidId.has(row.plaidAccountId));
  if (invalidAdditional) {
    return json(400, {
      ok: false,
      error: "One or more selected Plaid accounts were not found on the repaired Item",
      code: "PLAID_ACCOUNT_SELECTION_MISMATCH",
    });
  }

  const reusableSiblings = await findReusablePlaidSiblingMappings({
    prisma,
    businessId,
    primaryAccountId: accountId,
    primaryPlaidAccountId: selectedPlaidAccountId,
    institutionId: institution?.institution_id ?? sourceConn.institution_id ?? conn?.institution_id,
    institutionName: institution?.name ?? sourceConn.institution_name ?? conn?.institution_name,
    livePlaidAccounts: accounts,
  });
  const reusableByPlaidId = new Map(
    reusableSiblings.map((row) => [String(row.plaidAccount.account_id), row]),
  );
  const selectedPlaidIds = Array.from(new Set([
    selectedPlaidAccountId,
    ...requestedAdditional.map((row) => row.plaidAccountId),
    ...reusableSiblings.map((row) => String(row.plaidAccount.account_id)),
  ]));
  const existingMappings = await prisma.bankConnection.findMany({
    where: {
      business_id: businessId,
      plaid_account_id: { in: selectedPlaidIds } as any,
    },
    select: { account_id: true, plaid_account_id: true },
  });
  const expectedAccountByPlaidId = new Map<string, string>([[selectedPlaidAccountId, accountId]]);
  for (const row of reusableSiblings) {
    expectedAccountByPlaidId.set(String(row.plaidAccount.account_id), String(row.connection.account_id));
  }
  const mappingConflict = existingMappings.find((row: any) => {
    const expectedAccountId = expectedAccountByPlaidId.get(String(row.plaid_account_id));
    return !expectedAccountId || String(row.account_id) !== expectedAccountId;
  });
  if (mappingConflict) {
    return json(409, {
      ok: false,
      error: "Selected Plaid account is already connected to another BynkBook account",
      code: "PLAID_ACCOUNT_ALREADY_CONNECTED",
    });
  }
  const alreadyMappedPlaidIds = new Set(existingMappings.map((row: any) => String(row.plaid_account_id)));
  const additionsToCreate = requestedAdditional.filter(
    (row) => !alreadyMappedPlaidIds.has(row.plaidAccountId) && !reusableByPlaidId.has(row.plaidAccountId),
  );

  const verifiedMask = selected?.mask ? String(selected.mask) : mask ?? null;
  const repairedStart = await derivePlaidEffectiveStartDate(prisma, businessId, accountId, undefined, "EXISTING_ACCOUNT");
  const databaseWrites: any[] = [];
  const primaryConnectionData = {
    plaid_item_id: sourceConn.plaid_item_id,
    plaid_account_id: selectedPlaidAccountId,
    access_token_ciphertext: sourceConn.access_token_ciphertext,
    plaid_mask: verifiedMask,
    plaid_type: selected?.type ? String(selected.type) : conn?.plaid_type ?? null,
    plaid_subtype: selected?.subtype ? String(selected.subtype) : conn?.plaid_subtype ?? null,
    plaid_currency_code: plaidCurrencyCode(selected) ?? conn?.plaid_currency_code ?? null,
    ...(repairedStart ? { effective_start_date: repairedStart } : {}),
    institution_name: institution?.name ?? sourceConn.institution_name ?? conn?.institution_name ?? null,
    institution_id: institution?.institution_id ?? sourceConn.institution_id ?? conn?.institution_id ?? null,
    status: "CONNECTED",
    error_code: null,
    error_message: null,
    sync_cursor: null,
    has_new_transactions: true,
    new_accounts_available: false,
    updated_at: new Date(),
  };
  databaseWrites.push(conn
    ? prisma.bankConnection.updateMany({
      where: { business_id: businessId, account_id: accountId },
      data: primaryConnectionData,
    })
    : prisma.bankConnection.create({
      data: {
        business_id: businessId,
        account_id: accountId,
        ...primaryConnectionData,
        effective_start_date: repairedStart ?? new Date(),
        opening_policy: "MANUAL",
        opening_adjustment_created_at: new Date(),
      } as any,
    }));

  // One Plaid Item can contain several separately mapped BynkBook accounts.
  // A successful update-mode reconnect repairs the Item, so clear stale flags
  // for exact mappings already on it. Separately connected Items from the same
  // bank login are consolidated below only when institution, mask, type, and
  // currency uniquely identify a live account on this repaired Item.
  const livePlaidAccountIds = accounts
    .map((account: any) => String(account?.account_id ?? "").trim())
    .filter(Boolean);
  databaseWrites.push(prisma.bankConnection.updateMany({
    where: {
      business_id: businessId,
      plaid_item_id: sourceConn.plaid_item_id,
      plaid_account_id: { in: livePlaidAccountIds } as any,
    },
    data: {
      status: "CONNECTED",
      error_code: null,
      error_message: null,
      has_new_transactions: true,
      new_accounts_available: false,
      updated_at: new Date(),
    },
  }));

  const repairedExistingAccounts: any[] = [];
  for (const reusable of reusableSiblings) {
    databaseWrites.push(prisma.bankConnection.updateMany({
      where: {
        business_id: businessId,
        account_id: reusable.connection.account_id,
        plaid_account_id: reusable.connection.plaid_account_id,
      },
      data: repairedSiblingConnectionData({
        itemId: sourceConn.plaid_item_id,
        accessTokenCiphertext: sourceConn.access_token_ciphertext,
        plaidAccount: reusable.plaidAccount,
        institution,
        fallbackInstitutionName: sourceConn.institution_name ?? conn?.institution_name,
        fallbackInstitutionId: sourceConn.institution_id ?? conn?.institution_id,
      }),
    }));
    repairedExistingAccounts.push({
      accountId: reusable.connection.account_id,
      accountName: reusable.connection.account?.name ?? null,
      plaidAccountId: String(reusable.plaidAccount.account_id),
      last4: reusable.plaidAccount?.mask ? String(reusable.plaidAccount.mask) : null,
    });
  }

  const createdAdditionalAccounts: any[] = [];
  for (const row of additionsToCreate) {
    const verified = liveByPlaidId.get(row.plaidAccountId) as any;
    const extraStart = await derivePlaidEffectiveStartDate(
      prisma,
      businessId,
      accountId,
      row.effectiveStartDate,
      "NEW_ACCOUNT",
    );
    if (!extraStart) {
      return json(400, { ok: false, error: "Invalid effectiveStartDate for an additional account" });
    }
    const extraAccountId = (await import("node:crypto")).randomUUID();
    const extraMask = verified?.mask ? String(verified.mask) : row.mask ?? null;
    const extraType = accountTypeFromPlaidValue(
      { type: verified?.type ?? row.type, subtype: verified?.subtype ?? row.subtype },
      row.type || "CHECKING",
    );
    databaseWrites.push(
      prisma.account.create({
        data: {
          id: extraAccountId,
          business_id: businessId,
          name: row.name,
          type: extraType,
          opening_balance_cents: 0n,
          opening_balance_date: extraStart,
          institution_name: institution?.name ?? sourceConn.institution_name ?? conn?.institution_name ?? null,
          last4: extraMask,
          currency_code: plaidCurrencyCode(verified),
        } as any,
      }),
      prisma.bankConnection.create({
        data: {
          business_id: businessId,
          account_id: extraAccountId,
          plaid_item_id: sourceConn.plaid_item_id,
          plaid_account_id: row.plaidAccountId,
          access_token_ciphertext: sourceConn.access_token_ciphertext,
          effective_start_date: extraStart,
          institution_name: institution?.name ?? sourceConn.institution_name ?? conn?.institution_name ?? null,
          institution_id: institution?.institution_id ?? sourceConn.institution_id ?? conn?.institution_id ?? null,
          plaid_mask: extraMask,
          plaid_type: verified?.type ? String(verified.type) : null,
          plaid_subtype: verified?.subtype ? String(verified.subtype) : null,
          plaid_currency_code: plaidCurrencyCode(verified),
          status: "CONNECTED",
          sync_cursor: null,
          has_new_transactions: true,
          new_accounts_available: false,
          opening_policy: "AUTO",
          opening_adjustment_created_at: null,
        } as any,
      }),
    );
    createdAdditionalAccounts.push({
      accountId: extraAccountId,
      plaidAccountId: row.plaidAccountId,
      name: row.name,
      type: extraType,
      last4: extraMask,
      effectiveStartDate: extraStart.toISOString().slice(0, 10),
    });
  }

  const writeResults = await prisma.$transaction(databaseWrites);
  const restored = writeResults[1] ?? { count: 0 };

  return json(200, {
    ok: true,
    connected: true,
    plaidAccountId: selectedPlaidAccountId,
    effectiveStartDate: repairedStart ? repairedStart.toISOString().slice(0, 10) : null,
    last4: verifiedMask,
    institutionName: institution?.name ?? sourceConn.institution_name ?? conn?.institution_name ?? null,
    restoredConnectionCount: Number(restored?.count ?? 0),
    repairedExistingAccounts,
    additionalAccounts: createdAdditionalAccounts,
  });
}

export async function disconnectBankConnection(params: { businessId: string; accountId: string; userId: string }) {
  const { businessId, accountId, userId } = params;

  const prisma = await getPrisma();
  const role = await requirePlaidCapability(prisma, businessId, userId, "MANAGE");
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  try {
    const result = await removeBankConnectionWithItemLifecycle(prisma, businessId, accountId);
    return json(200, { ok: true, disconnected: true, ...result });
  } catch (error: any) {
    return json(502, {
      ok: false,
      error: "Plaid could not confirm the disconnect; the local connection was preserved",
      detail: plaidErrorMessage(error),
    });
  }
}

export async function removeBankConnectionWithItemLifecycle(
  prisma: any,
  businessId: string,
  accountId: string,
) {
  return prisma.$transaction(async (tx: any) => {
    let conn = await tx.bankConnection.findFirst({
      where: { business_id: businessId, account_id: accountId },
    });
    if (!conn) return { itemRemoved: false, remainingItemConnections: 0 };

    // Serialize lifecycle changes for every local mapping that shares an Item.
    if (typeof tx.$queryRawUnsafe === "function") {
      await tx.$queryRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        `plaid-item:${businessId}:${conn.plaid_item_id}`,
      );
      conn = await tx.bankConnection.findFirst({
        where: { business_id: businessId, account_id: accountId },
      });
      if (!conn) return { itemRemoved: false, remainingItemConnections: 0 };
    }

    const itemConnections = await tx.bankConnection.count({
      where: { business_id: businessId, plaid_item_id: conn.plaid_item_id },
    });
    const removingFinalMapping = itemConnections <= 1;

    if (removingFinalMapping) {
      const plaid = await getPlaidClient();
      const accessToken = await decryptAccessToken(conn.access_token_ciphertext);
      // This is deliberately not best-effort: retain the local encrypted token
      // and mapping if Plaid does not confirm revocation, so the operation can
      // be retried and consent state never becomes unmanageable.
      await plaid.itemRemove({ access_token: accessToken });
    }

    await tx.bankConnection.deleteMany({
      where: { business_id: businessId, account_id: accountId },
    });

    return {
      itemRemoved: removingFinalMapping,
      remainingItemConnections: Math.max(0, itemConnections - 1),
    };
  }, { timeout: 15_000 });
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
  system?: boolean;
}) {
  const { businessId, accountId, userId, requestRefresh, afterReconnect, system = false } = params;

  const prisma = await getPrisma();
  if (!system) {
    const role = await requirePlaidCapability(prisma, businessId, userId, requestRefresh ? "MANAGE" : "SYNC");
    if (!role) return json(403, { ok: false, error: "Forbidden" });
  }

  const localAccount = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true, type: true },
  });
  if (!localAccount) return json(404, { ok: false, error: "Account not found in business" });
  if (isCashAccountType(localAccount.type)) {
    return json(409, { ok: false, ...CASH_ACCOUNT_BANKING_ERROR });
  }

  const conn = await prisma.bankConnection.findFirst({
    where: { business_id: businessId, account_id: accountId },
  });
  if (!conn) return json(400, { ok: false, error: "No bank connection for this account" });

  const syncLeaseToken = (await import("node:crypto")).randomUUID();
  const syncLeaseExpiresAt = new Date(Date.now() + 6 * 60_000);
  const lease = await prisma.bankConnection.updateMany({
    where: {
      business_id: businessId,
      account_id: accountId,
      OR: [
        { sync_lock_token: null },
        { sync_lock_expires_at: null },
        { sync_lock_expires_at: { lt: new Date() } },
      ],
    },
    data: {
      sync_lock_token: syncLeaseToken,
      sync_lock_expires_at: syncLeaseExpiresAt,
      updated_at: new Date(),
    },
  });
  if (Number(lease?.count ?? 0) !== 1) {
    return json(202, {
      ok: true,
      syncInProgress: true,
      message: "A bank sync is already running for this account.",
    });
  }

  const recordSyncFailure = async (error: any) => {
    const code = plaidErrorCode(error);
    const message = plaidErrorMessage(error);
    const classifiedStatus = reconnectStatusForPlaidFailure(code, message);
    const reconnectRequired = isReconnectRequiredStatus(classifiedStatus);
    const lastSuccessfulSyncAt = conn.last_sync_at ? new Date(conn.last_sync_at) : null;
    const recentlySynced =
      lastSuccessfulSyncAt != null &&
      !Number.isNaN(lastSuccessfulSyncAt.getTime()) &&
      Date.now() - lastSuccessfulSyncAt.getTime() <= 60_000;

    console.error("Plaid transaction sync failed", {
      businessId,
      accountId,
      errorCode: code,
      errorMessage: message,
      reconnectRequired,
      recentlySynced,
      updatesPending: Boolean(conn.has_new_transactions),
    });

    if (
      !afterReconnect &&
      !reconnectRequired &&
      isRetryablePlaidSyncFailure(error) &&
      recentlySynced &&
      conn.status === "CONNECTED" &&
      !conn.has_new_transactions
    ) {
      return json(200, {
        ok: true,
        syncDeferred: true,
        newCount: 0,
        upgradedCount: 0,
        duplicateCount: 0,
        pendingCount: 0,
        lastSyncAt: lastSuccessfulSyncAt?.toISOString() ?? null,
        message: "A bank sync completed moments ago. Plaid did not finish this repeated check, so no transaction changes were applied.",
      });
    }

    const recorded = await recordPlaidSyncFailure({ prisma, businessId, accountId, error });
    if (afterReconnect && canDeferPostReconnectSyncFailure(recorded.status, recorded.code)) {
      const now = new Date();
      await prisma.bankConnection.updateMany({
        where: { business_id: businessId, account_id: accountId },
        data: {
          status: "PENDING_SYNC",
          error_code: recorded.code,
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
      errorCode: recorded.code,
      status: recorded.status,
      message: plaidSyncFailureUserMessage(recorded.status, recorded.code),
      reconnectRequired: recorded.reconnectRequired,
      ...(recorded.reconnectRequired ? {} : { updatesPending: Boolean(conn.has_new_transactions) }),
    });
  };

  try {
    const plaid = await getPlaidClient();
    const accessToken = await decryptAccessToken(conn.access_token_ciphertext);
    const webhookRepair = await ensurePlaidItemWebhook(plaid, accessToken);
    if (webhookRepair.errorCode) {
      console.warn("Plaid Item webhook repair skipped during transaction sync", {
        businessId,
        accountId,
        errorCode: webhookRepair.errorCode,
        errorMessage: webhookRepair.errorMessage,
      });
    }
    let refreshRequested = false;
    let refreshSucceeded = false;
    let refreshErrorCode: string | null = null;
    let refreshErrorMessage: string | null = null;
    let plaidItemFreshness: PlaidItemFreshness = {
      lastSuccessfulUpdateAt: null,
      lastFailedUpdateAt: null,
      transactionsRefreshProductActive: null,
      lookupErrorCode: null,
    };

    if (requestRefresh) {
      refreshRequested = true;
      try {
        await plaid.transactionsRefresh({ access_token: accessToken });
        refreshSucceeded = true;
      } catch (refreshError: any) {
        refreshErrorCode = plaidErrorCode(refreshError);
        refreshErrorMessage = plaidErrorMessage(refreshError);
      }

      plaidItemFreshness = await getPlaidItemFreshness(plaid, accessToken);
      if (isTransactionsRefreshUnavailable(refreshErrorCode)) {
        console.warn("Plaid on-demand transaction refresh unavailable", {
          businessId,
          accountId,
          errorCode: refreshErrorCode,
          lastSuccessfulUpdateAt: plaidItemFreshness.lastSuccessfulUpdateAt,
        });
      }
    }

    const refreshUnavailable = refreshRequested && !refreshSucceeded && isTransactionsRefreshUnavailable(refreshErrorCode);
    const transactionsRefreshProductActive = refreshRequested
      ? refreshSucceeded
        ? true
        : refreshUnavailable
          ? false
          : plaidItemFreshness.transactionsRefreshProductActive
      : plaidItemFreshness.transactionsRefreshProductActive;

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
        currentBalanceCents = normalizePlaidCurrentBalanceCents(currentBalance, localAccount.type);
        balanceLookupSucceeded = true;
      }
    } catch (balanceError: any) {
      balanceErrorCode = plaidErrorCode(balanceError);
      balanceErrorMessage = plaidErrorMessage(balanceError);
      console.warn("Plaid balance lookup skipped during transaction sync", {
        businessId,
        accountId,
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
  let skippedHistoricalCount = 0;
  let skippedRemovedCount = 0;
  let replacementUpgradeCount = 0;
  let accountReplayMergedCount = 0;
  let protectedMatchedRemovalCount = 0;
  let restoredMatchedHistoryCount = 0;
  const retentionPrunedCount = 0;
  let historicalCutoffDate: Date | null = null;
  let snapshotAuditRequested = false;
  let snapshotAuditSucceeded = false;
  let snapshotAuditPages = 0;
  let snapshotAuditSeen = 0;
  let snapshotAuditTotalAvailable = 0;
  let snapshotAuditNewestDate: string | null = null;
  let snapshotAuditStartDate: string | null = null;
  let snapshotAuditEndDate: string | null = null;
  let snapshotAuditErrorCode: string | null = null;
  let snapshotAuditErrorMessage: string | null = null;
  let snapshotAuditRecoveredCount = 0;
  const snapshotOnlyTransactionIds = new Set<string>();

  // pendingCount will be computed from DB at end (accurate), not guessed during loop
  let pendingCount = 0;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function syncPage() {
    for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
      try {
        const request: TransactionsSyncRequest = {
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

  // A cursor is the normal source of truth, but older reconnect/cursor bugs can
  // leave it ahead of rows actually retained by BynkBook. On every manual sync,
  // compare a bounded recent account snapshot with the cursor results. The
  // existing exact-ID, replay, removal, and match protections below still own
  // every write, so this can recover a gap without creating a second import path.
  if (requestRefresh && typeof plaid.transactionsGet === "function") {
    snapshotAuditRequested = true;
    const snapshotEnd = new Date();
    const boundedStart = new Date(snapshotEnd.getTime() - 45 * 24 * 60 * 60 * 1000);
    const snapshotStart = effectiveStartDate > boundedStart ? effectiveStartDate : boundedStart;
    snapshotAuditStartDate = snapshotStart.toISOString().slice(0, 10);
    snapshotAuditEndDate = snapshotEnd.toISOString().slice(0, 10);

    try {
      const snapshotByPlaidId = new Map<string, any>();
      const SNAPSHOT_PAGE_SIZE = 500;
      const SNAPSHOT_MAX_PAGES = 5;

      for (let page = 0; page < SNAPSHOT_MAX_PAGES; page += 1) {
        const request: TransactionsGetRequest = {
          access_token: accessToken,
          start_date: snapshotAuditStartDate,
          end_date: snapshotAuditEndDate,
          options: {
            account_ids: [plaidAccountId],
            count: SNAPSHOT_PAGE_SIZE,
            offset: page * SNAPSHOT_PAGE_SIZE,
          },
        };
        const response = await plaid.transactionsGet(request);
        snapshotAuditPages += 1;
        const transactions = Array.isArray(response?.data?.transactions)
          ? response.data.transactions.filter((transaction: any) => transaction?.account_id === plaidAccountId)
          : [];
        const totalAvailable = Number(response?.data?.total_transactions ?? transactions.length);
        snapshotAuditTotalAvailable = Math.max(snapshotAuditTotalAvailable, Number.isFinite(totalAvailable) ? totalAvailable : 0);

        for (const transaction of transactions) {
          const transactionId = String(transaction?.transaction_id ?? "").trim();
          if (!transactionId) continue;
          snapshotByPlaidId.set(transactionId, transaction);
          const transactionDate = String(transaction?.date ?? "").trim();
          if (transactionDate && (!snapshotAuditNewestDate || transactionDate > snapshotAuditNewestDate)) {
            snapshotAuditNewestDate = transactionDate;
          }
        }
        snapshotAuditSeen += transactions.length;
        if (transactions.length < SNAPSHOT_PAGE_SIZE || (page + 1) * SNAPSHOT_PAGE_SIZE >= totalAvailable) break;
      }

      const drainedPlaidIds = new Set(
        drainedUpserts.map((transaction: any) => String(transaction?.transaction_id ?? "").trim()).filter(Boolean),
      );
      for (const [transactionId, transaction] of snapshotByPlaidId) {
        if (!drainedPlaidIds.has(transactionId)) {
          snapshotOnlyTransactionIds.add(transactionId);
          drainedUpserts.push(transaction);
        }
      }
      snapshotAuditSucceeded = true;
    } catch (snapshotError: any) {
      snapshotAuditErrorCode = plaidErrorCode(snapshotError);
      snapshotAuditErrorMessage = plaidErrorMessage(snapshotError);
      console.warn("Plaid recent transaction snapshot audit skipped", {
        businessId,
        accountId,
        errorCode: snapshotAuditErrorCode,
        errorMessage: snapshotAuditErrorMessage,
      });
    }
  }

  const now = new Date();
  const removedPlaidTransactionIds = Array.from(new Set(
    drainedRemoved
      .map((row: any) => String(row?.transaction_id ?? "").trim())
      .filter(Boolean),
  ));
  const removedExistingRows = removedPlaidTransactionIds.length > 0
    ? await prisma.bankTransaction.findMany({
        where: {
          business_id: businessId,
          account_id: accountId,
          plaid_account_id: plaidAccountId,
          plaid_transaction_id: { in: removedPlaidTransactionIds } as any,
        },
        select: {
          id: true,
          plaid_transaction_id: true,
          posted_date: true,
          amount_cents: true,
          name: true,
          is_removed: true,
        },
      })
    : [];
  const removedExistingByPlaidId = new Map(
    removedExistingRows.map((row: any) => [String(row?.plaid_transaction_id ?? ""), row]),
  );
  const consumedRemovedPlaidIds = new Set<string>();

  // A new Plaid Item can assign new account and transaction IDs to unchanged
  // financial facts. Before inserting that full-drain replay, pair exact stable
  // payloads with rows from the prior Plaid account identity. Pairing is
  // cardinality-aware so two genuinely identical same-day charges remain two
  // rows. Durable row IDs (and any reconciliation links) are preserved.
  const replayCandidateByIncomingPlaidId = new Map<string, any>();
  if (drainedUpserts.length > 0) {
    const legacyReplayRows = await prisma.bankTransaction.findMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        plaid_transaction_id: { not: null },
        plaid_account_id: { not: plaidAccountId },
        posted_date: { gte: effectiveStartDate },
      },
      select: {
        id: true,
        plaid_transaction_id: true,
        plaid_account_id: true,
        is_removed: true,
        raw: true,
        created_at: true,
        updated_at: true,
      },
    });
    const incomingByFingerprint = new Map<string, any[]>();
    const legacyByFingerprint = new Map<string, any[]>();

    for (const transaction of drainedUpserts) {
      const fingerprint = plaidReplayFingerprint(transaction);
      const incomingPlaidId = String(transaction?.transaction_id ?? "").trim();
      if (!fingerprint || !incomingPlaidId) continue;
      const group = incomingByFingerprint.get(fingerprint) ?? [];
      if (!group.some((row) => String(row?.transaction_id ?? "") === incomingPlaidId)) {
        group.push(transaction);
        incomingByFingerprint.set(fingerprint, group);
      }
    }
    for (const row of legacyReplayRows) {
      const fingerprint = plaidReplayFingerprint(row?.raw);
      if (!fingerprint) continue;
      const group = legacyByFingerprint.get(fingerprint) ?? [];
      group.push(row);
      legacyByFingerprint.set(fingerprint, group);
    }

    for (const [fingerprint, incomingRows] of incomingByFingerprint) {
      const legacyRows = legacyByFingerprint.get(fingerprint) ?? [];
      if (legacyRows.length === 0) continue;

      const sortedIncoming = [...incomingRows].sort((left, right) =>
        String(left.transaction_id).localeCompare(String(right.transaction_id)),
      );
      const sortedActive = legacyRows
        .filter((row) => !row.is_removed)
        .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)) || String(left.id).localeCompare(String(right.id)));
      const sortedRemoved = legacyRows
        .filter((row) => row.is_removed)
        .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)) || String(left.id).localeCompare(String(right.id)));

      // More active legacy rows than incoming facts is ambiguous: automatically
      // collapsing one could hide a legitimate repeated transaction.
      if (sortedActive.length > sortedIncoming.length) continue;

      let incomingIndex = 0;
      for (const legacyRow of sortedActive) {
        replayCandidateByIncomingPlaidId.set(String(sortedIncoming[incomingIndex].transaction_id), legacyRow);
        incomingIndex += 1;
      }
      for (const legacyRow of sortedRemoved) {
        if (incomingIndex >= sortedIncoming.length) break;
        replayCandidateByIncomingPlaidId.set(String(sortedIncoming[incomingIndex].transaction_id), legacyRow);
        incomingIndex += 1;
      }
    }
  }

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
            source_removed_at: null,
            source_removal_code: null,
            source: "PLAID",
            plaid_account_id: plaidAccountId,
            raw: t as any,
            updated_at: now,
          },
        });
        if (upgraded.count > 0) {
          consumedRemovedPlaidIds.add(pendingId);
          upgradedCount += upgraded.count;
          continue;
        }
      }
    }

    // A prior explicit overlap cleanup is authoritative. Do not resurrect an
    // exact Plaid ID that a user/system already soft-removed. Unlike the old
    // date-wide cutoff, this exact-ID check does not hide unrelated historical
    // transactions merely because newer CSV/manual history exists.
    const existingIncomingRow = await prisma.bankTransaction.findFirst({
      where: {
        business_id: businessId,
        account_id: accountId,
        plaid_transaction_id: t.transaction_id,
        plaid_account_id: plaidAccountId,
      },
      select: { id: true, is_removed: true },
    });
    if (existingIncomingRow?.is_removed) {
      skippedRemovedCount += 1;
      continue;
    }

    const replayCandidate = !existingIncomingRow
      ? replayCandidateByIncomingPlaidId.get(String(t.transaction_id))
      : null;
    if (replayCandidate) {
      const replayed = await prisma.bankTransaction.updateMany({
        where: {
          id: replayCandidate.id,
          business_id: businessId,
          account_id: accountId,
          plaid_transaction_id: replayCandidate.plaid_transaction_id,
          plaid_account_id: replayCandidate.plaid_account_id,
        },
        data: {
          plaid_transaction_id: t.transaction_id,
          plaid_account_id: plaidAccountId,
          posted_date: posted,
          authorized_date: t.authorized_date ? new Date(`${t.authorized_date}T00:00:00Z`) : null,
          amount_cents: cents,
          name: (t.name ?? t.merchant_name ?? "Transaction").toString(),
          is_pending: isPending,
          iso_currency_code: t.iso_currency_code ?? null,
          source: "PLAID",
          raw: t as any,
          updated_at: now,
          ...(replayCandidate.is_removed
            ? {}
            : {
                is_removed: false,
                removed_at: null,
                source_removed_at: null,
                source_removal_code: null,
              }),
        },
      });
      if (replayed.count > 0) {
        if (replayCandidate.is_removed) skippedRemovedCount += 1;
        else accountReplayMergedCount += 1;
        continue;
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
          source_removed_at: null,
          source_removal_code: null,
          raw: t as any,
        },
      });
      newCount += 1;
      if (snapshotOnlyTransactionIds.has(String(t.transaction_id))) snapshotAuditRecoveredCount += 1;
    } catch {
      const existingPlaidRow = await prisma.bankTransaction.findFirst({
        where: {
          business_id: businessId,
          account_id: accountId,
          plaid_transaction_id: t.transaction_id,
          plaid_account_id: plaidAccountId,
        },
        select: { id: true, is_removed: true },
      });
      if (existingPlaidRow?.is_removed) {
        skippedRemovedCount += 1;
        continue;
      }

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
          source_removed_at: null,
          source_removal_code: null,
          source: "PLAID",
          plaid_account_id: plaidAccountId,
          raw: t as any,
          updated_at: now,
        },
      });
    }
  }

  const activeMatchedBankTransactionIds = await activeMatchedBankTransactionIdsForPlaidSync(
    prisma,
    businessId,
    accountId,
  );
  const activeMatchedBankTransactionIdSet = new Set(activeMatchedBankTransactionIds);

  for (const removed of drainedRemoved) {
    const removedPlaidId = String(removed?.transaction_id ?? "").trim();
    if (!removedPlaidId || consumedRemovedPlaidIds.has(removedPlaidId)) continue;

    const existingRemovedRow = removedExistingByPlaidId.get(removedPlaidId);
    if (existingRemovedRow && activeMatchedBankTransactionIdSet.has(String(existingRemovedRow.id))) {
      await prisma.bankTransaction.updateMany({
        where: {
          id: existingRemovedRow.id,
          business_id: businessId,
          account_id: accountId,
        },
        data: {
          source_removed_at: now,
          source_removal_code: "PLAID_REMOVED",
          updated_at: now,
        },
      });
      protectedMatchedRemovalCount += 1;
      continue;
    }

    await prisma.bankTransaction.updateMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        plaid_transaction_id: removedPlaidId,
        plaid_account_id: plaidAccountId,
      },
      data: {
        is_removed: true,
        removed_at: now,
        source_removed_at: now,
        source_removal_code: "PLAID_REMOVED",
        updated_at: now,
      },
    });
  }

  // Repair rows hidden by older sync behavior. An active match is an accounting
  // audit record and must remain visible even if Plaid later removes/rekeys it.
  if (activeMatchedBankTransactionIds.length > 0) {
    const restored = await prisma.bankTransaction.updateMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        id: { in: activeMatchedBankTransactionIds } as any,
        is_removed: true,
      },
      data: { is_removed: false, removed_at: null, updated_at: now },
    });
    restoredMatchedHistoryCount = Number(restored?.count ?? 0);
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
              opening_balance_cents: signed,
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
              opening_balance_cents: signed,
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

  const drainIncomplete = hasMore && (pageN >= MAX_PAGES || totalSeen >= MAX_TOTAL);
  const connectionUpdateData: any = {
    sync_cursor: packSyncCursor(plaidAccountId, cursorScope, cursor),
    last_sync_at: now,
    has_new_transactions: drainIncomplete,
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
    skippedHistoricalCount,
    skippedRemovedCount,
    replacementUpgradeCount,
    accountReplayMergedCount,
    protectedMatchedRemovalCount,
    restoredMatchedHistoryCount,
    retentionPrunedCount,
    historicalCutoffDate: historicalCutoffDate ? historicalCutoffDate.toISOString().slice(0, 10) : null,
    pendingCount,
    lastSyncAt: now.toISOString(),
    refreshRequested,
    refreshSucceeded,
    refreshUnavailable,
    refreshErrorCode,
    refreshErrorMessage,
    plaidLastSuccessfulUpdateAt: plaidItemFreshness.lastSuccessfulUpdateAt,
    plaidLastFailedUpdateAt: plaidItemFreshness.lastFailedUpdateAt,
    plaidFreshnessErrorCode: plaidItemFreshness.lookupErrorCode,
    transactionsRefreshProductActive,
    balanceLookupSucceeded,
    balanceErrorCode,
    balanceErrorMessage,
    webhookConfigured: webhookRepair.configured,
    webhookUpdated: webhookRepair.updated,
    webhookErrorCode: webhookRepair.errorCode,
    webhookErrorMessage: webhookRepair.errorMessage,

    // Progress metadata (useful for UI)
    pages: pageN,
    totalSeen,
    capped: drainIncomplete,
    hasMore: hasMore,
    drainIncomplete,
    drainRestartCount,
    cursorScope,
    accountScopedFallback,
    accountScopedFallbackCode,
    cursorResetFromLegacyScope: initialCursorInfo.resetFromLegacyCursor,
    snapshotAuditRequested,
    snapshotAuditSucceeded,
    snapshotAuditPages,
    snapshotAuditSeen,
    snapshotAuditTotalAvailable,
    snapshotAuditNewestDate,
    snapshotAuditStartDate,
    snapshotAuditEndDate,
    snapshotAuditRecoveredCount,
    snapshotAuditErrorCode,
    snapshotAuditErrorMessage,
  });
  } catch (error) {
    return recordSyncFailure(error);
  } finally {
    try {
      await prisma.bankConnection.updateMany({
        where: {
          business_id: businessId,
          account_id: accountId,
          sync_lock_token: syncLeaseToken,
        },
        data: {
          sync_lock_token: null,
          sync_lock_expires_at: null,
          updated_at: new Date(),
        },
      });
    } catch (releaseError: any) {
      console.error("Plaid sync lease release failed", {
        businessId,
        accountId,
        errorCode: compactSafePlaidValue(releaseError?.code, "SYNC_LEASE_RELEASE_FAILED"),
      });
    }
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

  if (typeNorm === "TRANSACTIONS" && codeNorm === "SYNC_UPDATES_AVAILABLE") {
    await prisma.bankConnection.updateMany({
      where: { plaid_item_id: itemId },
      data: { has_new_transactions: true, updated_at: new Date() },
    });

    if (request.enqueueSync) {
      const targets = await prisma.bankConnection.findMany({
        where: { plaid_item_id: itemId },
        select: { business_id: true, account_id: true },
      });
      await Promise.all(targets.map((target: any) => request.enqueueSync!({
        businessId: String(target.business_id),
        accountId: String(target.account_id),
        itemId,
      })));
    }

    return json(200, { ok: true, webhookType, webhookCode });
  }

  if (typeNorm === "TRANSACTIONS") {
    return json(200, { ok: true, webhookType, webhookCode, ignored: true });
  }

  if (typeNorm === "ITEM") {
    const rawError = body?.error ?? {};
    const code = compactSafePlaidValue(rawError?.error_code ?? webhookCode, webhookCode || "PLAID_ITEM_WEBHOOK").slice(0, 80);
    const message = compactSafePlaidValue(
      rawError?.error_message ?? rawError?.display_message ?? webhookCode,
      webhookCode || "Plaid item webhook"
    );
    if (codeNorm === "LOGIN_REPAIRED") {
      await prisma.bankConnection.updateMany({
        where: { plaid_item_id: itemId },
        data: {
          status: "CONNECTED",
          error_code: null,
          error_message: null,
          updated_at: new Date(),
        },
      });
      return json(200, { ok: true, webhookType, webhookCode, updated: true });
    }

    if (codeNorm === "NEW_ACCOUNTS_AVAILABLE") {
      await prisma.bankConnection.updateMany({
        where: { plaid_item_id: itemId },
        data: { new_accounts_available: true, updated_at: new Date() },
      });
      return json(200, { ok: true, webhookType, webhookCode, updated: true });
    }

    const status =
      codeNorm === "ERROR"
        ? reconnectStatusForPlaidFailure(code, message)
        : codeNorm === "PENDING_EXPIRATION" ||
            codeNorm === "PENDING_DISCONNECT" ||
            codeNorm === "USER_PERMISSION_REVOKED" ||
            codeNorm === "USER_ACCOUNT_REVOKED"
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
