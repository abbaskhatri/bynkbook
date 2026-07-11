"use client";

import { useCallback, useRef, useState } from "react";
import { Landmark } from "lucide-react";
import {
  plaidApplyOpening,
  plaidExchange,
  plaidLinkToken,
  plaidPreviewOpening,
  plaidRepairAccount,
  plaidReconnectLinkToken,
  plaidSync,
} from "@/lib/api/plaid";
import { AppDialog } from "@/components/primitives/AppDialog";

function TinySpinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border border-bb-text-muted border-t-transparent" />;
}

/**
 * Guardrail 1: load script once, then verify window.Plaid?.create exists.
 * Guardrail 2: StrictMode-safe: create the Link handler only on click,
 * and prevent rapid multi-click from opening multiple instances.
 */

declare global {
  interface Window {
    Plaid?: {
      create: (config: any) => { open: () => void; exit: (opts?: any) => void; destroy?: () => void };
    };
  }
}

let plaidScriptPromise: Promise<void> | null = null;

function loadPlaidScriptOnce(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  if (plaidScriptPromise) return plaidScriptPromise;

  plaidScriptPromise = new Promise<void>((resolve, reject) => {
    // If already present, resolve immediately
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"]'
    );
    if (existing) {
      // If it already loaded, resolve now; otherwise wait for load
      if ((window as any).Plaid?.create) return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Plaid script failed to load")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Plaid script failed to load"));
    document.head.appendChild(script);
  });

  return plaidScriptPromise;
}

type Props = {
  businessId: string;
  accountId: string;
  businessName?: string;
  accountName?: string;

  // Existing-account Plaid connects derive the start date on the server.
  effectiveStartDate?: string; // legacy fallback only

  disabledClassName: string;
  buttonClassName: string;
  disabled?: boolean;
  mode?: "connect" | "reconnect";

  // Label override (e.g., "Switch")
  label?: string;

  onConnected: (syncResult?: any) => void;
};

type PlaidAccountMeta = {
  id: string;
  name?: string;
  mask?: string;
  type?: string;
  subtype?: string;
};

type OpeningPreview = {
  ok?: boolean;
  balanceAvailable?: boolean;
  currency?: string | null;
  effectiveStartDate?: string;
  currentBalanceCents?: string;
  sumPostedTxnsCents?: string;
  suggestedOpeningCents?: string;
  conflict?: {
    hasRealEntries?: boolean;
    hasManualOpeningNonZero?: boolean;
    hasMatchesOrClearing?: boolean;
    hasExistingBankTxns?: boolean;
    openingEntriesCount?: number;
  };
  error?: string;
  errorCode?: string;
};

type OpeningReviewState = {
  effectiveStartDate: string;
  account?: PlaidAccountMeta;
  institution?: { name?: string; institution_id?: string };
  preview?: OpeningPreview;
  previewError?: string;
  syncResult?: any;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatCents(raw?: string | number | null) {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n)) return money.format(0);
  return money.format(n / 100);
}

function accountTypeFromPlaid(account?: PlaidAccountMeta, fallback = "CHECKING") {
  const raw = `${account?.subtype ?? ""} ${account?.type ?? ""}`.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw.includes("credit")) return "CREDIT_CARD";
  if (raw.includes("saving")) return "SAVINGS";
  if (raw.includes("checking") || raw.includes("depository")) return "CHECKING";
  return "OTHER";
}

