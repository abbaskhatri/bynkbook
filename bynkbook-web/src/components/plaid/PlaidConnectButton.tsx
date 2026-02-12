"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { plaidExchange, plaidLinkToken, plaidSync } from "@/lib/api/plaid";
import { AppDialog } from "@/components/primitives/AppDialog";

function TinySpinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border border-slate-400 border-t-transparent" />;
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

  // Default effective start date if user doesn't choose (we will override via UI)
  effectiveStartDate: string; // YYYY-MM-DD

  disabledClassName: string;
  buttonClassName: string;
  disabled?: boolean;
  onConnected: (syncResult?: any) => void;
};

type PlaidAccountMeta = {
  id: string;
  name?: string;
  mask?: string;
  type?: string;
  subtype?: string;
};

function ymdToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthsBackStart(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function PlaidConnectButton(props: Props) {
  const {
    businessId,
    accountId,
    effectiveStartDate,
    disabledClassName,
    buttonClassName,
    disabled,
    onConnected,
  } = props;

  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step 1: consent gate
  const [consented, setConsented] = useState(false);
  const [openConsent, setOpenConsent] = useState(false);

  // Step 2: after Plaid returns metadata, user must choose exactly one account + history window
  const [openSelect, setOpenSelect] = useState(false);
  const [pendingPublicToken, setPendingPublicToken] = useState<string | null>(null);
  const [pendingInstitution, setPendingInstitution] = useState<any>(null);
  const [pendingAccounts, setPendingAccounts] = useState<PlaidAccountMeta[]>([]);
  const [selectedPlaidAccountId, setSelectedPlaidAccountId] = useState<string>("");

  const [historyPreset, setHistoryPreset] = useState<"1" | "3" | "6" | "12" | "custom">("3");
  const [customStart, setCustomStart] = useState<string>("");
  const endDate = useMemo(() => ymdToday(), []);

  // Initial sync progress
  const [openSyncing, setOpenSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<{ newCount: number; pendingCount: number } | null>(null);

  // Guard to prevent double-open on rapid clicks
  const openingRef = useRef(false);

  // Hold current link handler so we can exit/cleanup safely
  const handlerRef = useRef<ReturnType<NonNullable<typeof window.Plaid>["create"]> | null>(null);

  const openPlaid = useCallback(async () => {
    if (disabled) return;
    if (busy) return;
    if (openingRef.current) return;

    // Must consent first
    if (!consented) {
      setOpenConsent(true);
      return;
    }

    openingRef.current = true;
    setBusy(true);
    setConnecting(true);
    setErrorMsg(null);

    try {
      // 1) Get link token from backend
      const lt = await plaidLinkToken(businessId, accountId);
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

            if (accounts.length === 0) throw new Error("Plaid returned no accounts");

            // Open selection step (single account only)
            setPendingPublicToken(public_token);
            setPendingInstitution(institution);
            setPendingAccounts(accounts);
            setSelectedPlaidAccountId(accounts[0]?.id ?? "");
            setHistoryPreset("3");
            setCustomStart("");

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
      // if we returned early due to Plaid missing, busy must be cleared
      if (!handlerRef.current) {
        setBusy(false);
        openingRef.current = false;
      }
    }
  }, [accountId, businessId, busy, disabled, effectiveStartDate, onConnected, consented]);

  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        className={busy || disabled ? disabledClassName : buttonClassName}
        disabled={busy || !!disabled}
        onClick={openPlaid}
        title={busy ? "Working…" : undefined}
      >
        <Sparkles className="h-3.5 w-3.5" /> {busy ? "Opening…" : "Connect Plaid"}
      </button>

      {errorMsg ? <div className="mt-1 text-[11px] text-red-700">{errorMsg}</div> : null}

      <AppDialog
        open={openConsent}
        onClose={() => setOpenConsent(false)}
        title="Connect your bank securely"
        size="md"
      >
        <div className="p-3 max-h-[70vh] overflow-y-auto overflow-x-hidden">
          <div className="text-xs text-slate-700 leading-relaxed break-words">
            BynkBook uses Plaid to connect securely to your bank. We do not store your bank password.
          </div>

          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            Bank-level encryption • Read-only access • No password stored
          </div>

          <div className="mt-3 text-xs text-slate-700">
            We access:
            <ul className="list-disc ml-5 mt-1 text-slate-600">
              <li>Account name, type, and last 4 digits</li>
              <li>Transaction history (dates, amounts, merchant names)</li>
              <li>Current account balance</li>
            </ul>
          </div>

          <label className="mt-4 flex items-start gap-2 text-xs text-slate-700 min-w-0">
            <input
              type="checkbox"
              className="h-4 w-4 mt-0.5 shrink-0"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
            />
            <span className="min-w-0 break-words">
              I agree to share my financial data via Plaid as described above.
            </span>
          </label>

          <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
              onClick={() => setOpenConsent(false)}
            >
              Cancel
            </button>

            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 inline-flex items-center gap-2"
              disabled={!consented || busy || connecting}
              onClick={async () => {
                setOpenConsent(false);
                await openPlaid();
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

      {/* Step 2: select exactly one account + history window, then exchange */}
      <AppDialog
        open={openSelect}
        
        onClose={() => {
          setOpenSelect(false);
          setPendingPublicToken(null);
          setPendingInstitution(null);
          setPendingAccounts([]);
          setSelectedPlaidAccountId("");
        }}
        title="Choose account and history"
        size="md"
      >
        <div className="p-3 overflow-hidden max-h-[70vh]">
          <div className="text-xs text-slate-600">
            Select exactly one bank account to link to this BynkBook account.
          </div>

          <div className="mt-3 space-y-2">
            {pendingAccounts.map((a) => {
              const label = `${a.name ?? "Account"}${a.mask ? ` • ****${a.mask}` : ""}${a.subtype ? ` • ${a.subtype}` : a.type ? ` • ${a.type}` : ""}`;
              return (
                <label key={a.id} className="flex items-center gap-2 text-xs text-slate-800">
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

          <div className="mt-4">
            <div className="text-[11px] font-semibold text-slate-600 mb-1">History to fetch</div>
            <select
              className="h-8 w-full px-2 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:border-emerald-500"
              value={historyPreset}
              onChange={(e) => setHistoryPreset(e.target.value as any)}
            >
              <option value="1">Last 1 month</option>
              <option value="3">Last 3 months</option>
              <option value="6">Last 6 months</option>
              <option value="12">Last 12 months</option>
              <option value="custom">Custom start date</option>
            </select>

            {historyPreset === "custom" ? (
              <div className="mt-2">
                <div className="text-[11px] text-slate-600 mb-1">Start date (end date is today)</div>
                <input
                  type="date"
                  className="h-8 w-full px-2 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:border-emerald-500"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  max={endDate}
                />
              </div>
            ) : null}

            <div className="mt-2 text-[11px] text-slate-500">
              Opening balance will be labeled <span className="font-semibold">estimated</span> unless a statement opening is known.
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
              onClick={() => setOpenSelect(false)}
              disabled={busy}
            >
              Back
            </button>

            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              disabled={busy || !pendingPublicToken || !selectedPlaidAccountId}
              onClick={async () => {
                if (!pendingPublicToken || !selectedPlaidAccountId) return;

                const startDate =
                  historyPreset === "custom"
                    ? (customStart || effectiveStartDate)
                    : monthsBackStart(Number(historyPreset));

                setBusy(true);
                setErrorMsg(null);

                try {
                  const selected = pendingAccounts.find((x) => x.id === selectedPlaidAccountId);
                  const res = await plaidExchange(businessId, accountId, {
                    public_token: pendingPublicToken,
                    plaidAccountId: selectedPlaidAccountId,
                    effectiveStartDate: startDate,
                    endDate: endDate, // optional
                    institution: pendingInstitution ?? undefined,
                    mask: selected?.mask ?? undefined,
                  });

                  if (!res?.ok) throw new Error(res?.error ?? "Exchange failed");

                  setOpenSelect(false);
                  setPendingPublicToken(null);
                  setPendingInstitution(null);
                  setPendingAccounts([]);
                  setSelectedPlaidAccountId("");

                  // Immediately run initial sync (production-grade UX)
                  setOpenSyncing(true);
                  setSyncInfo(null);

                  let syncRes: any = null;
                  try {
                    const s: any = await plaidSync(businessId, accountId);
                    syncRes = s;
                    setSyncInfo({
                      newCount: Number(s?.newCount ?? 0),
                      pendingCount: Number(s?.pendingCount ?? 0),
                    });
                  } catch {
                    setSyncInfo({ newCount: 0, pendingCount: 0 });
                  } finally {
                    setOpenSyncing(false);
                  }

                  onConnected(syncRes);
                } catch (e: any) {
                  setErrorMsg(e?.message ?? "Plaid connection failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
      </AppDialog>

      {/* Initial sync progress dialog (separate, not nested) */}
      <AppDialog
        open={openSyncing}
        onClose={() => {}}
        title="Initial sync"
        size="sm"
      >
        <div className="p-3 overflow-hidden max-h-[70vh]">
          <div className="text-xs text-slate-700 flex items-center gap-2">
            <TinySpinner /> Syncing transactions…
          </div>

          <div className="mt-2 text-[11px] text-slate-500">
            This may take a moment on first connection.
          </div>

          {syncInfo ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">New</span>
                <span className="font-semibold text-slate-900">{syncInfo.newCount}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-slate-500">Pending</span>
                <span className="font-semibold text-slate-900">{syncInfo.pendingCount}</span>
              </div>
            </div>
          ) : null}
        </div>
      </AppDialog>
    </div>
  );
}
