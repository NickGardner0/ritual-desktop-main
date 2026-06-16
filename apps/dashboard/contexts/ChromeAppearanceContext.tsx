"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ChromeAppearance = "frosted" | "white" | "zed";

type ChromeAppearanceOption = {
  value: ChromeAppearance;
  label: string;
  description: string;
};

type ChromeAppearanceContextValue = {
  appearance: ChromeAppearance;
  setAppearance: (appearance: ChromeAppearance) => void;
  selectedOption: ChromeAppearanceOption;
};

export const CHROME_APPEARANCE_OPTIONS: ChromeAppearanceOption[] = [
  {
    value: "frosted",
    label: "Frosted",
    description: "Current transparent glass chrome",
  },
  {
    value: "white",
    label: "White",
    description: "Opaque white titlebar and sidebar",
  },
  {
    value: "zed",
    label: "Zed Grey",
    description: "Warm neutral grey inspired by Zed",
  },
];

const STORAGE_KEY = "ritual-chrome-appearance";
const DEFAULT_APPEARANCE: ChromeAppearance = "frosted";

const chromeVariables: Record<ChromeAppearance, Record<string, string>> = {
  frosted: {
    "--sidebar-vibrancy-bg": "rgba(255, 255, 255, 0.34)",
    "--sidebar-vibrancy-border": "rgba(15, 23, 42, 0.06)",
    "--sidebar-vibrancy-selected": "rgba(255, 255, 255, 0.38)",
    "--titlebar-glass-bg": "rgba(255, 255, 255, 0.46)",
    "--titlebar-glass-bg-strong": "rgba(255, 255, 255, 0.62)",
    "--titlebar-glass-control-bg": "rgba(255, 255, 255, 0.42)",
    "--titlebar-glass-control-hover-bg": "rgba(255, 255, 255, 0.58)",
    "--titlebar-glass-control-active-bg": "rgba(255, 255, 255, 0.74)",
    "--titlebar-glass-control-border": "rgba(15, 23, 42, 0.06)",
    "--titlebar-glass-control-text": "rgba(17, 24, 39, 0.66)",
    "--titlebar-glass-control-text-muted": "rgba(17, 24, 39, 0.46)",
    "--titlebar-glass-control-text-active": "rgba(17, 24, 39, 0.92)",
    "--titlebar-glass-border": "rgba(15, 23, 42, 0.052)",
    "--titlebar-glass-highlight": "rgba(255, 255, 255, 0.24)",
    "--titlebar-glass-filter": "saturate(1.08) blur(24px)",
  },
  white: {
    "--sidebar-vibrancy-bg": "#ffffff",
    "--sidebar-vibrancy-border": "rgba(15, 23, 42, 0.045)",
    "--sidebar-vibrancy-selected": "rgba(15, 23, 42, 0.052)",
    "--titlebar-glass-bg": "#ffffff",
    "--titlebar-glass-bg-strong": "#ffffff",
    "--titlebar-glass-control-bg": "rgba(255, 255, 255, 0.72)",
    "--titlebar-glass-control-hover-bg": "rgba(15, 23, 42, 0.045)",
    "--titlebar-glass-control-active-bg": "rgba(15, 23, 42, 0.07)",
    "--titlebar-glass-control-border": "rgba(15, 23, 42, 0.055)",
    "--titlebar-glass-control-text": "rgba(17, 24, 39, 0.66)",
    "--titlebar-glass-control-text-muted": "rgba(17, 24, 39, 0.44)",
    "--titlebar-glass-control-text-active": "rgba(17, 24, 39, 0.9)",
    "--titlebar-glass-border": "rgba(15, 23, 42, 0.045)",
    "--titlebar-glass-highlight": "rgba(255, 255, 255, 0)",
    "--titlebar-glass-filter": "none",
  },
  zed: {
    "--sidebar-vibrancy-bg": "#eeeeec",
    "--sidebar-vibrancy-border": "rgba(15, 23, 42, 0.075)",
    "--sidebar-vibrancy-selected": "rgba(15, 23, 42, 0.055)",
    "--titlebar-glass-bg": "#eeeeec",
    "--titlebar-glass-bg-strong": "#eeeeec",
    "--titlebar-glass-control-bg": "rgba(255, 255, 255, 0.18)",
    "--titlebar-glass-control-hover-bg": "rgba(15, 23, 42, 0.055)",
    "--titlebar-glass-control-active-bg": "rgba(15, 23, 42, 0.082)",
    "--titlebar-glass-control-border": "rgba(15, 23, 42, 0.07)",
    "--titlebar-glass-control-text": "rgba(76, 82, 88, 0.78)",
    "--titlebar-glass-control-text-muted": "rgba(76, 82, 88, 0.58)",
    "--titlebar-glass-control-text-active": "rgba(60, 65, 70, 0.94)",
    "--titlebar-glass-border": "rgba(15, 23, 42, 0.075)",
    "--titlebar-glass-highlight": "rgba(255, 255, 255, 0)",
    "--titlebar-glass-filter": "none",
  },
};

const ChromeAppearanceContext = createContext<ChromeAppearanceContextValue | undefined>(undefined);

function isChromeAppearance(value: string | null): value is ChromeAppearance {
  return value === "frosted" || value === "white" || value === "zed";
}

export function ChromeAppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<ChromeAppearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isChromeAppearance(stored)) {
        queueMicrotask(() => setAppearanceState(stored));
      }
    } catch {
      // localStorage can be unavailable in test or constrained browser contexts.
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    root.dataset.chromeAppearance = appearance;
    Object.entries(chromeVariables[appearance]).forEach(([property, value]) => {
      root.style.setProperty(property, value);
    });
  }, [appearance]);

  const setAppearance = useCallback((next: ChromeAppearance) => {
    setAppearanceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore persistence failures and keep the in-memory preference.
    }
  }, []);

  const selectedOption = useMemo(
    () => CHROME_APPEARANCE_OPTIONS.find((option) => option.value === appearance) ?? CHROME_APPEARANCE_OPTIONS[0],
    [appearance],
  );

  return (
    <ChromeAppearanceContext.Provider value={{ appearance, setAppearance, selectedOption }}>
      {children}
    </ChromeAppearanceContext.Provider>
  );
}

export function useChromeAppearance() {
  const context = useContext(ChromeAppearanceContext);
  if (!context) {
    throw new Error("useChromeAppearance must be used within a ChromeAppearanceProvider");
  }
  return context;
}
