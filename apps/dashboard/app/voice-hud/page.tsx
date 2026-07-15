'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Maximize2 } from 'lucide-react';
import { BrailleSpinner } from '@/components/ai-habit-chat/braille-spinner';
import { VoiceWaveform } from '@/components/voice-waveform';
import { FontProvider } from '@/contexts/FontContext';
import { invokeDesktopCommand } from '@/lib/desktop-bridge/commands';
import { hideDesktopVoiceHud } from '@/lib/tauri-utils';
import { cn } from '@/lib/utils';
import { useRitualVoiceInput } from '@/lib/voice/use-ritual-voice-input';
import {
  VOICE_EVENTS,
  normalizeVoiceTarget,
  type VoiceSessionCancelledPayload,
  type VoiceSessionFinalPayload,
  type VoiceSessionSource,
  type VoiceSessionStartPayload,
} from '@/lib/voice/voice-session-contract';

function normalizeSource(value: unknown): VoiceSessionSource {
  return value === 'hotkey' ? 'hotkey' : 'composer';
}

function buildSessionFromParams(searchParams: URLSearchParams): VoiceSessionStartPayload | null {
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) return null;
  return {
    sessionId,
    target: normalizeVoiceTarget(searchParams.get('target')),
    source: normalizeSource(searchParams.get('source')),
    submitOnFinal: false,
  };
}

function useVoiceAudioLevel(audioStream: MediaStream | null, isActive: boolean): number {
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    if (!audioStream || !isActive) {
      setAudioLevel(0);
      return;
    }

    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      setAudioLevel(0);
      return;
    }

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.68;

    const source = audioContext.createMediaStreamSource(audioStream);
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let lastPublishAt = 0;
    let lastPublishedLevel = 0;

    const tick = (timestamp: number) => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }

      const rms = Math.sqrt(sum / samples.length);
      const nextLevel = Math.min(1, Math.max(0, (rms - 0.01) * 9));
      if (
        timestamp - lastPublishAt > 42 &&
        Math.abs(nextLevel - lastPublishedLevel) > 0.012
      ) {
        lastPublishAt = timestamp;
        lastPublishedLevel = nextLevel;
        setAudioLevel(nextLevel);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      source.disconnect();
      audioContext.close().catch(() => undefined);
      setAudioLevel(0);
    };
  }, [audioStream, isActive]);

  return audioLevel;
}

