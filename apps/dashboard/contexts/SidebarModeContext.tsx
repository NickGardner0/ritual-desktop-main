"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type SidebarMode = "compact" | "hover" | "expanded";

interface SidebarModeContextValue {
  mode: SidebarMode;
  setMode: (mode: SidebarMode) => void;
}

const STORAGE_KEY = "ritual-sidebar-mode";
const DEFAULT_MODE: SidebarMode = "hover";

const SidebarModeContext = createContext<SidebarModeContextValue>({
  mode: DEFAULT_MODE,
  setMode: () => {},
});

export function SidebarModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<SidebarMode>(DEFAULT_MODE);

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ["compact", "hover", "expanded"].includes(stored)) {
        queueMicrotask(() => setModeState(stored as SidebarMode));
      } else if (stored === "hidden") {
        localStorage.setItem(STORAGE_KEY, DEFAULT_MODE);
      }
    } catch {
      // SSR or localStorage unavailable
    }
  }, []);

  const setMode = useCallback((next: SidebarMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  return (
    <SidebarModeContext.Provider value={{ mode, setMode }}>
      {children}
    </SidebarModeContext.Provider>
  );
}

export function useSidebarMode() {
  return useContext(SidebarModeContext);
}
