"use client";

export const DESKTOP_PROFILING_BRIDGE_STORAGE_KEY = "ritual:desktop-profiling-bridge-base";
export const DESKTOP_PROFILING_BRIDGE_ENABLED_STORAGE_KEY = "ritual:desktop-profiling-bridge";
export const DEFAULT_DESKTOP_PROFILING_BRIDGE_BASE = "http://127.0.0.1:3031";

function isLocalBridgeUrl(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
  );
}

export function normalizeDesktopProfilingBridgeBase(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (!isLocalBridgeUrl(url)) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getDesktopProfilingBridgeBase(): string | null {
  const envBase = normalizeDesktopProfilingBridgeBase(
    process.env.NEXT_PUBLIC_RITUAL_DESKTOP_PROFILING_BRIDGE_BASE,
  );
  if (envBase) return envBase;

  if (typeof window === "undefined") return null;

  try {
    const storedBase = normalizeDesktopProfilingBridgeBase(
      window.localStorage.getItem(DESKTOP_PROFILING_BRIDGE_STORAGE_KEY),
    );
    if (storedBase) return storedBase;

    const enabled = window.localStorage.getItem(DESKTOP_PROFILING_BRIDGE_ENABLED_STORAGE_KEY);
    return enabled === "1" || enabled === "true"
      ? DEFAULT_DESKTOP_PROFILING_BRIDGE_BASE
      : null;
  } catch {
    return null;
  }
}

export function buildDesktopProfilingBridgeCommandUrl(baseUrl: string, command: string): string {
  return `${baseUrl}/v1/tauri/${encodeURIComponent(command)}`;
}

export async function invokeDesktopProfilingBridgeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
  baseUrl = getDesktopProfilingBridgeBase(),
): Promise<T> {
  if (!baseUrl) {
    throw new Error(`Desktop profiling bridge is not configured for "${command}".`);
  }

  const response = await fetch(buildDesktopProfilingBridgeCommandUrl(baseUrl, command), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ args: args || {} }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.error || payload?.message || `Desktop profiling bridge command failed: ${response.status}`,
    );
  }

  return (payload && Object.prototype.hasOwnProperty.call(payload, "result")
    ? payload.result
    : payload) as T;
}
