"use client";

import { isDesktopTauriRuntime } from "@/lib/desktop-bridge/environment";

export async function invokeDesktopCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isDesktopTauriRuntime()) {
    throw new Error(`Desktop command "${command}" requires Ritual Desktop.`);
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function openDesktopExternalUrl(url: string): Promise<void> {
  if (!isDesktopTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const { open } = await import("@tauri-apps/plugin-shell");
  await open(url);
}
