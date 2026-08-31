export const LOCAL_CHAT_SIDECAR_ORIGIN = 'http://127.0.0.1:8787';

export type RitualDesktopWindow = Window & {
  __RITUAL_API_ORIGIN__?: string;
  __RITUAL_CHAT_ORIGIN__?: string;
  __RITUAL_HOSTED_ORIGIN__?: string;
};

type OriginEnv = {
  VITE_PYTHON_API_URL?: string;
  NEXT_PUBLIC_PYTHON_API_URL?: string;
  VITE_HOSTED_ORIGIN?: string;
};

export function bindHostedOrigins(
  target: RitualDesktopWindow,
  env: OriginEnv,
): void {
  target.__RITUAL_API_ORIGIN__ =
    env.VITE_PYTHON_API_URL
    || env.NEXT_PUBLIC_PYTHON_API_URL
    || 'https://backend-api-production-a37e.up.railway.app';
  target.__RITUAL_HOSTED_ORIGIN__ =
    env.VITE_HOSTED_ORIGIN
    || 'https://desktop.ritualdb.com';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function probeLocalChatSidecar(
  target: RitualDesktopWindow,
  options?: {
    delaysMs?: number[];
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<boolean> {
  const delays = options?.delaysMs ?? [0, 250, 750, 2000];
  const timeoutMs = options?.timeoutMs ?? 300;
  const fetchImpl = options?.fetchImpl ?? fetch;

  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    try {
      const health = await fetchImpl(`${LOCAL_CHAT_SIDECAR_ORIGIN}/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (health.ok) {
        target.__RITUAL_CHAT_ORIGIN__ = LOCAL_CHAT_SIDECAR_ORIGIN;
        return true;
      }
    } catch {
      // Sidecar may still be starting; retry. Hosted chat remains the fallback.
    }
  }

  return false;
}
