'use client';

const READ_CONSISTENCY_KEY = 'ritual:force-fresh-read:v1';
const DEFAULT_READ_CONSISTENCY_MS = 20_000;

type ReadConsistencyState = Record<string, number>;

function readState(): ReadConsistencyState {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.sessionStorage.getItem(READ_CONSISTENCY_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ReadConsistencyState;
  } catch {
    return {};
  }
}

function writeState(next: ReadConsistencyState): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(READ_CONSISTENCY_KEY, JSON.stringify(next));
  } catch {
    // Best effort only.
  }
}

export function markReadConsistencyRequired(
  userId?: string | null,
  durationMs = DEFAULT_READ_CONSISTENCY_MS,
): void {
  if (!userId || typeof window === 'undefined') return;

  const next = readState();
  next[userId] = Date.now() + durationMs;
  writeState(next);
}

export function clearReadConsistencyRequirement(userId?: string | null): void {
  if (!userId || typeof window === 'undefined') return;

  const next = readState();
  delete next[userId];
  writeState(next);
}

export function shouldForceFreshRead(userId?: string | null): boolean {
  if (typeof window === 'undefined') return false;

  const next = readState();
  const now = Date.now();

  if (userId) {
    const expiresAt = Number(next[userId] || 0);
    if (expiresAt <= 0) return false;
    if (expiresAt > now) return true;
    delete next[userId];
    writeState(next);
    return false;
  }

  let hasActiveEntry = false;
  let mutated = false;
  Object.entries(next).forEach(([key, value]) => {
    const expiresAt = Number(value || 0);
    if (expiresAt > now) {
      hasActiveEntry = true;
      return;
    }
    delete next[key];
    mutated = true;
  });

  if (mutated) {
    writeState(next);
  }

  return hasActiveEntry;
}

export function getReadConsistencyHeaders(userId?: string | null): HeadersInit {
  if (!shouldForceFreshRead(userId)) {
    return {};
  }

  return {
    'X-Ritual-Force-Fresh': '1',
  };
}
