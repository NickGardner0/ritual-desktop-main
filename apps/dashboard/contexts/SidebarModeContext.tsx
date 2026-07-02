"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";

export type SidebarMode = "hidden" | "compact" | "hover" | "expanded";

interface SidebarModeContextValue {
  mode: SidebarMode;
  setMode: (mode: SidebarMode) => void;
}

const STORAGE_KEY = "ritual-sidebar-mode";
const BROADCAST_CHANNEL = "ritual-sidebar-mode";
const SIDEBAR_MODE_CHANGED_EVENT = "ritual-sidebar-mode-changed";
const SIDEBAR_MODES: SidebarMode[] = ["hidden", "compact", "hover", "expanded"];
const DEFAULT_MODE: SidebarMode = "expanded";

function parseSidebarMode(value: unknown): SidebarMode | null {
  return typeof value === "string" && SIDEBAR_MODES.includes(value as SidebarMode)
    ? (value as SidebarMode)
    : null;
}

function readStoredSidebarMode(): SidebarMode {
  try {
    return parseSidebarMode(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

const SidebarModeContext = createContext<SidebarModeContextValue>({
  mode: DEFAULT_MODE,
  setMode: () => {},
});

export function SidebarModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<SidebarMode>(DEFAULT_MODE);
  const broadcastRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    queueMicrotask(() => setModeState(readStoredSidebarMode()));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const applyMode = (value: unknown) => {
      const next = parseSidebarMode(value) ?? DEFAULT_MODE;
      setModeState(next);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        applyMode(event.newValue);
      } else if (event.key === null) {
        applyMode(DEFAULT_MODE);
      }
    };

    const handleCustomEvent = (event: Event) => {
      applyMode((event as CustomEvent<{ mode?: unknown }>).detail?.mode);
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(SIDEBAR_MODE_CHANGED_EVENT, handleCustomEvent);

    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL);
      channel.onmessage = (event) => applyMode(event.data?.mode);
      broadcastRef.current = channel;
    }

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(SIDEBAR_MODE_CHANGED_EVENT, handleCustomEvent);
      broadcastRef.current?.close();
      broadcastRef.current = null;
    };
  }, []);

  const setMode = useCallback((next: SidebarMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SIDEBAR_MODE_CHANGED_EVENT, { detail: { mode: next } }));
      try {
        broadcastRef.current?.postMessage({ mode: next });
      } catch {
        // ignore
      }
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
