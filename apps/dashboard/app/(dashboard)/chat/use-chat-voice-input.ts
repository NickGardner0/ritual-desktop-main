'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureMicrophonePermission, isTauri } from '@/lib/tauri-utils';
import { useDeepgramDictation } from '@/lib/voice/use-deepgram-dictation';
import {
  clearNativeDesktopSpeechState,
  formatNativeSpeechError,
  getNativeSpeechErrorMessage,
  getNativeDesktopSpeechState,
  startNativeDesktopSpeechRecognition,
  stopNativeDesktopSpeechRecognition,
} from '@/lib/native-voice';

interface UseChatVoiceInputParams {
  setInput: (value: string) => void;
  textareaRef: { current: HTMLTextAreaElement | null };
}

export function useChatVoiceInput({ setInput, textareaRef }: UseChatVoiceInputParams) {
// Voice mode state (transcription)
const [isListening, setIsListening] = useState(false);
const [isProcessingVoice, setIsProcessingVoice] = useState(false);
const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
const [voiceError, setVoiceError] = useState<string | null>(null);
const [partialTranscript, setPartialTranscript] = useState<string | null>(null);
// Mirror of partialTranscript readable from stale closures (poll loop, auto-stop).
const partialTranscriptRef = useRef<string | null>(null);
const nativeVoicePollRef = useRef<number | null>(null);
const nativeVoiceAutoStopRef = useRef<number | null>(null);
const nativeVoiceFinalizeTimeoutRef = useRef<number | null>(null);
const nativeVoiceTimestampRef = useRef(0);
// Audio-level silence detector (independent of Swift's partial cadence).
const nativeVoiceSilenceAudioCtxRef = useRef<AudioContext | null>(null);
const nativeVoiceSilenceRafRef = useRef<number | null>(null);
const nativeVoiceSilenceTimerRef = useRef<number | null>(null);
const nativeVoiceHadSpeechRef = useRef(false);
// Transcript-stability auto-stop tracking.
const nativeVoicePartialLastChangeRef = useRef<number>(0);
const nativeVoicePartialLastValueRef = useRef<string>('');
const voiceInputModeRef = useRef<'native' | 'whisper' | 'deepgram' | null>(null);
const stopVoiceRecordingRef = useRef<() => void>(() => undefined);

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
  if (nativeVoiceSilenceTimerRef.current) {
    clearTimeout(nativeVoiceSilenceTimerRef.current);
    nativeVoiceSilenceTimerRef.current = null;
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
  // Stop visualization mic stream
  setAudioStream((prev) => {
    if (prev) prev.getTracks().forEach((t) => t.stop());
    return null;
  });
  await clearNativeDesktopSpeechState().catch(() => undefined);
}, [clearNativeVoiceTimers]);

useEffect(() => {
  return () => {
    clearNativeVoiceTimers();
    if (voiceInputModeRef.current === 'native') {
      void stopNativeDesktopSpeechRecognition().catch(() => undefined);
    }
  };
}, [clearNativeVoiceTimers]);

