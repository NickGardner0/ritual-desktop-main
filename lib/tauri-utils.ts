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

