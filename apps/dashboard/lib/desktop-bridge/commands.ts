"use client";

import {
  hasDesktopTauriIpcBridge,
  isDesktopTauriRuntime,
} from "@/lib/desktop-bridge/environment";
import {
  getDesktopProfilingBridgeBase,
  invokeDesktopProfilingBridgeCommand,
} from "@/lib/desktop-bridge/profiling-bridge";

type OpenDesktopExternalUrlOptions = {
  preferNative?: boolean;
};

export async function invokeDesktopCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (hasDesktopTauriIpcBridge()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(command, args);
  }

  const profilingBridgeBase = getDesktopProfilingBridgeBase();
  if (profilingBridgeBase) {
    return invokeDesktopProfilingBridgeCommand<T>(command, args, profilingBridgeBase);
  }

  if (!isDesktopTauriRuntime()) {
    throw new Error(`Desktop command "${command}" requires Ritual Desktop.`);
  }

  throw new Error(
    `Desktop command "${command}" requires native Tauri IPC or the local profiling bridge.`,
  );
}

export async function openDesktopExternalUrl(url: string): Promise<void> {
  if (!hasDesktopTauriIpcBridge()) {
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

  if (!preferNative && !hasDesktopTauriIpcBridge()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    if (!hasDesktopTauriIpcBridge()) {
      throw new Error("Native Tauri IPC is unavailable.");
    }
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
