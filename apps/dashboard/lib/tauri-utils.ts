/**
 * Tauri utility functions for desktop app
 */

import {
  invokeDesktopCommand,
  openDesktopExternalUrl,
  openDesktopExternalUrlWithFallback,
} from '@/lib/desktop-bridge/commands';
import { isDesktopTauriRuntime } from '@/lib/desktop-bridge/environment';
import type {
  VoiceHudAnchorRect,
  VoiceSessionSource,
  VoiceSessionStartPayload,
  VoiceTarget,
} from '@/lib/voice/voice-session-contract';

/**
 * Check if the app is running in Tauri
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & {
    __TAURI__?: unknown;
    __TAURI_IPC__?: unknown;
    __TAURI_INTERNALS__?: { invoke?: unknown };
  };
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const hasTauriGlobal = Boolean(w.__TAURI__);
  const hasTauriIpc = Boolean(w.__TAURI_IPC__);
  const hasTauriInternals = typeof w.__TAURI_INTERNALS__?.invoke === 'function';
  const hasDesktopUA = userAgent.includes('RitualDesktop/');
  const result = isDesktopTauriRuntime();
  console.log(
    `[isTauri] result=${result} | __TAURI__=${hasTauriGlobal} | __TAURI_IPC__=${hasTauriIpc} | __TAURI_INTERNALS__.invoke=${hasTauriInternals} | UA=${hasDesktopUA} | userAgent="${userAgent.substring(0, 80)}"`,
  );
  return result;
}

/**
 * Ensure microphone access is granted in the Tauri desktop shell before using
 * browser media APIs. On the web we defer to the browser prompt directly.
 */
export async function ensureMicrophonePermission(): Promise<boolean> {
  if (!isTauri()) return true;

  try {
    const { invoke } = await import('@tauri-apps/api/core');

    const alreadyGranted = await invoke<boolean>('check_native_microphone_permission').catch(() => false);
    if (alreadyGranted) {
      return true;
    }

    const grantedAfterPrompt = await invoke<boolean>('show_native_microphone_permission_dialog').catch(() => false);
    if (grantedAfterPrompt) {
      return true;
    }

    return await invoke<boolean>('check_native_microphone_permission').catch(() => false);
  } catch (error) {
    console.error('Failed to ensure microphone permission:', error);
    return false;
  }
}

// Track if window has been shown to prevent multiple calls
let windowShown = false;

const DEFAULT_WINDOW_WIDTH = 1260;
const DEFAULT_WINDOW_HEIGHT = 770;
export const ONBOARDING_WINDOW_WIDTH = 800;
export const ONBOARDING_WINDOW_HEIGHT = 530;
export const ONBOARDING_HOME_WINDOW_WIDTH = 860;
export const ONBOARDING_HOME_WINDOW_HEIGHT = 570;
export const ONBOARDING_WELCOME_WINDOW_WIDTH = 860;
export const ONBOARDING_WELCOME_WINDOW_HEIGHT = 658;
export const ONBOARDING_SETUP_WINDOW_WIDTH = 516;
export const ONBOARDING_SETUP_WINDOW_HEIGHT = 680;
export const ONBOARDING_SIGNUP_WINDOW_WIDTH = 720;
export const ONBOARDING_SIGNUP_WINDOW_HEIGHT = 690;
export const ONBOARDING_CARD_WINDOW_WIDTH = 720;
export const ONBOARDING_CARD_WINDOW_HEIGHT = 500;

/**
 * Show the main Tauri window (called after React app is ready)
 * This prevents the "tiny window flash" by waiting until content is loaded
 * 
 * Uses the show_main_window Tauri command which handles showing and focusing.
 * Falls back to direct window API if the command isn't available.
 */
export async function showMainWindow(): Promise<void> {
  if (!isTauri() || windowShown) return;
  
  try {
    await invokeDesktopCommand('show_main_window');
    windowShown = true;
    console.log('✅ Main window shown via Tauri command');
  } catch (error) {
    // Fallback to direct window API
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.setFocus();
      windowShown = true;
      console.log('✅ Main window shown via window API fallback');
    } catch (fallbackError) {
      console.error('Failed to show main window:', fallbackError);
    }
  }
}

/**
 * Open a URL in the system's default browser (Tauri only)
 */
export async function openInBrowser(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  try {
    await openDesktopExternalUrl(url);
  } catch (error) {
    console.error('Failed to open URL in browser:', error);
    // Fallback to window.open
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function openInBrowserFromDesktopAuth(url: string): Promise<void> {
  try {
    await openDesktopExternalUrlWithFallback(url, { preferNative: true });
  } catch (error) {
    console.error('Failed to open desktop auth URL in browser:', error);
    if (typeof window !== 'undefined') {
      window.location.assign(url);
    }
  }
}

export type DesktopSettingsView = 'account' | 'sounds' | 'privacy' | 'voice' | 'computer-tracking' | 'place-tagging' | 'apple-health';

export async function openDesktopSettingsWindow(initialView: DesktopSettingsView = 'account'): Promise<void> {
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await invokeDesktopCommand('open_settings_window', { initialView });
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

  throw new Error('Failed to open native settings window.');
}

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

export async function openDesktopVoiceHud(payload: OpenDesktopVoiceHudPayload): Promise<VoiceSessionStartPayload> {
  return invokeDesktopCommand<VoiceSessionStartPayload>('open_voice_hud', payload);
}

export async function hideDesktopVoiceHud(): Promise<void> {
  await invokeDesktopCommand('hide_voice_hud');
}

export async function getVoiceHotkeySettings(): Promise<VoiceHotkeySettings> {
  return invokeDesktopCommand<VoiceHotkeySettings>('get_voice_hotkey_settings');
}

export async function setVoiceHotkeySettings(settings: VoiceHotkeySettings): Promise<VoiceHotkeySettings> {
  return invokeDesktopCommand<VoiceHotkeySettings>('set_voice_hotkey_settings', { settings });
}

/**
 * Resize the Tauri window
 */
export async function resizeWindow(width: number, height: number): Promise<void> {
  if (!isTauri()) {
    return;
  }

  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();
    await appWindow.setSize(new LogicalSize(width, height));
    await appWindow.center();
  } catch (error) {
    console.error('Failed to resize window:', error);
  }
}

export async function restoreDashboardWindowSize(): Promise<void> {
  if (!isTauri()) {
    return;
  }

  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();
    await appWindow.setSize(new LogicalSize(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT));
    await appWindow.center();
  } catch (error) {
    console.error('Failed to restore dashboard window size:', error);
  }
}

/**
 * Set window to standard size (used across all pages)
 */
export async function setStandardWindowSize(): Promise<void> {
  await resizeWindow(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
}

/**
 * Set window to compact size for onboarding
 */
export async function setOnboardingWindowSize(height = ONBOARDING_WINDOW_HEIGHT, width = ONBOARDING_WINDOW_WIDTH): Promise<void> {
  await resizeWindow(width, height);
}

/**
 * Set window to full size for dashboard
 */
export async function setDashboardWindowSize(): Promise<void> {
  await resizeWindow(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
}