const startNativeVoiceRecognition = useCallback(async () => {
  setVoiceError(null);
  setIsProcessingVoice(false);
  await resetNativeVoiceSession();
  if (!(await ensureMicrophonePermission())) {
    throw new Error('microphone-permission-denied');
  }

  // Parallel mic stream used purely to power the waveform. (Audio-level silence
  // detection is unreliable because Swift's AVAudioEngine effectively captures
  // the mic and WebKit's getUserMedia returns a near-silent duplicate.) We
  // detect end-of-speech via transcript stability in the poll loop below.
  nativeVoicePartialLastChangeRef.current = 0;
  nativeVoicePartialLastValueRef.current = '';
  let vizStream: MediaStream | null = null;
  try {
    vizStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    setAudioStream(vizStream);
  } catch {
    // Non-critical — waveform just won't animate.
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

  const PARTIAL_STABLE_MS = 700;

  nativeVoicePollRef.current = window.setInterval(() => {
    void (async () => {
      try {
        const state = await getNativeDesktopSpeechState();

        // Transcript-stability auto-stop: fires on every tick regardless of
        // whether a new event arrived from Swift.
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
            setInput(state.transcript);
            setTimeout(() => textareaRef.current?.focus(), 100);
          } else {
            setVoiceError('No speech detected. Please try again.');
          }
          return;
        }

        if (state.event === 'ritual:speech:error') {
          await resetNativeVoiceSession();
          setPartialTranscript(null);
          setIsListening(false);
          setIsProcessingVoice(false);
          setVoiceError(formatNativeSpeechError(state.transcript));
          return;
        }

        if (state.event === 'ritual:speech:status' && state.transcript === 'stopped') {
          await resetNativeVoiceSession();
          setPartialTranscript(null);
          setIsListening(false);
          setIsProcessingVoice(false);
          setVoiceError('No speech detected. Please try again.');
        }
      } catch (pollError: any) {
        await resetNativeVoiceSession();
        setIsListening(false);
        setIsProcessingVoice(false);
        setVoiceError(`Voice error: ${pollError?.message || 'Unknown native speech error'}`);
      }
    })();
  }, 75);

  nativeVoiceAutoStopRef.current = window.setTimeout(() => {
    stopVoiceRecordingRef.current();
  }, 10000);
}, [resetNativeVoiceSession, setInput, textareaRef]);

const whisperVoiceEnabled =
  (process.env.NEXT_PUBLIC_VOICE_USE_WHISPER ?? '1') !== '0';
const deepgramVoicePreferred = false;

const normalizeVoiceTranscript = (text: string): string => {
  return text.trim().replace(/[.?!]\s*$/, '');
};

const { start: startDeepgramDictation, stop: stopDeepgramDictation, isSupported: deepgramSupported } =
  useDeepgramDictation({
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
      setInput(normalizeVoiceTranscript(text));
      setTimeout(() => textareaRef.current?.focus(), 100);
    },
    onError: setVoiceError,
  });

const startWhisperRecording = async () => {
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
    if (event.data.size > 0) audioChunks.push(event.data);
  };

  mediaRecorder.onstop = async () => {
    setIsListening(false);
    setIsProcessingVoice(true);
    stream.getTracks().forEach(track => track.stop());
    setAudioStream(null);

    if (audioChunks.length === 0) {
      setVoiceError('No audio recorded. Please try again.');
      setIsProcessingVoice(false);
      return;
    }

    const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/wav' });

    try {
      const formData = new FormData();
      const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav';
      formData.append('file', audioBlob, `audio.${ext}`);

      const response = await fetch('/api/whisper', { method: 'POST', body: formData });

      if (response.ok) {
        const result = await response.json();
        if (result.text?.trim()) {
          setInput(normalizeVoiceTranscript(result.text));
          setTimeout(() => textareaRef.current?.focus(), 100);
        } else {
          setVoiceError('No speech detected. Please try again.');
        }
      } else {
        setVoiceError('Failed to transcribe audio. Please try again.');
      }
    } catch {
      setVoiceError('Failed to process voice input. Please try again.');
    }
    setIsProcessingVoice(false);
  };

  mediaRecorder.start(100);

  const autoStopTimer = window.setTimeout(() => {
    if (mediaRecorder.state === 'recording') mediaRecorder.stop();
  }, 10000);

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

    const ARM_RMS = 0.02;
    const SPEECH_RMS = 0.01;
    const SILENCE_MS = 900;
    const MIN_RECORDING_MS = 1200;
    const recordingStartedAt = performance.now();
    let armed = false;
    let lastLoudAt = 0;
    let triggered = false;

    const tick = () => {
      if (triggered || mediaRecorder.state !== 'recording') return;
      analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const n = (buf[i] - 128) / 128;
        sumSq += n * n;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      const now = performance.now();

      if (!armed) {
        if (rms > ARM_RMS) {
          armed = true;
          lastLoudAt = now;
        }
      } else if (rms > SPEECH_RMS) {
        lastLoudAt = now;
      } else if (
        now - lastLoudAt > SILENCE_MS &&
        now - recordingStartedAt > MIN_RECORDING_MS
      ) {
        triggered = true;
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
        return;
      }
      vadRaf = requestAnimationFrame(tick);
    };
    vadRaf = requestAnimationFrame(tick);
  } catch {
    // VAD is best-effort only.
  }

  (window as any).__vadCleanup = () => {
    if (vadRaf) cancelAnimationFrame(vadRaf);
    if (vadCtx && vadCtx.state !== 'closed') vadCtx.close().catch(() => undefined);
  };
};

