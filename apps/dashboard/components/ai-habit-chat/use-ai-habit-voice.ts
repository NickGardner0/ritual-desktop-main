import { ensureMicrophonePermission } from '@/lib/tauri-utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { useDeepgramDictation } from '@/lib/voice/use-deepgram-dictation';
import { normalizeLoggerVoiceTranscript } from './local-log-parser';
import {
  clearNativeDesktopSpeechState,
  formatNativeSpeechError,
  getNativeSpeechErrorMessage,
  getNativeDesktopSpeechState,
  startNativeDesktopSpeechRecognition,
  stopNativeDesktopSpeechRecognition,
} from '@/lib/native-voice';

export type UseAiHabitVoiceOptions = {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useAiHabitVoice({ textareaRef, setInput, setError }: UseAiHabitVoiceOptions) {
  const { isDesktop, supportsNativeVoice } = useDesktopCapabilities();
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [partialTranscript, setPartialTranscript] = useState<string | null>(null);
  const nativeVoicePollRef = useRef<number | null>(null);
  const nativeVoiceAutoStopRef = useRef<number | null>(null);
  const nativeVoiceFinalizeTimeoutRef = useRef<number | null>(null);
  const nativeVoiceTimestampRef = useRef(0);
  const voiceInputModeRef = useRef<'native' | 'whisper' | 'deepgram' | null>(null);
  // Mirror of partialTranscript readable from stale closures.
  const partialTranscriptRef = useRef<string | null>(null);
  // Audio-level silence detector state
  const nativeVoiceSilenceAudioCtxRef = useRef<AudioContext | null>(null);
  const nativeVoiceSilenceRafRef = useRef<number | null>(null);
  const nativeVoiceHadSpeechRef = useRef(false);
  // Transcript-stability auto-stop: timestamp of the last time the partial changed.
  const nativeVoicePartialLastChangeRef = useRef<number>(0);
  const nativeVoicePartialLastValueRef = useRef<string>('');
  const stopVoiceRecordingRef = useRef<() => void>(() => undefined);
  const clearNativeVoiceTimers = useCallback(() => {
    if (nativeVoiceSilenceRafRef.current) {
      cancelAnimationFrame(nativeVoiceSilenceRafRef.current);
      nativeVoiceSilenceRafRef.current = null;
    }
    if (nativeVoiceSilenceAudioCtxRef.current) {
      nativeVoiceSilenceAudioCtxRef.current.close().catch(() => undefined);
      nativeVoiceSilenceAudioCtxRef.current = null;
    }
    nativeVoiceHadSpeechRef.current = false;
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
    setError(null);
    setIsProcessingVoice(false);
    await resetNativeVoiceSession();
    if (!(await ensureMicrophonePermission())) {
      throw new Error('microphone-permission-denied');
    }

    // Parallel mic stream: used purely to power the waveform visualization.
    // (Audio-level silence detection is unreliable because Swift's AVAudioEngine
    // effectively captures the mic and WebKit's getUserMedia returns a near-silent
    // duplicate. We use transcript-stability auto-stop instead — see poll loop.)
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

    // Transcript-stability auto-stop: if the partial transcript hasn't advanced
    // for PARTIAL_STABLE_MS while we have non-empty text, Swift has effectively
    // finished recognizing — commit immediately instead of waiting for its final.
    const PARTIAL_STABLE_MS = 700;

    nativeVoicePollRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const state = await getNativeDesktopSpeechState();

          // Staleness check fires on every tick regardless of new events.
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
              setError('No speech detected. Please try again.');
            }
            return;
          }

          if (state.event === 'ritual:speech:error') {
            await resetNativeVoiceSession();
            setPartialTranscript(null);
            setIsListening(false);
            setIsProcessingVoice(false);
            setError(formatNativeSpeechError(state.transcript));
            return;
          }

          if (state.event === 'ritual:speech:status' && state.transcript === 'stopped') {
            await resetNativeVoiceSession();
            setPartialTranscript(null);
            setIsListening(false);
            setIsProcessingVoice(false);
            setError('No speech detected. Please try again.');
          }
        } catch (pollError: any) {
          await resetNativeVoiceSession();
          setIsListening(false);
          setIsProcessingVoice(false);
          setError(`Voice error: ${pollError?.message || 'Unknown native speech error'}`);
        }
      })();
    }, 75);

    // Hard safety: force-stop after 15s if the silence detector never fires.
    nativeVoiceAutoStopRef.current = window.setTimeout(() => {
      stopVoiceRecordingRef.current();
    }, 15000);
  }, [resetNativeVoiceSession, setError, setInput, textareaRef]);

  // Feature flag: use MediaRecorder + Groq Whisper instead of the macOS
  // SFSpeechRecognizer path. Whisper is faster + more accurate and, unlike the
  // Swift path, actually lets us do audio-level VAD because we own the mic.
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
      setInput(normalizeLoggerVoiceTranscript(text));
      setTimeout(() => textareaRef.current?.focus(), 100);
    },
    onError: setError,
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
    if (!mimeType && !isDesktop) {
      // Browsers should always have at least one — fall through with default.
    }

    const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const audioChunks: Blob[] = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      setIsListening(false);
      setIsProcessingVoice(true);
      stream.getTracks().forEach((track) => track.stop());
      setAudioStream(null);

      if (audioChunks.length === 0) {
        setError('No audio recorded. Please try again.');
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
            setInput(normalizeLoggerVoiceTranscript(result.text));
            setTimeout(() => textareaRef.current?.focus(), 100);
          } else {
            setError('No speech detected. Please try again.');
          }
        } else {
          setError('Failed to transcribe audio. Please try again.');
        }
      } catch {
        setError('Failed to process voice input. Please try again.');
      }
      setIsProcessingVoice(false);
    };

    mediaRecorder.start(100);

    // Hard safety: force-stop after 10s if VAD never arms.
    const autoStopTimer = window.setTimeout(() => {
      if (mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, 10000);

    (window as any).__mediaRecorder = mediaRecorder;
    (window as any).__autoStopTimer = autoStopTimer;

    // Audio-level VAD silence detection. Unlike the Swift path, MediaRecorder
    // here has exclusive mic access so the analyser stream is real audio.
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
      // VAD is best-effort — safety timeout still covers us.
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

    setError(null);

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
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access denied. Enable it in System Settings > Privacy & Security > Microphone.'
          : formatNativeSpeechError(nativeMessage),
      );
      setIsListening(false);
      setIsProcessingVoice(false);
    }
  };

  function stopVoiceRecording() {
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

      // Commit the live partial transcript from the ref immediately; don't wait
      // for Swift's lagging final event. Read from a ref so the poll-interval
      // and silence-detector closures both see the latest value.
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
            setError(`Voice error: ${error?.message || 'Failed to stop native speech recognition.'}`);
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
            setError('No speech detected. Please try again.');
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
  }

  useEffect(() => {
    stopVoiceRecordingRef.current = stopVoiceRecording;
  });

  return {
    isListening,
    isProcessingVoice,
    audioStream,
    partialTranscript,
    startVoiceRecognition,
    stopVoiceRecording,
  };
}
