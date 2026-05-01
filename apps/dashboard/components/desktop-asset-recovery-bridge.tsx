"use client";

import { useEffect } from "react";
import { scheduleDesktopAssetRecoveryReload } from "@/lib/desktop-asset-recovery";
import { isDesktopTauriRuntime } from "@/lib/desktop-bridge/environment";

export function DesktopAssetRecoveryBridge() {
  useEffect(() => {
    if (!isDesktopTauriRuntime()) {
      return;
    }

    const handleWindowError = (event: ErrorEvent) => {
      const mode = scheduleDesktopAssetRecoveryReload(
        event.error ?? event.message ?? event,
        "window.error",
      );

      if (mode === "scheduled") {
        event.preventDefault();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const mode = scheduleDesktopAssetRecoveryReload(
        event.reason ?? event,
        "window.unhandledrejection",
      );

      if (mode === "scheduled") {
        event.preventDefault();
      }
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