export function PlaidConnectButton(props: Props) {
  const {
    businessId,
    accountId,
    businessName,
    accountName,
    effectiveStartDate,
    disabledClassName,
    buttonClassName,
    disabled,
    mode = "connect",
    onConnected,
  } = props;

  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step 1: explicit per-launch confirmation gate
  const [confirmed, setConfirmed] = useState(false);
  const [openConfirm, setOpenConfirm] = useState(false);

  // Step 2: after Plaid returns metadata, user must choose exactly one account + history window
  const [openSelect, setOpenSelect] = useState(false);
  const [pendingPublicToken, setPendingPublicToken] = useState<string | null>(null);
  const [pendingInstitution, setPendingInstitution] = useState<any>(null);
  const [pendingAccounts, setPendingAccounts] = useState<PlaidAccountMeta[]>([]);
  const [selectedPlaidAccountId, setSelectedPlaidAccountId] = useState<string>("");
  const [selectedAdditionalPlaidAccountIds, setSelectedAdditionalPlaidAccountIds] = useState<string[]>([]);
  const [pendingReconnectRepair, setPendingReconnectRepair] = useState(false);

  // Initial sync progress
  const [openSyncing, setOpenSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<{ newCount: number; pendingCount: number } | null>(null);
  const [syncErrorMsg, setSyncErrorMsg] = useState<string | null>(null);

  // Existing-ledger accounting decision after a successful Plaid connection.
  const [openOpeningReview, setOpenOpeningReview] = useState(false);
  const [openingReview, setOpeningReview] = useState<OpeningReviewState | null>(null);
  const [openingBusy, setOpeningBusy] = useState(false);

  // Guard to prevent double-open on rapid clicks
  const openingRef = useRef(false);

  // Hold current link handler so we can exit/cleanup safely
  const handlerRef = useRef<ReturnType<NonNullable<typeof window.Plaid>["create"]> | null>(null);

  const resetPendingSelection = useCallback(() => {
    setPendingPublicToken(null);
    setPendingInstitution(null);
    setPendingAccounts([]);
    setSelectedPlaidAccountId("");
    setSelectedAdditionalPlaidAccountIds([]);
    setPendingReconnectRepair(false);
  }, []);

  const runInitialSync = useCallback(async (options?: { afterReconnect?: boolean }) => {
    setOpenSyncing(true);
    setSyncInfo(null);
    setSyncErrorMsg(null);

    try {
      const syncResult: any = await plaidSync(businessId, accountId, { afterReconnect: options?.afterReconnect === true });
      setSyncInfo({
        newCount: Number(syncResult?.newCount ?? 0),
        pendingCount: Number(syncResult?.pendingCount ?? 0),
      });
      if (syncResult?.pendingSync) {
        setSyncErrorMsg(syncResult?.message ?? "Bank reconnected. Transactions will sync shortly.");
      }
      return syncResult;
    } catch (e: any) {
      const message = e?.message ?? "Initial transaction sync failed";
      setSyncErrorMsg(message);
      setErrorMsg(`Plaid connected, but initial transaction sync failed: ${message}`);
      return { ok: false, syncFailed: true, error: message };
    } finally {
      setOpenSyncing(false);
    }
  }, [accountId, businessId]);

  const completeExistingAccountConnect = useCallback(async (
    publicToken: string,
    plaidAccountId: string,
    account?: PlaidAccountMeta,
    institution?: any,
    additionalAccounts?: PlaidAccountMeta[]
  ) => {
    setBusy(true);
    setErrorMsg(null);

    try {
      const res = await plaidExchange(businessId, accountId, {
        public_token: publicToken,
        plaidAccountId,
        institution: institution ?? pendingInstitution ?? undefined,
        mask: account?.mask ?? undefined,
        additionalAccounts: (additionalAccounts ?? []).map((extra) => ({
          plaidAccountId: extra.id,
          name: extra.name ?? (institution?.name ? `${institution.name} Account` : "Bank Account"),
          type: accountTypeFromPlaid(extra),
          subtype: extra.subtype,
          mask: extra.mask,
          effectiveStartDate,
        })),
      });

      if (!res?.ok) throw new Error(res?.error ?? "Exchange failed");

      setOpenSelect(false);
      resetPendingSelection();

      const syncRes = await runInitialSync();
      const createdAdditional = Array.isArray(res?.additionalAccounts) ? res.additionalAccounts : [];
      for (const created of createdAdditional) {
        if (!created?.accountId) continue;
        try {
          await plaidSync(businessId, String(created.accountId));
        } catch {
          // Additional accounts can be synced manually later; do not fail the primary connection.
        }
      }
      const retainedStartDate = String(res?.effectiveStartDate ?? effectiveStartDate ?? "").slice(0, 10);
      const reviewStartDate = retainedStartDate || new Date().toISOString().slice(0, 10);

      try {
        const preview: OpeningPreview = await plaidPreviewOpening(businessId, accountId, {
          effectiveStartDate: reviewStartDate,
        });
        setOpeningReview({
          effectiveStartDate: reviewStartDate,
          account,
          institution: institution ?? pendingInstitution ?? undefined,
          preview,
          syncResult: syncRes,
        });
      } catch (previewError: any) {
        setOpeningReview({
          effectiveStartDate: reviewStartDate,
          account,
          institution: institution ?? pendingInstitution ?? undefined,
          previewError: previewError?.message ?? "Opening balance preview failed",
          syncResult: syncRes,
        });
      }
      setOpenOpeningReview(true);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Plaid connection failed");
    } finally {
      setBusy(false);
    }
  }, [accountId, businessId, effectiveStartDate, pendingInstitution, resetPendingSelection, runInitialSync]);

  const completeReconnectRepair = useCallback(async (
    plaidAccountId: string,
    account?: PlaidAccountMeta,
    institution?: any,
    additionalAccounts?: PlaidAccountMeta[],
  ) => {
    setBusy(true);
    setErrorMsg(null);

    try {
      const repaired = await plaidRepairAccount(businessId, accountId, {
        plaidAccountId,
        institution: institution ?? pendingInstitution ?? undefined,
        mask: account?.mask ?? undefined,
        additionalAccounts: (additionalAccounts ?? []).map((extra) => ({
          plaidAccountId: extra.id,
          name: extra.name ?? (institution?.name ? `${institution.name} Account` : "Bank Account"),
          type: accountTypeFromPlaid(extra),
          subtype: extra.subtype,
          mask: extra.mask,
          effectiveStartDate,
        })),
      });
      if (!repaired?.ok) throw new Error(repaired?.error ?? "Bank account repair failed");

      setOpenSelect(false);
      resetPendingSelection();

      const syncRes = await runInitialSync({ afterReconnect: true });
      for (const created of Array.isArray(repaired?.additionalAccounts) ? repaired.additionalAccounts : []) {
        if (!created?.accountId) continue;
        try {
          await plaidSync(businessId, String(created.accountId));
        } catch {
          // The new account remains connected and can be retried from Reconcile.
        }
      }
      onConnected(syncRes);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Plaid reconnection failed");
    } finally {
      setBusy(false);
    }
  }, [accountId, businessId, effectiveStartDate, onConnected, pendingInstitution, resetPendingSelection, runInitialSync]);

  const finishOpeningReview = useCallback(async (choice: "APPLY_PLAID" | "KEEP_MANUAL") => {
    const review = openingReview;
    if (!review) return;

    setOpeningBusy(true);
    setErrorMsg(null);
    try {
      const preview = review.preview;
      if (preview?.balanceAvailable) {
        await plaidApplyOpening(businessId, accountId, {
          choice,
          effectiveStartDate: review.effectiveStartDate,
          suggestedOpeningCents: preview.suggestedOpeningCents ?? "0",
        });
      }

      setOpenOpeningReview(false);
      setOpeningReview(null);
      onConnected(review.syncResult);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Opening balance setup failed");
    } finally {
      setOpeningBusy(false);
    }
  }, [accountId, businessId, onConnected, openingReview]);

  const launchPlaid = useCallback(async () => {
    if (disabled) return;
    if (busy) return;
    if (openingRef.current) return;

    openingRef.current = true;
    setBusy(true);
    setConnecting(true);
    setErrorMsg(null);

    try {
      // 1) Get link token from backend
      const lt = mode === "reconnect"
        ? await plaidReconnectLinkToken(businessId, accountId)
        : await plaidLinkToken(businessId, accountId);
      const linkToken = lt?.link_token;
      if (!linkToken) throw new Error("Failed to create link token");

      // 2) Load Plaid script (once)
      await loadPlaidScriptOnce();

      // 3) Verify Plaid exists
      if (!window.Plaid?.create) {
        setErrorMsg("Plaid failed to load, please retry");
        return;
      }

      // 4) Create handler only on click (StrictMode-safe)
      //    Destroy any previous handler instance
      try {
        handlerRef.current?.destroy?.();
      } catch {}
      handlerRef.current = null;

      const handler = window.Plaid.create({
        token: linkToken,
        onSuccess: async (public_token: string, metadata: any) => {
          try {
            const accountsRaw = Array.isArray(metadata?.accounts) ? metadata.accounts : [];
            const accounts: PlaidAccountMeta[] = accountsRaw
              .map((a: any) => ({
                id: String(a?.id ?? ""),
                name: a?.name ? String(a.name) : undefined,
                mask: a?.mask ? String(a.mask) : undefined,
                type: a?.type ? String(a.type) : undefined,
                subtype: a?.subtype ? String(a.subtype) : undefined,
              }))
              .filter((a: any) => !!a.id);

            const institution = metadata?.institution
              ? { name: metadata.institution.name, institution_id: metadata.institution.institution_id }
              : undefined;

            if (mode === "reconnect" || lt?.mode === "update") {
              if (accounts.length === 1) {
                await completeReconnectRepair(accounts[0].id, accounts[0], institution);
                return;
              }

              if (accounts.length > 1) {
                setPendingPublicToken(null);
                setPendingInstitution(institution);
                setPendingAccounts(accounts);
                setSelectedPlaidAccountId(accounts[0]?.id ?? "");
                setSelectedAdditionalPlaidAccountIds([]);
                setPendingReconnectRepair(true);
                setOpenSelect(true);
                return;
              }

              const syncRes = await runInitialSync({ afterReconnect: true });
              onConnected(syncRes);
              return;
            }

            if (accounts.length === 0) throw new Error("Plaid returned no accounts");

            if (accounts.length === 1) {
              await completeExistingAccountConnect(public_token, accounts[0].id, accounts[0], institution);
              return;
            }

            // Open selection step only when Plaid returns multiple possible accounts.
            setPendingPublicToken(public_token);
            setPendingInstitution(institution);
            setPendingAccounts(accounts);
            setSelectedPlaidAccountId(accounts[0]?.id ?? "");
            setSelectedAdditionalPlaidAccountIds([]);

            setOpenSelect(true);
          } catch (e: any) {
            setErrorMsg(e?.message ?? "Plaid connection failed");
          } finally {
            // Release the “opening” lock; selection dialog handles final exchange
            setBusy(false);
            openingRef.current = false;
          }
        },
        onExit: () => {
          setBusy(false);
          openingRef.current = false;
        },
      });

      handlerRef.current = handler;
      handler.open();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Plaid failed to load, please retry");
    } finally {
      setConnecting(false);
      // if we returned early due to Plaid missing, busy must be cleared
      if (!handlerRef.current) {
        setBusy(false);
        openingRef.current = false;
      }
    }
  }, [accountId, businessId, busy, completeExistingAccountConnect, completeReconnectRepair, disabled, mode, onConnected, runInitialSync]);

  const requestPlaidLaunch = useCallback(() => {
    if (disabled) return;
    if (busy) return;
    setErrorMsg(null);
    if (mode === "reconnect") {
      void launchPlaid();
      return;
    }
    setConfirmed(false);
    setOpenConfirm(true);
  }, [busy, disabled, launchPlaid, mode]);

  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        className={busy || disabled ? disabledClassName : buttonClassName}
        disabled={busy || !!disabled}
        onClick={requestPlaidLaunch}
        title={busy ? "Working…" : undefined}
      >
        <Landmark className="h-3.5 w-3.5" /> {busy ? "Opening…" : (props.label ?? "Connect bank")}
      </button>

      {errorMsg ? <div className="mt-1 text-[11px] text-bb-status-danger-fg">{errorMsg}</div> : null}

      <AppDialog
        open={openConfirm}
        onClose={() => setOpenConfirm(false)}
        title="Confirm bank connection"
        size="md"
      >
        <div className="space-y-4">
          <div className="text-xs text-bb-text leading-relaxed break-words">
            This connects a live bank via Plaid for the selected BynkBook scope.
          </div>

          <div className="rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2 text-xs">
            <div className="flex items-start justify-between gap-3">
              <span className="text-bb-text-muted">Business</span>
              <span className="text-right font-semibold text-bb-text">{businessName || "Selected business"}</span>
            </div>
            <div className="mt-1 flex items-start justify-between gap-3">
              <span className="text-bb-text-muted">Account</span>
              <span className="text-right font-semibold text-bb-text">{accountName || "Selected account"}</span>
            </div>
          </div>

          <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
            Bank-level encryption - Read-only access - No password stored
          </div>

          <div className="text-xs text-bb-text">
            Before continuing:
            <ul className="list-disc ml-5 mt-1 text-bb-text-muted">
              <li>This will connect a bank feed for this account.</li>
              <li>This does not delete existing entries.</li>
              <li>This may import bank transactions after connection.</li>
            </ul>
          </div>

          <label className="flex items-start gap-2 text-xs text-bb-text min-w-0">
            <input
              type="checkbox"
              className="h-4 w-4 mt-0.5 shrink-0"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span className="min-w-0 break-words">
              I understand this will open Plaid to connect a live bank feed for this account.
            </span>
          </label>

          <div className="flex items-center justify-between border-t border-bb-border pt-3">
            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-surface-soft"
              onClick={() => setOpenConfirm(false)}
            >
              Cancel
            </button>

            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-50 inline-flex items-center gap-2"
              disabled={!confirmed || busy || connecting}
              onClick={async () => {
                setOpenConfirm(false);
                await launchPlaid();
              }}
            >
              {connecting ? (
                <>
                  <TinySpinner /> Connecting…
                </>
              ) : (
                "Continue"
              )}
            </button>
          </div>
        </div>
      </AppDialog>

      {/* Step 2: select exactly one bank account only when Plaid returns multiple accounts. */}
      <AppDialog
        open={openSelect}
        onClose={() => {
          setOpenSelect(false);
          resetPendingSelection();
        }}
        title={pendingReconnectRepair ? "Repair bank account mapping" : "Choose bank account"}
        size="md"
      >
        <div className="space-y-4">
          <div className="text-xs text-bb-text-muted">
            {pendingReconnectRepair
              ? "Plaid reconnected. Select the live bank account that belongs to this BynkBook account."
              : "Select exactly one bank account to link to this BynkBook account."}
          </div>

          <div className="space-y-2">
            {pendingAccounts.map((a) => {
              const label = `${a.name ?? "Account"}${a.mask ? ` • ****${a.mask}` : ""}${a.subtype ? ` • ${a.subtype}` : a.type ? ` • ${a.type}` : ""}`;
              return (
                <label key={a.id} className="flex items-center gap-2 rounded-md border border-bb-border bg-bb-surface-card px-3 py-2 text-xs text-bb-text">
                  <input
                    type="radio"
                    name="plaid-account"
                    className="h-4 w-4"
                    checked={selectedPlaidAccountId === a.id}
                    onChange={() => {
                      setSelectedPlaidAccountId(a.id);
                      setSelectedAdditionalPlaidAccountIds((cur) => cur.filter((id) => id !== a.id));
                    }}
                  />
                  <span className="truncate">{label}</span>
                </label>
              );
            })}
          </div>

          {pendingAccounts.some((a) => a.id !== selectedPlaidAccountId) ? (
            <div className="rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2">
              <div className="text-xs font-semibold text-bb-text">
                {pendingReconnectRepair ? "Other newly shared accounts" : "Other consented accounts"}
              </div>
              <div className="mt-1 text-[11px] text-bb-text-muted">
                Optional: create separate BynkBook accounts for other bank accounts from this same Plaid connection.
              </div>
              <div className="mt-2 space-y-2">
                {pendingAccounts
                  .filter((a) => a.id !== selectedPlaidAccountId)
                  .map((a) => {
                    const label = `${a.name ?? "Account"}${a.mask ? ` • ****${a.mask}` : ""}${a.subtype ? ` • ${a.subtype}` : a.type ? ` • ${a.type}` : ""}`;
                    const checked = selectedAdditionalPlaidAccountIds.includes(a.id);
                    return (
                      <label key={a.id} className="flex items-center gap-2 text-xs text-bb-text">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedAdditionalPlaidAccountIds((cur) =>
                              e.target.checked ? [...cur, a.id] : cur.filter((id) => id !== a.id),
                            );
                          }}
                        />
                        <span className="min-w-0 truncate">{label}</span>
                      </label>
                    );
                  })}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-bb-border pt-3">
            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-surface-soft"
              onClick={() => setOpenSelect(false)}
              disabled={busy}
            >
              Back
            </button>

            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-50"
              disabled={busy || (!pendingReconnectRepair && !pendingPublicToken) || !selectedPlaidAccountId}
              onClick={async () => {
                if (!selectedPlaidAccountId) return;

                const selected = pendingAccounts.find((x) => x.id === selectedPlaidAccountId);
                if (pendingReconnectRepair) {
                  const additional = pendingAccounts.filter(
                    (x) => x.id !== selectedPlaidAccountId && selectedAdditionalPlaidAccountIds.includes(x.id),
                  );
                  await completeReconnectRepair(selectedPlaidAccountId, selected, pendingInstitution, additional);
                  return;
                }
                if (!pendingPublicToken) return;
                const additional = pendingAccounts.filter(
                  (x) => x.id !== selectedPlaidAccountId && selectedAdditionalPlaidAccountIds.includes(x.id),
                );
                await completeExistingAccountConnect(pendingPublicToken, selectedPlaidAccountId, selected, pendingInstitution, additional);
              }}
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
      </AppDialog>

      <AppDialog
        open={openSyncing}
        onClose={() => {}}
        title="Initial sync"
        size="sm"
      >
        <div className="space-y-3">
          <div className="text-xs text-bb-text flex items-center gap-2">
            <TinySpinner /> Syncing transactions…
          </div>

          <div className="mt-2 text-[11px] text-bb-text-muted">
            This may take a moment on first connection.
          </div>

          {syncInfo ? (
            <div className="mt-3 rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2 text-xs">
              <div className="flex justify-between">
                <span className="text-bb-text-muted">New</span>
                <span className="font-semibold text-bb-text">{syncInfo.newCount}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-bb-text-muted">Pending</span>
                <span className="font-semibold text-bb-text">{syncInfo.pendingCount}</span>
              </div>
            </div>
          ) : null}

          {syncErrorMsg ? (
            <div className="mt-3 rounded-md border border-bb-status-danger-border bg-bb-status-danger-bg px-3 py-2 text-xs text-bb-status-danger-fg">
              Initial transaction sync failed: {syncErrorMsg}
            </div>
          ) : null}
        </div>
      </AppDialog>

      <AppDialog
        open={openOpeningReview}
        onClose={() => {
          if (!openingBusy) void finishOpeningReview("KEEP_MANUAL");
        }}
        title="Review opening balance"
        size="md"
      >
        <div className="space-y-4">
          {openingReview ? (
            <>
              <div className="rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-bb-text-muted">Institution</span>
                  <span className="text-right font-semibold text-bb-text">
                    {openingReview.institution?.name ?? "Connected bank"}
                  </span>
                </div>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <span className="text-bb-text-muted">Bank account</span>
                  <span className="text-right font-semibold text-bb-text">
                    {openingReview.account?.name ?? "Selected account"}
                    {openingReview.account?.mask ? ` • ****${openingReview.account.mask}` : ""}
                  </span>
                </div>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <span className="text-bb-text-muted">Ledger starts</span>
                  <span className="text-right font-semibold text-bb-text">{openingReview.effectiveStartDate}</span>
                </div>
              </div>

              {openingReview.preview?.balanceAvailable ? (
                <>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="rounded-md border border-bb-border bg-bb-surface-card px-3 py-2">
                      <div className="text-[11px] text-bb-text-muted">Bank balance now</div>
                      <div className="mt-1 text-sm font-semibold text-bb-text">
                        {formatCents(openingReview.preview.currentBalanceCents)}
                      </div>
                    </div>
                    <div className="rounded-md border border-bb-border bg-bb-surface-card px-3 py-2">
                      <div className="text-[11px] text-bb-text-muted">Synced activity</div>
                      <div className="mt-1 text-sm font-semibold text-bb-text">
                        {formatCents(openingReview.preview.sumPostedTxnsCents)}
                      </div>
                    </div>
                    <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2">
                      <div className="text-[11px] text-primary">Suggested opening</div>
                      <div className="mt-1 text-sm font-semibold text-primary">
                        {formatCents(openingReview.preview.suggestedOpeningCents)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2 text-xs text-bb-text-muted">
                    Plaid can estimate the opening balance as current bank balance minus posted bank activity retained in BynkBook.
                    For an existing ledger, keeping the current opening is safest unless the current ledger opening is missing or wrong.
                  </div>

                  {openingReview.preview.conflict?.hasRealEntries ||
                  openingReview.preview.conflict?.hasManualOpeningNonZero ||
                  openingReview.preview.conflict?.hasMatchesOrClearing ? (
                    <div className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-xs text-bb-status-warning-fg">
                      This account already has ledger activity. Applying the Plaid estimate will create or update the opening balance entry;
                      keep the current ledger opening if the books were already reconciled.
                    </div>
                  ) : (
                    <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
                      No conflicting ledger activity was found. Applying the Plaid estimate can add the opening balance entry for this connected account.
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-xs text-bb-status-warning-fg">
                  {openingReview.previewError ||
                    openingReview.preview?.error ||
                    "Plaid did not provide a usable balance, so BynkBook will keep the current ledger opening."}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-bb-border pt-3">
                <button
                  type="button"
                  className="h-8 px-3 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-surface-soft disabled:opacity-50"
                  onClick={() => finishOpeningReview("KEEP_MANUAL")}
                  disabled={openingBusy}
                >
                  {openingBusy ? "Saving…" : "Keep current opening"}
                </button>

                <button
                  type="button"
                  className="h-8 px-3 text-xs rounded-md border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-50"
                  onClick={() => finishOpeningReview("APPLY_PLAID")}
                  disabled={openingBusy || !openingReview.preview?.balanceAvailable}
                >
                  {openingReview.preview?.conflict?.openingEntriesCount ? "Update opening entry" : "Add opening entry"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </AppDialog>
    </div>
  );
}
