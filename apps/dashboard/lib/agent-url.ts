type RitualWindow = Window & {
  __RITUAL_CHAT_ORIGIN__?: string;
  __RITUAL_API_ORIGIN__?: string;
  __RITUAL_HOSTED_ORIGIN__?: string;
};

function ritualWindow(): RitualWindow | undefined {
  if (typeof window === 'undefined') return undefined;
  return window as RitualWindow;
}

/** True when the Vite SPA has a live local sidecar to host the agent loop. */
export function shouldUseAgentLoop(): boolean {
  return Boolean(ritualWindow()?.__RITUAL_CHAT_ORIGIN__);
}

export function getAgentRequestUrl(suffix: '' | '/approve' | '/items' = ''): string {
  const origin = ritualWindow()?.__RITUAL_CHAT_ORIGIN__?.replace(/\/$/, '');
  if (origin) return `${origin}/agent${suffix}`;
  return `/api/agent${suffix}`;
}
