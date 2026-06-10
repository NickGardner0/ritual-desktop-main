/**
 * Tauri utility functions for desktop app
 */

import {
  invokeDesktopCommand,
  openDesktopExternalUrl,
  openDesktopExternalUrlWithFallback,
} from '@/lib/desktop-bridge/commands';
import { isDesktopTauriRuntime } from '@/lib/desktop-bridge/environment';

/**
 * Check if the app is running in Tauri
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI__?: unknown; __TAURI_IPC__?: unknown };
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const hasTauriGlobal = Boolean(w.__TAURI__);
  const hasTauriIpc = Boolean(w.__TAURI_IPC__);
  const hasDesktopUA = userAgent.includes('RitualDesktop/');
  const result = isDesktopTauriRuntime();
  console.log(`[isTauri] result=${result} | __TAURI__=${hasTauriGlobal} | __TAURI_IPC__=${hasTauriIpc} | UA=${hasDesktopUA} | userAgent="${userAgent.substring(0, 80)}"`);
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

const DEFAULT_WINDOW_WIDTH = 1150;
const DEFAULT_WINDOW_HEIGHT = 800;
const DASHBOARD_WINDOW_SIZE_STORAGE_KEY = 'ritual:dashboard-window-size';
const MIN_DASHBOARD_WINDOW_WIDTH = 800;
const MIN_DASHBOARD_WINDOW_HEIGHT = 450;
export const ONBOARDING_WINDOW_WIDTH = 800;
export const ONBOARDING_WINDOW_HEIGHT = 530;
export const ONBOARDING_WELCOME_WINDOW_HEIGHT = 612;
export const ONBOARDING_SIGNUP_WINDOW_HEIGHT = 640;
export const ONBOARDING_CARD_WINDOW_WIDTH = 720;
export const ONBOARDING_CARD_WINDOW_HEIGHT = 500;

type StoredWindowSize = {
  width: number;
  height: number;
};

function readStoredDashboardWindowSize(): StoredWindowSize | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(DASHBOARD_WINDOW_SIZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredWindowSize>;
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width < MIN_DASHBOARD_WINDOW_WIDTH || height < MIN_DASHBOARD_WINDOW_HEIGHT) return null;
    return { width, height };
  } catch {
    return null;
  }
}

function storeDashboardWindowSize(size: StoredWindowSize): void {
  if (typeof window === 'undefined') return;
  if (size.width < MIN_DASHBOARD_WINDOW_WIDTH || size.height < MIN_DASHBOARD_WINDOW_HEIGHT) return;

  window.localStorage.setItem(
    DASHBOARD_WINDOW_SIZE_STORAGE_KEY,
    JSON.stringify({
      width: Math.round(size.width),
      height: Math.round(size.height),
    }),
  );
}

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
    const stored = readStoredDashboardWindowSize();

    if (stored) {
      await appWindow.setSize(new LogicalSize(stored.width, stored.height));
      return;
    }

    const scaleFactor = await appWindow.scaleFactor().catch(() => 1);
    const currentPhysicalSize = await appWindow.innerSize();
    const currentLogicalSize = currentPhysicalSize.toLogical(scaleFactor);
    const shouldRestoreDefault =
      currentLogicalSize.width < DEFAULT_WINDOW_WIDTH ||
      currentLogicalSize.height < DEFAULT_WINDOW_HEIGHT;

    if (shouldRestoreDefault) {
      await appWindow.setSize(new LogicalSize(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT));
      await appWindow.center();
    }
  } catch (error) {
    console.error('Failed to restore dashboard window size:', error);
  }
}

export async function watchDashboardWindowSize(): Promise<() => void> {
  if (!isTauri()) {
    return () => undefined;
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();
    let persistTimer: number | null = null;

    const unlisten = await appWindow.onResized(({ payload }) => {
      if (persistTimer !== null) {
        window.clearTimeout(persistTimer);
      }

      persistTimer = window.setTimeout(async () => {
        try {
          const scaleFactor = await appWindow.scaleFactor().catch(() => 1);
          const logicalSize = typeof payload.toLogical === 'function'
            ? payload.toLogical(scaleFactor)
            : {
                width: payload.width / scaleFactor,
                height: payload.height / scaleFactor,
              };
          storeDashboardWindowSize(logicalSize);
        } catch (error) {
          console.error('Failed to persist dashboard window size:', error);
        }
      }, 250);
    });

    return () => {
      if (persistTimer !== null) {
        window.clearTimeout(persistTimer);
      }
      unlisten();
    };
  } catch (error) {
    console.error('Failed to watch dashboard window size:', error);
    return () => undefined;
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