// Voice recording
const startVoiceRecognition = async () => {
  if (isListening) {
    stopVoiceRecordingRef.current();
    return;
  }
  if (isProcessingVoice) {
    return;
  }

  setVoiceError(null);
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
  if (isTauri() && whisperVoiceEnabled && typeof MediaRecorder !== 'undefined') {
    try {
      await startWhisperRecording();
      return;
    } catch {
      voiceInputModeRef.current = null;
      setIsListening(false);
      setIsProcessingVoice(false);
    }
  }

  if (isTauri()) {
    try {
      await startNativeVoiceRecognition();
      return;
    } catch {
      await resetNativeVoiceSession().catch(() => undefined);
      setIsListening(false);
      setIsProcessingVoice(false);
      voiceInputModeRef.current = null;
    }
  }

  try {
    await startWhisperRecording();
  } catch (err: any) {
    voiceInputModeRef.current = null;
    const nativeMessage = getNativeSpeechErrorMessage(err);
    setVoiceError(
      err?.name === 'NotAllowedError'
        ? 'Microphone access denied. Enable it in System Settings > Privacy & Security > Microphone.'
        : formatNativeSpeechError(nativeMessage),
    );
    setIsListening(false);
    setIsProcessingVoice(false);
  }
};

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

    // Commit whatever partial transcript we already have *immediately* so the
    // user sees their text without waiting for Swift's final-event round trip.
    // Read from the ref so callers from stale closures (poll loop, auto-stop)
    // see the latest value.
    const liveTranscript = partialTranscriptRef.current?.trim();
    partialTranscriptRef.current = null;
    setIsListening(false);
    if (liveTranscript) {
      setInput(liveTranscript);
      setPartialTranscript(null);
      setIsProcessingVoice(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    } else {
      setIsProcessingVoice(true);
    }

    void stopNativeDesktopSpeechRecognition()
      .catch((error: any) => {
        if (!liveTranscript) {
          setVoiceError(`Voice error: ${error?.message || 'Failed to stop native speech recognition.'}`);
        }
        return Promise.resolve();
      })
      .finally(() => {
        // If we already committed a live transcript, just tear down quietly
        // and ignore the lagging final event.
        if (liveTranscript) {
          void resetNativeVoiceSession();
          voiceInputModeRef.current = null;
          return;
        }
        nativeVoiceFinalizeTimeoutRef.current = window.setTimeout(() => {
          void resetNativeVoiceSession();
          setIsProcessingVoice(false);
          voiceInputModeRef.current = null;
          setVoiceError('No speech detected. Please try again.');
        }, 800);
      });
    return;
  }

  const mediaRecorder = (window as any).__mediaRecorder;
  const autoStopTimer = (window as any).__autoStopTimer;
  const vadCleanup = (window as any).__vadCleanup;
  if (autoStopTimer) clearTimeout(autoStopTimer);
  if (typeof vadCleanup === 'function') {
    vadCleanup();
    (window as any).__vadCleanup = null;
  }
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  voiceInputModeRef.current = null;
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    setAudioStream(null);
  }
  setIsListening(false);
}, [audioStream, resetNativeVoiceSession, setInput, stopDeepgramDictation, textareaRef]);

useEffect(() => {
  stopVoiceRecordingRef.current = stopVoiceRecording;
}, [stopVoiceRecording]);


  return {
    audioStream,
    isListening,
    isProcessingVoice,
    partialTranscript,
    startVoiceRecognition,
  };
}
