"use client";

import { useCallback, useRef, useState } from "react";
import { Landmark } from "lucide-react";
import { plaidExchange, plaidLinkToken, plaidReconnectLinkToken, plaidSync } from "@/lib/api/plaid";
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

export function PlaidConnectButton(props: Props) {
  const {
    businessId,
    accountId,
    businessName,
    accountName,
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

  // Initial sync progress
  const [openSyncing, setOpenSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<{ newCount: number; pendingCount: number } | null>(null);
  const [syncErrorMsg, setSyncErrorMsg] = useState<string | null>(null);

  // Guard to prevent double-open on rapid clicks
  const openingRef = useRef(false);

  // Hold current link handler so we can exit/cleanup safely
  const handlerRef = useRef<ReturnType<NonNullable<typeof window.Plaid>["create"]> | null>(null);

  const resetPendingSelection = useCallback(() => {
    setPendingPublicToken(null);
    setPendingInstitution(null);
    setPendingAccounts([]);
    setSelectedPlaidAccountId("");
  }, []);

  const runInitialSync = useCallback(async () => {
    setOpenSyncing(true);
    setSyncInfo(null);
    setSyncErrorMsg(null);

    try {
      const syncResult: any = await plaidSync(businessId, accountId);
      setSyncInfo({
        newCount: Number(syncResult?.newCount ?? 0),
        pendingCount: Number(syncResult?.pendingCount ?? 0),
      });
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
    institution?: any
  ) => {
    setBusy(true);
    setErrorMsg(null);

    try {
      const res = await plaidExchange(businessId, accountId, {
        public_token: publicToken,
        plaidAccountId,
        institution: institution ?? pendingInstitution ?? undefined,
        mask: account?.mask ?? undefined,
      });

      if (!res?.ok) throw new Error(res?.error ?? "Exchange failed");

      setOpenSelect(false);
      resetPendingSelection();

      const syncRes = await runInitialSync();
      onConnected(syncRes);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Plaid connection failed");
    } finally {
      setBusy(false);
    }
  }, [accountId, businessId, onConnected, pendingInstitution, resetPendingSelection, runInitialSync]);

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
            if (mode === "reconnect" || lt?.mode === "update") {
              const syncRes = await runInitialSync();
              onConnected(syncRes);
              return;
            }

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
  }, [accountId, businessId, busy, completeExistingAccountConnect, disabled, mode, onConnected, runInitialSync]);

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
        title="Choose bank account"
        size="md"
      >
        <div className="space-y-4">
          <div className="text-xs text-bb-text-muted">
            Select exactly one bank account to link to this BynkBook account.
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
                    onChange={() => setSelectedPlaidAccountId(a.id)}
                  />
                  <span className="truncate">{label}</span>
                </label>
              );
            })}
          </div>

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
              disabled={busy || !pendingPublicToken || !selectedPlaidAccountId}
              onClick={async () => {
                if (!pendingPublicToken || !selectedPlaidAccountId) return;

                const selected = pendingAccounts.find((x) => x.id === selectedPlaidAccountId);
                await completeExistingAccountConnect(pendingPublicToken, selectedPlaidAccountId, selected);
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
    </div>
  );
}
