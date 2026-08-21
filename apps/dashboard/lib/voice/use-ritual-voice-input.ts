'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import {
  clearNativeDesktopSpeechState,
  formatNativeSpeechError,
  getNativeDesktopSpeechState,
  getNativeSpeechErrorMessage,
  startNativeDesktopSpeechRecognition,
  stopNativeDesktopSpeechRecognition,
} from '@/lib/native-voice';
import { privacySettingsHeaders } from '@/lib/privacy/privacy-settings';
import { ensureMicrophonePermission } from '@/lib/native-gateway';
import { useDeepgramDictation } from '@/lib/voice/use-deepgram-dictation';

export type RitualVoiceInputOptions = {
  textareaRef: { current: HTMLTextAreaElement | null };
  setInput: (value: string) => void;
  setError?: (message: string | null) => void;
  normalizeTranscript?: (text: string) => string;
  nativeAutoStopMs?: number;
  onFinalTranscript?: (text: string) => void;
};

export type RitualVoiceInputState = {
  audioStream: MediaStream | null;
  isListening: boolean;
  isProcessingVoice: boolean;
  partialTranscript: string | null;
  startVoiceRecognition: () => Promise<void>;
  stopVoiceRecording: () => void;
  cancelVoiceRecording: () => void;
};

const DEFAULT_NATIVE_AUTO_STOP_MS = 10000;
const WHISPER_AUTO_STOP_MS = 10000;
const PARTIAL_STABLE_MS = 700;

function defaultNormalizeTranscript(text: string): string {
  return text.trim().replace(/[.?!]\s*$/, '');
}

