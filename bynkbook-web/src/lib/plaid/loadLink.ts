let pending: Promise<void> | null = null;
const src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

/** Share concurrent loads; failed or stalled loads remain retryable. */
export function loadPlaidLink(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Open bank connection in a browser"));
  if (window.Plaid?.create) return Promise.resolve();
  if (pending) return pending;
  pending = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const script = existing ?? document.createElement("script");
    const cleanup = () => {
      clearTimeout(timer);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error("Bank connection could not load. Check your connection and try again."));
    };
    const loaded = () => {
      if (!window.Plaid?.create) return failed();
      cleanup();
      resolve();
    };
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    const timer = setTimeout(failed, 15_000);
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}
