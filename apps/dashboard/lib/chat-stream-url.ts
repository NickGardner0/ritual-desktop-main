type RitualWindow = Window & {
  __RITUAL_CHAT_ORIGIN__?: string;
  __RITUAL_API_ORIGIN__?: string;
  __RITUAL_HOSTED_ORIGIN__?: string;
};

export function getChatStreamUrl(): string {
  if (typeof window === 'undefined') return '/api/chat/stream';
  const w = window as RitualWindow;
  if (w.__RITUAL_CHAT_ORIGIN__) return `${w.__RITUAL_CHAT_ORIGIN__.replace(/\/$/, '')}/chat/stream`;
  if (w.__RITUAL_HOSTED_ORIGIN__) return `${w.__RITUAL_HOSTED_ORIGIN__.replace(/\/$/, '')}/api/chat/stream`;
  return '/api/chat/stream';
}

export function getDesktopApiOrigin(): string {
  if (typeof window === 'undefined') return '';
  return (window as RitualWindow).__RITUAL_API_ORIGIN__ || '';
}