export function useRitualVoiceInput({
  textareaRef,
  setInput,
  setError,
  normalizeTranscript = defaultNormalizeTranscript,
  nativeAutoStopMs = DEFAULT_NATIVE_AUTO_STOP_MS,
  onFinalTranscript,
}: RitualVoiceInputOptions): RitualVoiceInputState {
  const { isDesktop } = useDesktopCapabilities();
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const [partialTranscript, setPartialTranscript] = useState<string | null>(null);
  const partialTranscriptRef = useRef<string | null>(null);
  const nativeVoicePollRef = useRef<number | null>(null);
  const nativeVoiceAutoStopRef = useRef<number | null>(null);
  const nativeVoiceFinalizeTimeoutRef = useRef<number | null>(null);
  const nativeVoiceTimestampRef = useRef(0);
  const nativeVoiceSilenceAudioCtxRef = useRef<AudioContext | null>(null);
  const nativeVoiceSilenceRafRef = useRef<number | null>(null);
  const nativeVoiceHadSpeechRef = useRef(false);
  const nativeVoicePartialLastChangeRef = useRef<number>(0);
  const nativeVoicePartialLastValueRef = useRef<string>('');
  const voiceInputModeRef = useRef<'native' | 'whisper' | 'deepgram' | null>(null);
  const stopVoiceRecordingRef = useRef<() => void>(() => undefined);
  const discardVoiceTranscriptRef = useRef(false);

  const reportError = useCallback(
    (message: string | null) => {
      setError?.(message);
    },
    [setError],
  );

  const focusTextarea = useCallback(
    (delayMs: number) => {
      window.setTimeout(() => textareaRef.current?.focus(), delayMs);
    },
    [textareaRef],
  );

  const commitTranscript = useCallback(
    (text: string, { normalize, focusDelayMs }: { normalize: boolean; focusDelayMs: number }) => {
      if (discardVoiceTranscriptRef.current) {
        return;
      }
      const nextInput = normalize ? normalizeTranscript(text) : text;
      setInput(nextInput);
      onFinalTranscript?.(nextInput);
      focusTextarea(focusDelayMs);
    },
    [focusTextarea, normalizeTranscript, onFinalTranscript, setInput],
  );

  const clearNativeVoiceTimers = useCallback(() => {
    if (nativeVoicePollRef.current) {
      clearInterval(nativeVoicePollRef.current);
      nativeVoicePollRef.current = null;
    }
    if (nativeVoiceAutoStopRef.current) {
      clearTimeout(nativeVoiceAutoStopRef.current);
      nativeVoiceAutoStopRef.current = null;
    }
    if (nativeVoiceFinalizeTimeoutRef.current) {
      clearTimeout(nativeVoiceFinalizeTimeoutRef.current);
      nativeVoiceFinalizeTimeoutRef.current = null;
    }
    if (nativeVoiceSilenceRafRef.current) {
      cancelAnimationFrame(nativeVoiceSilenceRafRef.current);
      nativeVoiceSilenceRafRef.current = null;
    }
    if (nativeVoiceSilenceAudioCtxRef.current) {
      nativeVoiceSilenceAudioCtxRef.current.close().catch(() => undefined);
      nativeVoiceSilenceAudioCtxRef.current = null;
    }
    nativeVoiceHadSpeechRef.current = false;
  }, []);

  const resetNativeVoiceSession = useCallback(async () => {
    clearNativeVoiceTimers();
    nativeVoiceTimestampRef.current = 0;
    setPartialTranscript(null);
    setAudioStream((prev) => {
      if (prev) {
        prev.getTracks().forEach((track) => track.stop());
      }
      return null;
    });
    await clearNativeDesktopSpeechState().catch(() => undefined);
  }, [clearNativeVoiceTimers]);

  useEffect(() => {
    audioStreamRef.current = audioStream;
  }, [audioStream]);

  const startNativeVoiceRecognition = useCallback(async () => {
    reportError(null);
    setIsProcessingVoice(false);
    await resetNativeVoiceSession();
    if (!(await ensureMicrophonePermission())) {
      throw new Error('microphone-permission-denied');
    }

    nativeVoicePartialLastChangeRef.current = 0;
    nativeVoicePartialLastValueRef.current = '';
    let vizStream: MediaStream | null = null;
    try {
      vizStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      setAudioStream(vizStream);
    } catch {
      // Non-critical: waveform visualization will not animate.
    }

    try {
      await startNativeDesktopSpeechRecognition();
    } catch (error) {
      if (vizStream) {
        vizStream.getTracks().forEach((track) => track.stop());
        setAudioStream(null);
      }
      throw error;
    }

    voiceInputModeRef.current = 'native';
    setIsListening(true);

    nativeVoicePollRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const state = await getNativeDesktopSpeechState();

          if (
            voiceInputModeRef.current === 'native' &&
            nativeVoicePartialLastValueRef.current &&
            nativeVoicePartialLastChangeRef.current &&
            performance.now() - nativeVoicePartialLastChangeRef.current > PARTIAL_STABLE_MS
          ) {
            stopVoiceRecordingRef.current();
            return;
          }

          if (!state.timestamp || state.timestamp <= nativeVoiceTimestampRef.current) {
            return;
          }
          nativeVoiceTimestampRef.current = state.timestamp;

          if (state.event === 'ritual:speech:partial') {
            if (state.transcript?.trim()) {
              partialTranscriptRef.current = state.transcript;
              setPartialTranscript(state.transcript);
              if (state.transcript !== nativeVoicePartialLastValueRef.current) {
                nativeVoicePartialLastValueRef.current = state.transcript;
                nativeVoicePartialLastChangeRef.current = performance.now();
              }
            }
            return;
          }

          if (state.event === 'ritual:speech:final') {
            await resetNativeVoiceSession();
            partialTranscriptRef.current = null;
            setPartialTranscript(null);
            setIsListening(false);
            setIsProcessingVoice(false);
            if (state.transcript?.trim()) {
              commitTranscript(state.transcript, { normalize: false, focusDelayMs: 100 });
            } else {
              reportError('No speech detected. Please try again.');
            }
            return;
          }

          if (state.event === 'ritual:speech:error') {
            await resetNativeVoiceSession();
            setPartialTranscript(null);
            setIsListening(false);
            setIsProcessingVoice(false);
            reportError(formatNativeSpeechError(state.transcript));
            return;
          }

          if (state.event === 'ritual:speech:status' && state.transcript === 'stopped') {
            await resetNativeVoiceSession();
            setPartialTranscript(null);
            setIsListening(false);
            setIsProcessingVoice(false);
            reportError('No speech detected. Please try again.');
          }
        } catch (pollError: any) {
          await resetNativeVoiceSession();
          setIsListening(false);
          setIsProcessingVoice(false);
          reportError(`Voice error: ${pollError?.message || 'Unknown native speech error'}`);
        }
      })();
    }, 75);

    nativeVoiceAutoStopRef.current = window.setTimeout(() => {
      stopVoiceRecordingRef.current();
    }, nativeAutoStopMs);
  }, [commitTranscript, nativeAutoStopMs, reportError, resetNativeVoiceSession]);

  const whisperVoiceEnabled =
    (process.env.NEXT_PUBLIC_VOICE_USE_WHISPER ?? '1') !== '0';
  const deepgramVoicePreferred = false;

  const {
    start: startDeepgramDictation,
    stop: stopDeepgramDictation,
    isSupported: deepgramSupported,
  } = useDeepgramDictation({
    language: 'en-US',
    model: 'nova-3',
    punctuate: false,
    smartFormat: false,
    numerals: true,
    endpointingMs: 900,
    utteranceEndMs: 1600,
    maxDurationMs: 15000,
    keyterms: [
      'Ritual',
      'coding',
      'computer time',
      'screen time',
      'caffeine',
      'nicotine',
      'sleep',
      'workout',
      'reading',
      'spending',
      'heart rate',
      'steps',
      'car miles',
      'pages',
      'miles',
    ],
    onAudioStreamChange: setAudioStream,
    onListeningChange: setIsListening,
    onProcessingChange: setIsProcessingVoice,
    onInterimTranscriptChange: (text) => {
      partialTranscriptRef.current = text;
      setPartialTranscript(text);
    },
    onFinalTranscript: (text) => {
      partialTranscriptRef.current = null;
      setPartialTranscript(null);
      commitTranscript(text, { normalize: true, focusDelayMs: 100 });
    },
    onError: reportError,
  });

  const startWhisperRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    voiceInputModeRef.current = 'whisper';
    setAudioStream(stream);
    setIsListening(true);
    setIsProcessingVoice(false);

    let mimeType = '';
    const supportedTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/wav'];
    for (const type of supportedTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }

    const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const audioChunks: Blob[] = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      setIsListening(false);
      stream.getTracks().forEach((track) => track.stop());
      setAudioStream(null);

      if (discardVoiceTranscriptRef.current) {
        setPartialTranscript(null);
        setIsProcessingVoice(false);
        voiceInputModeRef.current = null;
        return;
      }

      setIsProcessingVoice(true);

      if (audioChunks.length === 0) {
        reportError('No audio recorded. Please try again.');
        setIsProcessingVoice(false);
        return;
      }

      const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/wav' });

      try {
        const formData = new FormData();
        const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav';
        formData.append('file', audioBlob, `audio.${ext}`);

        const response = await fetch('/api/whisper', {
          method: 'POST',
          body: formData,
          headers: privacySettingsHeaders(),
        });

        if (response.ok) {
          const result = await response.json();
          if (result.text?.trim()) {
            commitTranscript(result.text, { normalize: true, focusDelayMs: 100 });
          } else {
            reportError('No speech detected. Please try again.');
          }
        } else {
          reportError('Failed to transcribe audio. Please try again.');
        }
      } catch {
        reportError('Failed to process voice input. Please try again.');
      }
      setIsProcessingVoice(false);
    };

    mediaRecorder.start(100);

    const autoStopTimer = window.setTimeout(() => {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, WHISPER_AUTO_STOP_MS);

    (window as any).__mediaRecorder = mediaRecorder;
    (window as any).__autoStopTimer = autoStopTimer;

    let vadRaf = 0;
    let vadCtx: AudioContext | null = null;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      vadCtx = new AudioCtx();
      const source = vadCtx.createMediaStreamSource(stream);
      const analyser = vadCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);

      const armRms = 0.02;
      const speechRms = 0.01;
      const silenceMs = 900;
      const minRecordingMs = 1200;
      const recordingStartedAt = performance.now();
      let armed = false;
      let lastLoudAt = 0;
      let triggered = false;

      const tick = () => {
        if (triggered || mediaRecorder.state !== 'recording') {
          return;
        }
        analyser.getByteTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const n = (buf[i] - 128) / 128;
          sumSq += n * n;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        const now = performance.now();

        if (!armed) {
          if (rms > armRms) {
            armed = true;
            lastLoudAt = now;
          }
        } else if (rms > speechRms) {
          lastLoudAt = now;
        } else if (
          now - lastLoudAt > silenceMs &&
          now - recordingStartedAt > minRecordingMs
        ) {
          triggered = true;
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
          return;
        }
        vadRaf = requestAnimationFrame(tick);
      };
      vadRaf = requestAnimationFrame(tick);
    } catch {
      // VAD is best-effort only; the safety timeout still covers recording.
    }

    (window as any).__vadCleanup = () => {
      if (vadRaf) {
        cancelAnimationFrame(vadRaf);
      }
      if (vadCtx && vadCtx.state !== 'closed') {
        vadCtx.close().catch(() => undefined);
      }
    };
  }, [commitTranscript, reportError]);

  const startVoiceRecognition = useCallback(async () => {
    if (isListening) {
      stopVoiceRecordingRef.current();
      return;
    }
    if (isProcessingVoice) {
      return;
    }

    reportError(null);
    discardVoiceTranscriptRef.current = false;

    if (deepgramVoicePreferred && deepgramSupported) {
      try {
        voiceInputModeRef.current = 'deepgram';
        await startDeepgramDictation();
        return;
      } catch {
        voiceInputModeRef.current = null;
        setIsListening(false);
        setIsProcessingVoice(false);
      }
    }

    if (isDesktop && whisperVoiceEnabled && typeof MediaRecorder !== 'undefined') {
      try {
        await startWhisperRecording();
        return;
      } catch {
        voiceInputModeRef.current = null;
        setIsListening(false);
        setIsProcessingVoice(false);
      }
    }

    if (isDesktop) {
      try {
        await startNativeVoiceRecognition();
        return;
      } catch (error: any) {
        await resetNativeVoiceSession().catch(() => undefined);
        setIsListening(false);
        setIsProcessingVoice(false);
        voiceInputModeRef.current = null;
        reportError(
          error?.message === 'microphone-permission-denied'
            ? 'Microphone access denied. Enable it in System Settings > Privacy & Security > Microphone.'
            : formatNativeSpeechError(getNativeSpeechErrorMessage(error)),
        );
        return;
      }
    }

    try {
      await startWhisperRecording();
    } catch (err: any) {
      voiceInputModeRef.current = null;
      const nativeMessage = getNativeSpeechErrorMessage(err);
      reportError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access denied. Enable it in System Settings > Privacy & Security > Microphone.'
          : formatNativeSpeechError(nativeMessage),
      );
      setIsListening(false);
      setIsProcessingVoice(false);
    }
  }, [
    deepgramSupported,
    isDesktop,
    isListening,
    isProcessingVoice,
    reportError,
    resetNativeVoiceSession,
    startDeepgramDictation,
    startNativeVoiceRecognition,
    startWhisperRecording,
    whisperVoiceEnabled,
  ]);

  const stopVoiceRecording = useCallback(() => {
    if (voiceInputModeRef.current === 'deepgram') {
      stopDeepgramDictation();
      voiceInputModeRef.current = null;
      return;
    }

    if (voiceInputModeRef.current === 'native') {
      if (nativeVoiceAutoStopRef.current) {
        clearTimeout(nativeVoiceAutoStopRef.current);
        nativeVoiceAutoStopRef.current = null;
      }
      if (nativeVoiceFinalizeTimeoutRef.current) {
        clearTimeout(nativeVoiceFinalizeTimeoutRef.current);
      }

      const liveTranscript = partialTranscriptRef.current?.trim();
      partialTranscriptRef.current = null;
      setIsListening(false);
      if (liveTranscript) {
        commitTranscript(liveTranscript, { normalize: false, focusDelayMs: 0 });
        setPartialTranscript(null);
        setIsProcessingVoice(false);
      } else {
        setIsProcessingVoice(true);
      }

      void stopNativeDesktopSpeechRecognition()
        .catch((error: any) => {
          if (!liveTranscript) {
            reportError(`Voice error: ${error?.message || 'Failed to stop native speech recognition.'}`);
          }
          return Promise.resolve();
        })
        .finally(() => {
          if (liveTranscript) {
            void resetNativeVoiceSession();
            voiceInputModeRef.current = null;
            return;
          }
          nativeVoiceFinalizeTimeoutRef.current = window.setTimeout(() => {
            void resetNativeVoiceSession();
            setIsProcessingVoice(false);
            voiceInputModeRef.current = null;
            reportError('No speech detected. Please try again.');
          }, 800);
        });
      return;
    }

    const mediaRecorder = (window as any).__mediaRecorder;
    const autoStopTimer = (window as any).__autoStopTimer;
    const vadCleanup = (window as any).__vadCleanup;
    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
    }
    if (typeof vadCleanup === 'function') {
      vadCleanup();
      (window as any).__vadCleanup = null;
    }
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop();
    }
    voiceInputModeRef.current = null;
    if (audioStream) {
      audioStream.getTracks().forEach((track) => track.stop());
      setAudioStream(null);
    }
    setIsListening(false);
  }, [audioStream, commitTranscript, reportError, resetNativeVoiceSession, stopDeepgramDictation]);

  const cancelVoiceRecording = useCallback(() => {
    discardVoiceTranscriptRef.current = true;

    if (voiceInputModeRef.current === 'deepgram') {
      stopDeepgramDictation();
      voiceInputModeRef.current = null;
      setPartialTranscript(null);
      setIsListening(false);
      setIsProcessingVoice(false);
      return;
    }

    if (voiceInputModeRef.current === 'native') {
      clearNativeVoiceTimers();
      setPartialTranscript(null);
      setIsListening(false);
      setIsProcessingVoice(false);
      void stopNativeDesktopSpeechRecognition()
        .catch(() => undefined)
        .finally(() => {
          void resetNativeVoiceSession();
          voiceInputModeRef.current = null;
        });
      return;
    }

    const mediaRecorder = (window as any).__mediaRecorder;
    const autoStopTimer = (window as any).__autoStopTimer;
    const vadCleanup = (window as any).__vadCleanup;
    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
      (window as any).__autoStopTimer = null;
    }
    if (typeof vadCleanup === 'function') {
      vadCleanup();
      (window as any).__vadCleanup = null;
    }
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop();
    } else {
      voiceInputModeRef.current = null;
    }
    if (audioStream) {
      audioStream.getTracks().forEach((track) => track.stop());
      setAudioStream(null);
    }
    setPartialTranscript(null);
    setIsListening(false);
    setIsProcessingVoice(false);
  }, [audioStream, clearNativeVoiceTimers, resetNativeVoiceSession, stopDeepgramDictation]);

  useEffect(() => {
    stopVoiceRecordingRef.current = stopVoiceRecording;
  }, [stopVoiceRecording]);

  useEffect(() => {
    return () => {
      clearNativeVoiceTimers();
      const autoStopTimer = (window as any).__autoStopTimer;
      if (autoStopTimer) clearTimeout(autoStopTimer);
      const vadCleanup = (window as any).__vadCleanup;
      if (typeof vadCleanup === 'function') vadCleanup();
      const mediaRecorder = (window as any).__mediaRecorder;
      if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
      if (voiceInputModeRef.current === 'native') {
        void stopNativeDesktopSpeechRecognition().catch(() => undefined);
      } else if (voiceInputModeRef.current === 'deepgram') {
        stopDeepgramDictation();
      }
      voiceInputModeRef.current = null;
    };
  }, [clearNativeVoiceTimers, stopDeepgramDictation]);

  return {
    audioStream,
    isListening,
    isProcessingVoice,
    partialTranscript,
    cancelVoiceRecording,
    startVoiceRecognition,
    stopVoiceRecording,
  };
}
