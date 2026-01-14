"use client";

import { useCallback, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { plaidExchange, plaidLinkToken } from "@/lib/api/plaid";

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
  effectiveStartDate: string; // YYYY-MM-DD
  disabledClassName: string;
  buttonClassName: string;
  disabled?: boolean;
  onConnected: () => void;
};

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Guard to prevent double-open on rapid clicks
  const openingRef = useRef(false);

  // Hold current link handler so we can exit/cleanup safely
  const handlerRef = useRef<ReturnType<NonNullable<typeof window.Plaid>["create"]> | null>(null);

  const openPlaid = useCallback(async () => {
    if (disabled) return;
    if (busy) return;
    if (openingRef.current) return;

    openingRef.current = true;
    setBusy(true);
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
            const plaidAccountId = metadata?.accounts?.[0]?.id;
            const institution = metadata?.institution
              ? { name: metadata.institution.name, institution_id: metadata.institution.institution_id }
              : undefined;

            if (!plaidAccountId) throw new Error("No Plaid account selected");

            const res = await plaidExchange(businessId, accountId, {
              public_token,
              plaidAccountId,
              effectiveStartDate,
              institution,
            });

            if (!res?.ok) throw new Error(res?.error ?? "Exchange failed");

            onConnected();
          } catch (e: any) {
            setErrorMsg(e?.message ?? "Plaid connection failed");
          } finally {
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
  }, [accountId, businessId, busy, disabled, effectiveStartDate, onConnected]);

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
    </div>
  );
}