export default function VoiceHudPage() {
  const searchParams = useSearchParams();
  const nativeHudEnabled = searchParams.get('ritual_native_voice_hud') === '1';
  const initialSession = useMemo(() => buildSessionFromParams(searchParams), [searchParams]);
  const [session, setSession] = useState<VoiceSessionStartPayload | null>(initialSession);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const shellRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionRef = useRef<VoiceSessionStartPayload | null>(initialSession);
  const finalizedSessionRef = useRef<string | null>(null);
  const cancelledSessionRef = useRef<string | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const emitToMain = useCallback(async <T,>(event: string, payload: T) => {
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo('main', event, payload);
  }, []);

  const finalizeTranscript = useCallback(
    (text: string) => {
      const activeSession = sessionRef.current;
      const finalText = text.trim();
      if (!activeSession || !finalText) return;
      if (cancelledSessionRef.current === activeSession.sessionId) return;
      if (finalizedSessionRef.current === activeSession.sessionId) return;

      finalizedSessionRef.current = activeSession.sessionId;
      const payload: VoiceSessionFinalPayload = {
        sessionId: activeSession.sessionId,
        target: activeSession.target,
        text: finalText,
      };

      void emitToMain(VOICE_EVENTS.final, payload).finally(() => {
        void hideDesktopVoiceHud().catch(() => undefined);
      });
    },
    [emitToMain],
  );

  const {
    audioStream,
    isListening,
    isProcessingVoice,
    partialTranscript,
    cancelVoiceRecording,
    startVoiceRecognition,
    stopVoiceRecording,
  } = useRitualVoiceInput({
    nativeAutoStopMs: 15000,
    onFinalTranscript: finalizeTranscript,
    setError,
    setInput: setTranscript,
    textareaRef,
  });
  const audioLevel = useVoiceAudioLevel(audioStream, isListening || isProcessingVoice);
  const nativeIsListening = isListening || Boolean(session && !isProcessingVoice && !error);
  const startVoiceRecognitionRef = useRef(startVoiceRecognition);

  useEffect(() => {
    startVoiceRecognitionRef.current = startVoiceRecognition;
  }, [startVoiceRecognition]);

  const cancelSession = useCallback(() => {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      void hideDesktopVoiceHud().catch(() => undefined);
      return;
    }

    cancelledSessionRef.current = activeSession.sessionId;
    cancelVoiceRecording();
    const payload: VoiceSessionCancelledPayload = {
      sessionId: activeSession.sessionId,
      target: activeSession.target,
    };
    void emitToMain(VOICE_EVENTS.cancelled, payload).finally(() => {
      void hideDesktopVoiceHud().catch(() => undefined);
    });
  }, [cancelVoiceRecording, emitToMain]);

  const stopSession = useCallback(() => {
    if (isProcessingVoice) return;
    if (isListening) {
      stopVoiceRecording();
      return;
    }
    if (transcript.trim()) {
      finalizeTranscript(transcript);
    }
  }, [finalizeTranscript, isListening, isProcessingVoice, stopVoiceRecording, transcript]);

  useEffect(() => {
    document.documentElement.dataset.voiceHudWindow = '1';
    document.body.dataset.voiceHudWindow = '1';
    shellRef.current?.focus();
    return () => {
      delete document.documentElement.dataset.voiceHudWindow;
      delete document.body.dataset.voiceHudWindow;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    finalizedSessionRef.current = null;
    cancelledSessionRef.current = null;
    setError(null);
    setTranscript('');
    void startVoiceRecognitionRef.current();
  }, [session?.sessionId]);

  useEffect(() => {
    let cancelled = false;
    let unlisteners: Array<() => void> = [];

    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const startUnlisten = await listen<VoiceSessionStartPayload>(VOICE_EVENTS.start, (event) => {
        if (
          sessionRef.current &&
          sessionRef.current.sessionId !== event.payload.sessionId
        ) {
          cancelVoiceRecording();
        }
        setSession(event.payload);
      });
      const stopUnlisten = await listen(VOICE_EVENTS.stopRequest, () => {
        stopSession();
      });
      const cancelUnlisten = await listen(VOICE_EVENTS.cancelRequest, () => {
        cancelSession();
      });

      if (cancelled) {
        startUnlisten();
        stopUnlisten();
        cancelUnlisten();
        return;
      }

      unlisteners = [startUnlisten, stopUnlisten, cancelUnlisten];
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
      unlisteners = [];
    };
  }, [cancelSession, cancelVoiceRecording, stopSession]);

  useEffect(() => {
    if (!nativeHudEnabled || !session) return;

    void invokeDesktopCommand('update_voice_hud_state', {
      state: {
        sessionId: session.sessionId,
        isListening: nativeIsListening,
        isProcessingVoice,
        audioLevel,
        error,
        partialTranscript,
      },
    }).catch(() => undefined);
  }, [
    audioLevel,
    error,
    isProcessingVoice,
    nativeHudEnabled,
    nativeIsListening,
    partialTranscript,
    session?.sessionId,
  ]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        cancelSession();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        stopSession();
      }
    },
    [cancelSession, stopSession],
  );

  const openMicrophoneSettings = useCallback(() => {
    void invokeDesktopCommand('open_microphone_settings').catch(() => undefined);
  }, []);

  const statusText = error
    ? 'Stop'
    : isProcessingVoice
      ? 'Processing'
      : isListening
        ? 'Stop'
        : 'Ready';

  return (
    <FontProvider>
      <main
        ref={shellRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="voice-hud-shell flex h-screen w-screen items-center justify-center bg-transparent font-sans outline-none"
      >
      <section
        data-tauri-drag-region
        className="voice-hud-panel relative h-[244px] w-[860px] overflow-hidden rounded-[52px] border border-[#b8b8b8]/80 bg-[#e7e7e7]/95 shadow-[0_24px_58px_rgba(0,0,0,0.24),0_5px_16px_rgba(0,0,0,0.14),inset_0_1px_0_rgba(255,255,255,0.62)]"
        aria-label="Voice input"
      >
        <button
          type="button"
          aria-label="Expand voice HUD"
          className="absolute right-[26px] top-[25px] flex h-9 w-9 items-center justify-center text-[#9b9b9b]"
          onClick={() => shellRef.current?.focus()}
        >
          <Maximize2 className="h-[27px] w-[27px] rotate-90 stroke-[1.7]" />
        </button>

        <div className="absolute left-[58px] right-[58px] top-[68px] h-[64px]">
          <div
            className="absolute left-0 right-0 top-1/2 h-[4px] -translate-y-1/2 opacity-75"
            style={{
              backgroundImage: 'linear-gradient(to right, rgba(84,84,84,0.58) 0 4px, transparent 4px 8px)',
              backgroundSize: '8px 4px',
            }}
            aria-hidden="true"
          />
          <VoiceWaveform
            isActive={isListening}
            audioStream={audioStream}
            className="relative z-10 h-full w-full"
            barColor="#202020"
            barWidth={5}
            barGap={3}
            fadeWidth={54}
            sensitivity={3.35}
          />
        </div>

        {error ? (
          <div className="absolute left-[120px] right-[120px] top-[126px] truncate text-center text-[13px] font-medium text-[#8f2f2f]">
            {error}
          </div>
        ) : partialTranscript ? (
          <div className="absolute left-[120px] right-[120px] top-[126px] truncate text-center text-[13px] font-medium text-[#6f6f6f]">
            {partialTranscript}
          </div>
        ) : null}

        <div className="absolute bottom-[29px] left-[44px] right-[44px] flex h-[72px] items-center rounded-[16px] bg-white/64 px-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] backdrop-blur-xl">
          <div className="flex flex-1 items-center justify-start">
            <img
              src="/images/eclipse.svg"
              alt=""
              className="h-[34px] w-[34px] opacity-45"
              draggable={false}
            />
          </div>

          <div className="flex items-center gap-[24px] text-[27px] font-medium leading-none text-[#848484]">
            <button
              type="button"
              onClick={stopSession}
              className={cn(
                'flex items-center gap-2 transition-none',
                isProcessingVoice ? 'text-[#4f4f4f]' : 'hover:text-[#5f5f5f]',
              )}
            >
              {isProcessingVoice ? <BrailleSpinner className="text-[18px] text-[#3f3f3f]" /> : null}
              <span>{statusText}</span>
            </button>
            <div className="flex items-center gap-[7px]">
              <span className="voice-hud-keycap min-w-[36px]">⌥</span>
              <span className="voice-hud-keycap min-w-[83px] text-[#2e2e2e]">Space</span>
            </div>
            <button
              type="button"
              onClick={cancelSession}
              className="transition-none hover:text-[#5f5f5f]"
            >
              Cancel
            </button>
            <span className="voice-hud-keycap min-w-[60px] text-[18px]">esc</span>
          </div>
        </div>

        {error?.toLowerCase().includes('microphone') ? (
          <button
            type="button"
            onClick={openMicrophoneSettings}
            className="absolute bottom-[104px] left-1/2 -translate-x-1/2 rounded-[8px] bg-white/62 px-3 py-1.5 text-[12px] font-medium text-[#555] shadow-sm"
          >
            Open Microphone Settings
          </button>
        ) : null}
        </section>
      </main>
    </FontProvider>
  );
}
