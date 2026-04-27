"use client";

import { isDesktopTauriRuntime } from "@/lib/desktop-bridge/environment";

type OpenDesktopExternalUrlOptions = {
  preferNative?: boolean;
};

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

export async function openDesktopExternalUrlWithFallback(
  url: string,
  options: OpenDesktopExternalUrlOptions = {},
): Promise<void> {
  const { preferNative = false } = options;

  if (!preferNative && !isDesktopTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  } catch (error) {
    if (!preferNative) {
      throw error;
    }
  }

  if (typeof window !== "undefined") {
    window.location.assign(url);
  }
}
