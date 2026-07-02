"use client";

type DesktopWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_IPC__?: unknown;
  __TAURI_INTERNALS__?: {
    invoke?: unknown;
  };
};

export function hasDesktopTauriIpcBridge(): boolean {
  if (typeof window === "undefined") return false;

  const w = window as DesktopWindow;
  return (
    Boolean(w.__TAURI__) ||
    Boolean(w.__TAURI_IPC__) ||
    typeof w.__TAURI_INTERNALS__?.invoke === "function"
  );
}

export function hasRitualDesktopUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;

  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  return userAgent.includes("RitualDesktop/");
}

export function isDesktopTauriRuntime(): boolean {
  return hasDesktopTauriIpcBridge() || hasRitualDesktopUserAgent();
}
