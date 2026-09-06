"use client";

import {
  hasDesktopTauriIpcBridge,
  isDesktopTauriRuntime,
} from "@/lib/desktop-bridge/environment";
import type {
  NativeCommandInputs,
  NativeCommandName,
  NativeCommandOutputs,
} from "@/lib/native-gateway-commands.generated";

type OpenDesktopExternalUrlOptions = {
  preferNative?: boolean;
};

export async function invokeDesktopCommand<
  T = never,
  K extends NativeCommandName = NativeCommandName,
>(
  command: K,
  args?: NativeCommandInputs[K],
): Promise<[T] extends [never] ? NativeCommandOutputs[K] : T> {
  if (hasDesktopTauriIpcBridge()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(command, args) as Promise<[T] extends [never] ? NativeCommandOutputs[K] : T>;
  }

  if (!isDesktopTauriRuntime()) {
    throw new Error(`Desktop command "${command}" requires Ritual Desktop.`);
  }

  throw new Error(`Desktop command "${command}" requires native Tauri IPC.`);
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
