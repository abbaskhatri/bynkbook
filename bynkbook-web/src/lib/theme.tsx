"use client";

import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "bynkbook-theme";

const THEME_VALUES: ThemePreference[] = ["light", "dark", "system"];

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const themeSubscribers = new Set<() => void>();

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && THEME_VALUES.includes(value as ThemePreference);
}

function systemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function applyThemePreference(preference: ThemePreference) {
  if (typeof document === "undefined") return;

  const shouldUseDark = preference === "dark" || (preference === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", shouldUseDark);
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "light";

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "light";
  } catch {
    return "light";
  }
}

function getServerPreference(): ThemePreference {
  return "light";
}

function emitThemePreferenceChange() {
  themeSubscribers.forEach((listener) => listener());
}

function subscribeThemePreference(listener: () => void) {
  if (typeof window === "undefined") return () => {};

  themeSubscribers.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;

    applyThemePreference(readStoredPreference());
    listener();
  };

  window.addEventListener("storage", onStorage);
  return () => {
    themeSubscribers.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(
    subscribeThemePreference,
    readStoredPreference,
    getServerPreference
  );

  useEffect(() => {
    applyThemePreference(preference);
  }, [preference]);

  useEffect(() => {
    if (preference !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemePreference("system");

    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      setPreference: (nextPreference) => {
        applyThemePreference(nextPreference);

        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
        } catch {}

        emitThemePreferenceChange();
      },
    }),
    [preference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePreference() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useThemePreference must be used within ThemeProvider");
  }

  return value;
}
