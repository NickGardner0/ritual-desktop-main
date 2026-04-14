"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type SidebarMode = "hidden" | "compact" | "hover" | "expanded";

interface SidebarModeContextValue {
  mode: SidebarMode;
  setMode: (mode: SidebarMode) => void;
  toggleVisibility: () => void;
}

const STORAGE_KEY = "ritual-sidebar-mode";
const LAST_VISIBLE_STORAGE_KEY = "ritual-sidebar-last-visible-mode";
const DEFAULT_MODE: SidebarMode = "hover";
const DEFAULT_VISIBLE_MODE: Exclude<SidebarMode, "hidden"> = "hover";

const SidebarModeContext = createContext<SidebarModeContextValue>({
  mode: DEFAULT_MODE,
  setMode: () => {},
  toggleVisibility: () => {},
});

export function SidebarModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<SidebarMode>(DEFAULT_MODE);
  const [lastVisibleMode, setLastVisibleMode] = useState<Exclude<SidebarMode, "hidden">>(DEFAULT_VISIBLE_MODE);

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ["hidden", "compact", "hover", "expanded"].includes(stored)) {
        setModeState(stored as SidebarMode);
      }
      const storedLastVisible = localStorage.getItem(LAST_VISIBLE_STORAGE_KEY);
      if (storedLastVisible && ["compact", "hover", "expanded"].includes(storedLastVisible)) {
        setLastVisibleMode(storedLastVisible as Exclude<SidebarMode, "hidden">);
      }
    } catch {
      // SSR or localStorage unavailable
    }
  }, []);

  const setMode = useCallback((next: SidebarMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      if (next !== "hidden") {
        localStorage.setItem(LAST_VISIBLE_STORAGE_KEY, next);
        setLastVisibleMode(next);
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleVisibility = useCallback(() => {
    setModeState((current) => {
      const next = current === "hidden" ? lastVisibleMode : "hidden";
      try {
        localStorage.setItem(STORAGE_KEY, next);
        if (next !== "hidden") {
          localStorage.setItem(LAST_VISIBLE_STORAGE_KEY, next);
        }
      } catch {
        // ignore
      }
      return next;
    });
  }, [lastVisibleMode]);

  return (
    <SidebarModeContext.Provider value={{ mode, setMode, toggleVisibility }}>
      {children}
    </SidebarModeContext.Provider>
  );
}

export function useSidebarMode() {
  return useContext(SidebarModeContext);
}
