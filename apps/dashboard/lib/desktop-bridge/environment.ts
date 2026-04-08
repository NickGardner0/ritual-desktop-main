"use client";

export function isDesktopTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;

  const w = window as Window & { __TAURI__?: unknown; __TAURI_IPC__?: unknown };
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";

  return Boolean(w.__TAURI__) || Boolean(w.__TAURI_IPC__) || userAgent.includes("RitualDesktop/");
}
