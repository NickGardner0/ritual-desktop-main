"use client";

import { useEffect, useMemo, useState } from "react";
import { recordDesktopShellEvent } from "@/lib/desktop-bridge/observability";
import { isDesktopTauriRuntime } from "@/lib/desktop-bridge/environment";

const DESKTOP_ASSET_RECOVERY_STORAGE_KEY = "ritual:desktop-asset-recovery:v1";
const DESKTOP_ASSET_RECOVERY_COOLDOWN_MS = 30_000;
const DESKTOP_ASSET_RECOVERY_RELOAD_DELAY_MS = 200;

type RecoveryRecord = {
  at: number;
  path: string;
  source: string;
  signature: string;
};

type RecoveryWindow = Window & {
  __ritualDesktopAssetRecoveryPending__?: boolean;
};

export type DesktopAssetRecoveryMode = "none" | "scheduled" | "cooldown";

const RECOVERABLE_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Failed to load module script/i,
  /o\[e\]\.call/i,
  /__webpack_require__/i,
  /webpackChunk/i,
];

function collectErrorText(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return [value.name, value.message, value.stack].filter(Boolean).join("\n");
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];

    for (const key of ["name", "message", "stack"]) {
      const entry = record[key];
      if (typeof entry === "string" && entry.trim()) {
        parts.push(entry);
      }
    }

    if ("reason" in record) {
      const nested = collectErrorText(record.reason);
      if (nested) {
        parts.push(nested);
      }
    }

    if ("error" in record) {
      const nested = collectErrorText(record.error);
      if (nested) {
        parts.push(nested);
      }
    }

    if ("detail" in record) {
      const nested = collectErrorText(record.detail);
      if (nested) {
        parts.push(nested);
      }
    }

    if ("type" in record && typeof record.type === "string") {
      parts.push(record.type);
    }

    return parts.filter(Boolean).join("\n");
  }

  return String(value);
}

function readRecoveryRecord(): RecoveryRecord | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(DESKTOP_ASSET_RECOVERY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<RecoveryRecord>;
    if (
      typeof parsed?.at !== "number"
      || typeof parsed?.path !== "string"
      || typeof parsed?.source !== "string"
      || typeof parsed?.signature !== "string"
    ) {
      return null;
    }

    return parsed as RecoveryRecord;
  } catch {
    return null;
  }
}

function writeRecoveryRecord(record: RecoveryRecord) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      DESKTOP_ASSET_RECOVERY_STORAGE_KEY,
      JSON.stringify(record),
    );
  } catch {
    // Ignore storage failures. Reload still works without persisted cooldown state.
  }
}

export function getDesktopAssetRecoveryErrorText(errorLike: unknown): string {
  return collectErrorText(errorLike).trim();
}

export function isRecoverableDesktopAssetError(errorLike: unknown): boolean {
  const errorText = getDesktopAssetRecoveryErrorText(errorLike);
  if (!errorText) {
    return false;
  }

  return RECOVERABLE_ERROR_PATTERNS.some((pattern) => pattern.test(errorText));
}

export function scheduleDesktopAssetRecoveryReload(
  errorLike: unknown,
  source: string,
): DesktopAssetRecoveryMode {
  if (typeof window === "undefined" || !isDesktopTauriRuntime()) {
    return "none";
  }

  if (!isRecoverableDesktopAssetError(errorLike)) {
    return "none";
  }

  const recoveryWindow = window as RecoveryWindow;
  if (recoveryWindow.__ritualDesktopAssetRecoveryPending__) {
    return "cooldown";
  }

  const signature = getDesktopAssetRecoveryErrorText(errorLike).slice(0, 500);
  const now = Date.now();
  const currentPath = `${window.location.pathname}${window.location.search}`;
  const previous = readRecoveryRecord();

  if (
    previous
    && previous.path === currentPath
    && now - previous.at < DESKTOP_ASSET_RECOVERY_COOLDOWN_MS
  ) {
    return "cooldown";
  }

  recoveryWindow.__ritualDesktopAssetRecoveryPending__ = true;

  writeRecoveryRecord({
    at: now,
    path: currentPath,
    source,
    signature,
  });

  void recordDesktopShellEvent("desktop.asset_recovery.reload_scheduled", "warn", {
    source,
    path: currentPath,
    signature,
  });

  window.setTimeout(() => {
    window.location.reload();
  }, DESKTOP_ASSET_RECOVERY_RELOAD_DELAY_MS);

  return "scheduled";
}

export function useDesktopAssetRecovery(errorLike: unknown, source: string) {
  const errorText = useMemo(
    () => getDesktopAssetRecoveryErrorText(errorLike),
    [errorLike],
  );
  const recoverable = useMemo(
    () => isRecoverableDesktopAssetError(errorLike),
    [errorText],
  );
  const [mode, setMode] = useState<DesktopAssetRecoveryMode>("none");

  useEffect(() => {
    if (!recoverable) {
      setMode("none");
      return;
    }

    setMode(scheduleDesktopAssetRecoveryReload(errorLike, source));
  }, [errorLike, recoverable, source]);

  return {
    errorText,
    isRecoverable: recoverable,
    mode,
  };
}
