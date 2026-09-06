"use client";

import { invokeDesktopCommand } from "@/lib/desktop-bridge/commands";
import { isDesktopTauriRuntime } from "@/lib/desktop-bridge/environment";

export type DesktopShellEventLevel = "info" | "warn" | "error";

const REDACTED = "[redacted]";

function normalizeSensitiveKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeSensitiveKey(key);
  return (
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("cookie") ||
    normalized === "auth" ||
    normalized === "authorization" ||
    normalized === "ticket" ||
    normalized === "code" ||
    normalized === "state" ||
    normalized === "session" ||
    normalized === "rawurl"
  );
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = normalizeSensitiveKey(key);
  return (
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("cookie") ||
    normalized === "auth" ||
    normalized === "authorization" ||
    normalized === "ticket" ||
    normalized === "code" ||
    normalized === "state" ||
    normalized === "session" ||
    normalized === "jwt"
  );
}

function looksLikeSecretValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const jwtLike = trimmed.length > 80 && trimmed.split(".").length === 3;
  const tokenLike = /^[A-Za-z0-9_=\-.:/+]+$/.test(trimmed);
  return jwtLike || (trimmed.length > 120 && tokenLike);
}

function redactSensitiveUrlLikeString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  const queryStart = trimmed.indexOf("?");
  if (queryStart === -1) {
    return looksLikeSecretValue(trimmed) ? REDACTED : value;
  }

  const prefix = trimmed.slice(0, queryStart + 1);
  const queryAndFragment = trimmed.slice(queryStart + 1);
  const fragmentStart = queryAndFragment.indexOf("#");
  const query = fragmentStart === -1 ? queryAndFragment : queryAndFragment.slice(0, fragmentStart);
  const fragment = fragmentStart === -1 ? "" : queryAndFragment.slice(fragmentStart);
  const redactedQuery = query
    .split("&")
    .map((part) => {
      const equalsIndex = part.indexOf("=");
      if (equalsIndex === -1) {
        return isSensitiveQueryKey(part) ? `${part}=${REDACTED}` : part;
      }
      const key = part.slice(0, equalsIndex);
      const paramValue = part.slice(equalsIndex + 1);
      if (isSensitiveQueryKey(key) || looksLikeSecretValue(paramValue)) {
        return `${key}=${REDACTED}`;
      }
      return part;
    })
    .join("&");

  return `${prefix}${redactedQuery}${fragment}`;
}

function sanitizeDesktopShellEventValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key && isSensitiveKey(key)) {
      return value.includes("?") ? redactSensitiveUrlLikeString(value) : REDACTED;
    }
    return redactSensitiveUrlLikeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDesktopShellEventValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeDesktopShellEventValue(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

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
      data: data == null ? null : sanitizeDesktopShellEventValue(data),
    });
  } catch (error) {
    console.warn("Desktop shell event logging failed:", error);
  }
}

const launchMarks = new Map<string, number>();

export function recordLaunchMilestone(
  name: string,
  extra?: Record<string, unknown>,
): void {
  if (typeof performance === "undefined") return;
  const now = performance.now();
  if (!launchMarks.has("navigationStart")) {
    launchMarks.set("navigationStart", 0);
    performance.mark("ritual:launch:navigationStart");
  }
  launchMarks.set(name, now);
  try {
    performance.mark(`ritual:launch:${name}`);
  } catch {
    // Ignore duplicate marks in Fast Refresh.
  }
  void recordDesktopShellEvent(`launch:${name}`, "info", {
    elapsed_ms: Number(now.toFixed(2)),
    ...processTelemetry(),
    ...extra,
  });
}

export function getLaunchMilestones(): Record<string, number> {
  return Object.fromEntries(launchMarks);
}

const LAUNCH_SAMPLE_KEY = "ritual:launch-medians:v1";
const LAUNCH_KIND_KEY = "ritual:launch-kind";

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
    : sorted[mid];
}

export type LaunchMedianSummary = {
  kind: "cold" | "warm";
  samples: number;
  milestones: Record<string, { last_ms: number; median_ms: number | null }>;
};

export function summarizeLaunchMilestones(): LaunchMedianSummary | null {
  if (typeof window === "undefined" || typeof performance === "undefined") return null;
  const kind: "cold" | "warm" = window.sessionStorage.getItem(LAUNCH_KIND_KEY) ? "warm" : "cold";
  window.sessionStorage.setItem(LAUNCH_KIND_KEY, kind);

  const current = getLaunchMilestones();
  let stored: { cold: Record<string, number[]>; warm: Record<string, number[]> } = { cold: {}, warm: {} };
  try {
    stored = JSON.parse(window.localStorage.getItem(LAUNCH_SAMPLE_KEY) || "null") || stored;
  } catch {
    stored = { cold: {}, warm: {} };
  }

  const bucket = stored[kind];
  for (const [name, value] of Object.entries(current)) {
    const next = [...(bucket[name] || []), value].slice(-20);
    bucket[name] = next;
  }
  window.localStorage.setItem(LAUNCH_SAMPLE_KEY, JSON.stringify(stored));

  const milestones: LaunchMedianSummary["milestones"] = {};
  for (const [name, value] of Object.entries(current)) {
    milestones[name] = {
      last_ms: Number(value.toFixed(2)),
      median_ms: median(bucket[name] || []),
    };
  }

  return {
    kind,
    samples: Math.max(0, ...Object.values(bucket).map((item) => item.length)),
    milestones,
  };
}

function processTelemetry(): Record<string, unknown> {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return {
    heap_used_bytes: memory?.usedJSHeapSize ?? null,
    hardware_concurrency: typeof navigator === "undefined" ? null : navigator.hardwareConcurrency,
    hidden: typeof document === "undefined" ? null : document.visibilityState !== "visible",
  };
}

