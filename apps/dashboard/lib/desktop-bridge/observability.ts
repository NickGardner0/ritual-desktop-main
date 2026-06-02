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
