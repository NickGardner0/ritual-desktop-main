'use client';

export type VoiceTarget = 'habit-log' | 'chat-query';
export type VoiceSessionSource = 'composer' | 'hotkey';

export type VoiceSessionStartPayload = {
  sessionId: string;
  target: VoiceTarget;
  source: VoiceSessionSource;
  submitOnFinal?: false;
};

export type VoiceSessionFinalPayload = {
  sessionId: string;
  target: VoiceTarget;
  text: string;
};

export type VoiceSessionCancelledPayload = {
  sessionId: string;
  target: VoiceTarget;
};

export type VoiceHotkeyOpenPayload = {
  source: 'hotkey';
};

export const VOICE_EVENTS = {
  start: 'voice:start',
  final: 'voice:final',
  cancelled: 'voice:cancelled',
  hotkeyOpen: 'voice:hotkey-open',
  stopRequest: 'voice:stop-request',
} as const;

export function normalizeVoiceTarget(value: unknown): VoiceTarget {
  return value === 'habit-log' || value === 'chat-query' ? value : 'chat-query';
}
