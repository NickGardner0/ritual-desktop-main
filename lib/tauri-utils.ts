/**
 * Tauri utility functions for desktop app
 */

/**
 * Check if the app is running in Tauri
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI__' in window;
}

/**
 * Open a URL in the system's default browser (Tauri only)
 */
export async function openInBrowser(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank');
    return;
  }

  try {
    const { shell } = await import('@tauri-apps/api');
    await shell.open(url);
  } catch (error) {
    console.error('Failed to open URL in browser:', error);
    // Fallback to window.open
    window.open(url, '_blank');
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
    const { appWindow } = await import('@tauri-apps/api/window');
    const { LogicalSize } = await import('@tauri-apps/api/window');
    await appWindow.setSize(new LogicalSize(width, height));
    await appWindow.center();
  } catch (error) {
    console.error('Failed to resize window:', error);
  }
}

/**
 * Set window to standard size (used across all pages)
 */
export async function setStandardWindowSize(): Promise<void> {
  // 1100x800 is the preferred size
  await resizeWindow(1100, 800);
}

/**
 * Set window to compact size for onboarding
 */
export async function setOnboardingWindowSize(): Promise<void> {
  // 1100x800 is the preferred size
  await resizeWindow(1100, 800);
}

/**
 * Set window to full size for dashboard
 */
export async function setDashboardWindowSize(): Promise<void> {
  // 1100x800 is the preferred size
  await resizeWindow(1100, 800);
}

