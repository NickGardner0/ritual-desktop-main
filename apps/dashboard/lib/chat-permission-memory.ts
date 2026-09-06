const ALWAYS_KEY = 'ritual:chat:always-tools';

export function readAlwaysToolScopes(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ALWAYS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberAlwaysToolScope(scope: string): void {
  const next = Array.from(new Set([...readAlwaysToolScopes(), scope]));
  try {
    window.localStorage.setItem(ALWAYS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
}
