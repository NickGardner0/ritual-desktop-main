"use client";

import {
  invokeDesktopCommand,
  openDesktopExternalUrl,
  openDesktopExternalUrlWithFallback,
} from "@/lib/desktop-bridge/commands";
import { isDesktopTauriRuntime } from "@/lib/desktop-bridge/environment";
import type {
  VoiceHudAnchorRect,
  VoiceSessionSource,
  VoiceSessionStartPayload,
  VoiceTarget,
} from "@/lib/voice/voice-session-contract";

export function isTauri(): boolean {
  return isDesktopTauriRuntime();
}

export async function ensureMicrophonePermission(): Promise<boolean> {
  if (!isDesktopTauriRuntime()) return true;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const alreadyGranted = await invoke<boolean>("check_native_microphone_permission").catch(() => false);
    if (alreadyGranted) return true;
    const grantedAfterPrompt = await invoke<boolean>("show_native_microphone_permission_dialog").catch(() => false);
    if (grantedAfterPrompt) return true;
    return await invoke<boolean>("check_native_microphone_permission").catch(() => false);
  } catch (error) {
    console.error("Failed to ensure microphone permission:", error);
    return false;
  }
}

let windowShown = false;

const DEFAULT_WINDOW_WIDTH = 1260;
const DEFAULT_WINDOW_HEIGHT = 770;
export const ONBOARDING_WINDOW_WIDTH = 800;
export const ONBOARDING_WINDOW_HEIGHT = 530;
export const ONBOARDING_HOME_WINDOW_WIDTH = 860;
export const ONBOARDING_HOME_WINDOW_HEIGHT = 570;
export const ONBOARDING_WELCOME_WINDOW_WIDTH = 860;
export const ONBOARDING_WELCOME_WINDOW_HEIGHT = 658;
export const ONBOARDING_SETUP_WINDOW_WIDTH = 594;
export const ONBOARDING_SETUP_WINDOW_HEIGHT = 763;
export const ONBOARDING_SIGNUP_WINDOW_WIDTH = 720;
export const ONBOARDING_SIGNUP_WINDOW_HEIGHT = 690;
export const ONBOARDING_CARD_WINDOW_WIDTH = 720;
export const ONBOARDING_CARD_WINDOW_HEIGHT = 500;

export async function showMainWindow(): Promise<void> {
  if (!isDesktopTauriRuntime() || windowShown) return;

  try {
    await invokeDesktopCommand("show_main_window");
    windowShown = true;
  } catch (error) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.setFocus();
      windowShown = true;
    } catch (fallbackError) {
      console.error("Failed to show main window:", fallbackError);
    }
  }
}

export async function openInBrowser(url: string): Promise<void> {
  if (!isDesktopTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    await openDesktopExternalUrl(url);
  } catch (error) {
    console.error("Failed to open URL in browser:", error);
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function openInBrowserFromDesktopAuth(url: string): Promise<void> {
  try {
    await openDesktopExternalUrlWithFallback(url, { preferNative: true });
  } catch (error) {
    console.error("Failed to open desktop auth URL in browser:", error);
    if (typeof window !== "undefined") {
      window.location.assign(url);
    }
  }
}

export type DesktopSettingsView =
  | "account"
  | "sounds"
  | "privacy"
  | "voice"
  | "computer-tracking"
  | "place-tagging"
  | "apple-health";

export type OpenDesktopVoiceHudPayload = {
  target: VoiceTarget;
  source: VoiceSessionSource;
  submitOnFinal?: false;
  anchorRect?: VoiceHudAnchorRect;
};

export type VoiceHotkeySettings = {
  enabled: boolean;
  shortcut: string;
  registered?: boolean;
  registrationError?: string | null;
};

export async function openDesktopSettingsWindow(
  initialView: DesktopSettingsView = "account",
): Promise<void> {
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await invokeDesktopCommand("open_settings_window", { initialView });
      return;
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Failed to open desktop settings window.");
}

export async function openDesktopVoiceHud(
  payload: OpenDesktopVoiceHudPayload,
): Promise<VoiceSessionStartPayload> {
  return invokeDesktopCommand("open_voice_hud", payload);
}

export async function hideDesktopVoiceHud(): Promise<void> {
  await invokeDesktopCommand("hide_voice_hud");
}

export async function getVoiceHotkeySettings(): Promise<VoiceHotkeySettings> {
  return invokeDesktopCommand("get_voice_hotkey_settings");
}

export async function setVoiceHotkeySettings(
  settings: VoiceHotkeySettings,
): Promise<VoiceHotkeySettings> {
  return invokeDesktopCommand("set_voice_hotkey_settings", { settings });
}

export type WindowResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

export async function syncSidebarGlassWidth(width: number): Promise<void> {
  if (!isDesktopTauriRuntime()) return;
  try {
    await invokeDesktopCommand("sync_sidebar_glass_width", { width });
  } catch {
    // Older desktop hosts do not clip native glass.
  }
}

export async function startWindowResizeDragging(
  direction: WindowResizeDirection,
): Promise<void> {
  if (!isDesktopTauriRuntime()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startResizeDragging(direction);
  } catch (error) {
    console.error("Failed to start window resize:", error);
  }
}

export async function resizeWindow(width: number, height: number): Promise<void> {
  if (!isDesktopTauriRuntime()) return;

  try {
    const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    await appWindow.setSize(new LogicalSize(width, height));
    await appWindow.center();
  } catch (error) {
    console.error("Failed to resize window:", error);
  }
}

export async function restoreDashboardWindowSize(): Promise<void> {
  await resizeWindow(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
}

export async function setStandardWindowSize(): Promise<void> {
  await resizeWindow(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
}

export async function setOnboardingWindowSize(
  height = ONBOARDING_WINDOW_HEIGHT,
  width = ONBOARDING_WINDOW_WIDTH,
): Promise<void> {
  await resizeWindow(width, height);
}

export async function setDashboardWindowSize(): Promise<void> {
  await resizeWindow(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
}
