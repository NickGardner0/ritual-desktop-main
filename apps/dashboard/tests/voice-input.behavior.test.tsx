import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permission: true,
  states: [] as Array<{ event?: string; transcript?: string; timestamp?: number }>,
  clear: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  deepgramStop: vi.fn(),
}));

vi.mock('@/lib/desktop-capabilities', () => ({
  useDesktopCapabilities: () => ({ isDesktop: true }),
}));
vi.mock('@/lib/tauri-utils', () => ({
  ensureMicrophonePermission: async () => mocks.permission,
}));
vi.mock('@/lib/native-voice', () => ({
  clearNativeDesktopSpeechState: mocks.clear,
  formatNativeSpeechError: (value: unknown) => `Voice unavailable: ${String(value ?? 'unknown')}`,
  getNativeDesktopSpeechState: async () => mocks.states.shift() ?? {},
  getNativeSpeechErrorMessage: (value: unknown) => value instanceof Error ? value.message : String(value),
  startNativeDesktopSpeechRecognition: mocks.start,
  stopNativeDesktopSpeechRecognition: mocks.stop,
}));
vi.mock('@/lib/privacy/privacy-settings', () => ({ privacySettingsHeaders: () => ({}) }));
vi.mock('@/lib/voice/use-deepgram-dictation', () => ({
  useDeepgramDictation: () => ({ start: vi.fn(), stop: mocks.deepgramStop, isSupported: false }),
}));

import { useRitualVoiceInput } from '@/lib/voice/use-ritual-voice-input';

function makeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}

describe('shared voice lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.permission = true;
    mocks.states.length = 0;
    mocks.clear.mockClear();
    mocks.start.mockClear();
    mocks.stop.mockClear();
    mocks.deepgramStop.mockClear();
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes partial speech and commits the final transcript', async () => {
    const { stream, stop } = makeStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    mocks.states.push(
      { event: 'ritual:speech:partial', transcript: 'partial words', timestamp: 1 },
      { event: 'ritual:speech:final', transcript: 'final words', timestamp: 2 },
    );
    const setInput = vi.fn();
    const { result } = renderHook(() => useRitualVoiceInput({
      textareaRef: { current: null },
      setInput,
    }));

    await act(async () => result.current.startVoiceRecognition());
    await act(async () => vi.advanceTimersByTimeAsync(75));
    expect(result.current.partialTranscript).toBe('partial words');
    await act(async () => vi.advanceTimersByTimeAsync(75));
    expect(setInput).toHaveBeenCalledWith('final words');
    expect(result.current.isListening).toBe(false);
    expect(stop).toHaveBeenCalled();
  });

  it('auto-stops and reports the no-speech timeout', async () => {
    const { stream } = makeStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    const setError = vi.fn();
    const { result } = renderHook(() => useRitualVoiceInput({
      textareaRef: { current: null },
      setInput: vi.fn(),
      setError,
      nativeAutoStopMs: 1000,
    }));

    await act(async () => result.current.startVoiceRecognition());
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.stop).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(setError).toHaveBeenLastCalledWith('No speech detected. Please try again.');
    expect(result.current.isProcessingVoice).toBe(false);
  });

  it('reports native microphone permission denial', async () => {
    mocks.permission = false;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    const setError = vi.fn();
    const { result } = renderHook(() => useRitualVoiceInput({
      textareaRef: { current: null },
      setInput: vi.fn(),
      setError,
    }));

    await act(async () => result.current.startVoiceRecognition());
    expect(setError).toHaveBeenLastCalledWith(
      'Microphone access denied. Enable it in System Settings > Privacy & Security > Microphone.',
    );
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('stops native recognition and capture tracks on unmount', async () => {
    const { stream, stop } = makeStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    const { result, unmount } = renderHook(() => useRitualVoiceInput({
      textareaRef: { current: null },
      setInput: vi.fn(),
    }));

    await act(async () => result.current.startVoiceRecognition());
    unmount();
    expect(stop).toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalled();
  });
});
