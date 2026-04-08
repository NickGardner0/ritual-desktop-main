"use client";

import { invokeDesktopCommand } from "@/lib/desktop-bridge/commands";
import { isDesktopTauriRuntime } from "@/lib/desktop-bridge/environment";

export type DesktopShellEventLevel = "info" | "warn" | "error";

export async function recordDesktopShellEvent(
  name: string,
  level: DesktopShellEventLevel = "info",
  data?: Record<string, unknown> | null,
): Promise<void> {
  if (!isDesktopTauriRuntime()) return;

  try {
    await invokeDesktopCommand("desktop_record_shell_event", {
      name,
      level,
      data: data ?? null,
    });
  } catch (error) {
    console.warn("Desktop shell event logging failed:", error);
  }
}
