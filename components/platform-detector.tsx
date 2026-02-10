"use client";

import { useLayoutEffect } from "react";

/**
 * Detects the OS platform and sets a `data-platform` attribute on <html>.
 * This allows CSS to gate macOS-only vibrancy styles with
 * `html[data-platform="macos"]`.
 *
 * Uses navigator.platform (synchronous, no Tauri allowlist needed).
 * Renders nothing — side-effect only.
 */
export function PlatformDetector() {
  useLayoutEffect(() => {
    const ua = navigator.userAgent ?? "";
    const nav = navigator.platform ?? "";
    if (nav.startsWith("Mac") || ua.includes("Macintosh")) {
      document.documentElement.dataset.platform = "macos";
    } else if (nav.startsWith("Win")) {
      document.documentElement.dataset.platform = "windows";
    } else {
      document.documentElement.dataset.platform = "linux";
    }
  }, []);

  return null;
}
