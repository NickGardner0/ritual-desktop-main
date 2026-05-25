"use client"

import React, { startTransition, useDeferredValue, useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { ArrowUp, ArrowUpRight, AudioLines, Paperclip } from 'lucide-react';
import { cn } from "@/lib/utils";
import { useHabits } from '@/contexts/HabitsContext';
import { useUser, useAuth } from '@clerk/nextjs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { VoiceWaveform, VoiceWaveformMini } from './voice-waveform';
import { useAnalytics } from '@/lib/analytics';
import { buildInstantSuggestions, mergeSuggestions, type ChatSuggestion } from '@/lib/ai/chat-suggestions';
import { ensureMicrophonePermission, isTauri } from '@/lib/tauri-utils';
import { useDeepgramDictation } from '@/lib/voice/use-deepgram-dictation';
import { useAiHabitLogMutation } from '@/hooks/use-ai-habit-log-mutation';
import { BrailleSpinner } from './ai-habit-chat/braille-spinner';
import { ScreenshotConfirmationModal } from './ai-habit-chat/screenshot-confirmation-modal';
import {
  buildDeterministicLogSuggestion,
  getHabitByParsedName,
  getParsedDisplayValue,
  normalizeLoggerVoiceTranscript,
  parseLocalHabitInput,
} from './ai-habit-chat/local-log-parser';
import type {
  AIHabitChatProps,
  Clarification,
  HabitOption,
  InlineSuggestionOption,
  InputMode,
  LoggingResult,
  ParsedHabitInput,
  ScreenshotPreview,
} from './ai-habit-chat/ai-habit-chat.types';
import {
  clearNativeDesktopSpeechState,
  formatNativeSpeechError,
  getNativeSpeechErrorMessage,
  getNativeDesktopSpeechState,
  startNativeDesktopSpeechRecognition,
  stopNativeDesktopSpeechRecognition,
} from '@/lib/native-voice';

const MAX_VISIBLE_INLINE_SUGGESTIONS = 2;

/**
 * Simplified AI Habit Logger
 * 
 * This component handles natural language habit logging and routes chat queries to /chat.
 */
export function AIHabitChat({ onHabitUpdate }: AIHabitChatProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [partialTranscript, setPartialTranscript] = useState<string | null>(null);
  const [mode, setMode] = useState<InputMode>('log');
  const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  
  // Screenshot confirmation flow state
  const [screenshotPreview, setScreenshotPreview] = useState<ScreenshotPreview | null>(null);
  const [editedValue, setEditedValue] = useState<string>('');
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showHabitPicker, setShowHabitPicker] = useState(false);
  
  // Phase 5A: Multi-intent logging state
  const [clarifications, setClarifications] = useState<Clarification[]>([]);

  // Suggestions state
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [keyboardSuggestionActive, setKeyboardSuggestionActive] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsAbortRef = useRef<AbortController | null>(null);
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
  const { habits, habitLogs } = useHabits();
  const { user } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { trackAIChatMessageSent, trackHabitLogged } = useAnalytics();
  const deferredInput = useDeferredValue(input.trim());
  const {
    submitDirectLog,
    submitAiFallback,
    submitClarification,
    isAiSubmitting,
  } = useAiHabitLogMutation({
    userId: user?.id,
    getToken,
    onHabitUpdate,
    trackHabitLogged,
  });
  const submitButtonLoading = isAiSubmitting;

  useEffect(() => {
    router.prefetch('/chat');
  }, [router]);

  useEffect(() => {
    const compose = searchParams.get('compose');
    const prefillValue = searchParams.get('prefill');
    if (compose !== 'log' && !prefillValue) return;

    setMode('log');
    if (prefillValue) {
      setInput(prefillValue);
    }

    window.setTimeout(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      const end = (prefillValue || '').length;
      node.setSelectionRange(end, end);
    }, 30);

    const params = new URLSearchParams(searchParams.toString());
    params.delete('compose');
    params.delete('prefill');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });

  }, [pathname, router, searchParams]);

  const screenshotHabitOptions = useMemo<HabitOption[]>(() => {
    if (!screenshotPreview) return [];

    const optionMap = new Map<string, HabitOption>();

    screenshotPreview.available_habits.forEach((habit) => {
      if (!habit.id) return;
      optionMap.set(habit.id, {
        id: habit.id,
        name: habit.name,
        unit_type: habit.unit_type || '',
      });
    });

    habits.forEach((habit) => {
      if (!habit.id) return;
      if (optionMap.has(habit.id)) return;
      optionMap.set(habit.id, {
        id: habit.id,
        name: habit.name,
        unit_type: habit.unit_type || '',
      });
    });

    return Array.from(optionMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [screenshotPreview, habits]);

  const selectedScreenshotHabit = useMemo(() => {
    if (!selectedHabitId) return null;
    return screenshotHabitOptions.find((habit) => habit.id === selectedHabitId) ?? null;
  }, [selectedHabitId, screenshotHabitOptions]);

  // ================================
  // SUGGESTIONS - Perplexity-style autocomplete
  // ================================

  const fetchSuggestions = useCallback(async (
    currentMode: InputMode,
    query: string,
    signal?: AbortSignal
  ): Promise<ChatSuggestion[]> => {
    try {
      const sessionToken = await getToken();
      const params = new URLSearchParams({ mode: currentMode, q: query });

      const response = await fetch(`/api/suggestions?${params.toString()}`, {
        cache: 'no-store',
        signal,
        headers: {
          Authorization: sessionToken ? `Bearer ${sessionToken}` : '',
        },
      });

      if (response.ok) {
        const data = await response.json();
        return (data.suggestions || []).slice(0, 5).map((suggestion: ChatSuggestion) => ({
          ...suggestion,
          score: suggestion.score || 0,
          source: 'server',
        }));
      }

      return [];
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return [];
      }
      console.error('Suggestions fetch error:', err);
      return [];
    }
  }, [getToken]);

  // Instant local suggestions
  useEffect(() => {
    const deterministicSuggestion = buildDeterministicLogSuggestion(deferredInput, mode, habits);
    const localSuggestions = deterministicSuggestion
      ? [deterministicSuggestion]
      : buildInstantSuggestions({
          mode,
          query: deferredInput,
          habits,
          habitLogs,
          limit: 4,
        });

    startTransition(() => {
      setSuggestions(localSuggestions);
      setSelectedSuggestionIndex(0);
      setKeyboardSuggestionActive(false);
    });
  }, [mode, deferredInput, habits, habitLogs]);

  // Async server enrichment
  useEffect(() => {
    const deterministicSuggestion = buildDeterministicLogSuggestion(deferredInput, mode, habits);
    if (deterministicSuggestion) {
      suggestionsAbortRef.current?.abort();
      suggestionsAbortRef.current = null;
      return;
    }

    const localSuggestions = buildInstantSuggestions({
      mode,
      query: deferredInput,
      habits,
      habitLogs,
      limit: 4,
    });

    suggestionsAbortRef.current?.abort();
    const controller = new AbortController();
    suggestionsAbortRef.current = controller;

    const timer = window.setTimeout(async () => {
      const remoteSuggestions = await fetchSuggestions(mode, deferredInput, controller.signal);
      if (controller.signal.aborted) return;

      startTransition(() => {
        setSuggestions(mergeSuggestions(localSuggestions, remoteSuggestions, 4));
      });
    }, deferredInput ? 120 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mode, deferredInput, habits, habitLogs, fetchSuggestions]);

  // Focus/blur handlers with delay so clicking a suggestion registers before blur hides it
  const handleInputFocus = useCallback(() => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setIsFocused(true);
    setSelectedSuggestionIndex(0);
    setKeyboardSuggestionActive(false);
  }, []);

  const handleInputBlur = useCallback(() => {
    // Small delay so suggestion click events fire before we hide
    blurTimeoutRef.current = setTimeout(() => {
      setIsFocused(false);
    }, 200);
  }, []);

  // Handle suggestion click
  const handleSuggestionClick = useCallback((suggestion: ChatSuggestion) => {
    if (mode === 'chat') {
      // Chat mode: route to dedicated chat page
      const question = suggestion.text.trim();
      if (!question) return;
      setInput('');
      setIsFocused(false);
      trackAIChatMessageSent({ messageLength: question.length });
      router.prefetch('/chat');
      router.push(`/chat?q=${encodeURIComponent(question)}`);
      return;
    }

    // Log mode
    if (suggestion.type === 'log_phrase' && suggestion.value) {
      // Value-based suggestion (e.g. "200mg of caffeine") — fill and auto-submit
      setInput(suggestion.text);
      setIsFocused(false);
      // Auto-submit after a brief tick so React processes the state update
      setTimeout(() => {
        const form = textareaRef.current?.closest('form');
        if (form) {
          form.requestSubmit();
        }
      }, 50);
    } else {
      // Habit-name suggestion — fill input for user to add a value
      const habitText = suggestion.habit_name || suggestion.text;
      setInput(habitText + ' ');
      setSelectedSuggestionIndex(0);
      setKeyboardSuggestionActive(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [mode, router, trackAIChatMessageSent]);

  const visibleSuggestions = useMemo(
    () => suggestions.slice(0, MAX_VISIBLE_INLINE_SUGGESTIONS),
    [suggestions],
  );

  const clarificationOptions = useMemo<InlineSuggestionOption[]>(() => {
    return clarifications.flatMap((clarification, clarificationIndex) =>
      clarification.alternatives.map((alternative) => ({
        kind: 'clarification' as const,
        key: `clarification-${clarificationIndex}-${alternative.id}`,
        label: `${alternative.name}${clarification.value != null ? ` — ${clarification.value} ${clarification.unit || ''}` : ''}`.trim(),
        sublabel: `Use ${alternative.name} for "${clarification.habit_hint}"`,
        clarificationIndex,
        habitId: alternative.id,
        habitName: alternative.name,
      }))
    );
  }, [clarifications]);

  const visibleInlineOptions = useMemo<InlineSuggestionOption[]>(
    () => clarificationOptions.length > 0
      ? clarificationOptions.slice(0, MAX_VISIBLE_INLINE_SUGGESTIONS)
      : visibleSuggestions.map((suggestion, idx) => ({
          kind: 'suggestion' as const,
          key: `suggestion-${suggestion.type}-${idx}-${suggestion.text.slice(0, 20)}`,
          label: suggestion.text,
          suggestion,
        })),
    [clarificationOptions, visibleSuggestions],
  );

  useEffect(() => {
    if (visibleInlineOptions.length === 0) {
      if (selectedSuggestionIndex !== 0) setSelectedSuggestionIndex(0);
      return;
    }
    if (selectedSuggestionIndex >= visibleInlineOptions.length) {
      setSelectedSuggestionIndex(0);
    }
  }, [selectedSuggestionIndex, visibleInlineOptions]);

  const parseHabitInput = useCallback(
    (rawText: string): ParsedHabitInput | null => parseLocalHabitInput(rawText, habits),
    [habits],
  );

  const findHabitByParsedName = useCallback(
    (habitName?: string | null) => getHabitByParsedName(habits, habitName),
    [habits],
  );

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || submitButtonLoading) return;

    const inputText = input.trim();

    // Chat mode: hand off to dedicated chat page
    if (mode === 'chat') {
      setInput('');
      setError(null);
      trackAIChatMessageSent({ messageLength: inputText.length });
      router.prefetch('/chat');
      router.push(`/chat?q=${encodeURIComponent(inputText)}`);
      return;
    }

    // Log mode: fast single-habit path first, then fall back to AI parsing.
    setError(null);
    setClarifications([]);
    
    // Track AI chat message for logging mode
    trackAIChatMessageSent({ messageLength: inputText.length });

    // Clear immediately for responsive logger UX; restore below if clarification
    // or an error requires the original text again.
    setInput('');

    // OPTIMISTIC UPDATE: Try to parse locally first for instant feedback
    const localParsed = parseHabitInput(inputText);
    const matchedHabit = findHabitByParsedName(localParsed?.habitName);

    if (localParsed?.success && matchedHabit) {
      if (onHabitUpdate) {
        // Send optimistic update IMMEDIATELY (before API call)
        onHabitUpdate({
          success: true,
          optimisticUpdate: true,
          habitId: matchedHabit.id,
          duration: localParsed.duration || undefined,
          amount: localParsed.amount || undefined,
          unit: localParsed.unit || matchedHabit.unit_type || undefined,
          playSound: true,
          refreshNeeded: false,
        });
        console.log('⚡ Direct local log path for:', matchedHabit.name);
      }

      try {
        await submitDirectLog({
          inputText,
          parsed: localParsed,
          matchedHabit,
          displayValue: getParsedDisplayValue(localParsed, matchedHabit.unit_type),
        });
        setInput('');
        setIsFocused(false);
        return;
      } catch (err) {
        console.error('Direct log error:', err);
        setInput((current) => current.trim() ? current : inputText);
        setIsFocused(true);
        setTimeout(() => textareaRef.current?.focus(), 0);
        setError('Failed to log your habit. Please try again.');
        return;
      }
    }

    // Fall back to AI parsing only when the local fast path cannot resolve a single habit.
    try {
      const result: LoggingResult = await submitAiFallback(inputText);
      
      // Handle clarifications needed
      if (result.clarifications && result.clarifications.length > 0) {
        setClarifications(result.clarifications);
        setInput(inputText);
        setIsFocused(true);
        setSelectedSuggestionIndex(0);
        setKeyboardSuggestionActive(false);
        setTimeout(() => textareaRef.current?.focus(), 0);
      } else if (result.success) {
        setInput('');
        setIsFocused(false);
      }
      
      // Show error if nothing worked
      if (!result.success && result.clarifications?.length === 0) {
        setInput(inputText);
        setIsFocused(true);
        setTimeout(() => textareaRef.current?.focus(), 0);
        setError(result.message || 'Could not log any habits. Please try again.');
      }

    } catch (err) {
      console.error('Log error:', err);
      setInput(inputText);
      setIsFocused(true);
      setTimeout(() => textareaRef.current?.focus(), 0);
      setError('Failed to process your request. Please try again.');
    }
  };
  
  // Phase 5A: Handle clarification selection
  const handleClarificationSelect = async (clarificationIndex: number, habitId: string, habitName: string) => {
    const clarification = clarifications[clarificationIndex];
    if (!clarification) return;

    try {
      await submitClarification({
        clarification,
        habitId,
        habitName,
      });
      setClarifications(prev => prev.filter((_, i) => i !== clarificationIndex));
      setInput('');
      setIsFocused(false);
    } catch (err) {
      console.error('Clarification log error:', err);
      setError('Failed to log. Please try again.');
    }
  };

  const handleInlineOptionSelect = useCallback((option: InlineSuggestionOption) => {
    if (option.kind === 'clarification') {
      handleClarificationSelect(option.clarificationIndex, option.habitId, option.habitName);
      return;
    }
    handleSuggestionClick(option.suggestion);
  }, [handleSuggestionClick, handleClarificationSelect]);

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
            stopVoiceRecording();
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
      stopVoiceRecording();
    }, 15000);
  }, [resetNativeVoiceSession]);

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
    if (!mimeType && !isTauri()) {
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
      stopVoiceRecording();
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
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access denied. Enable it in System Settings > Privacy & Security > Microphone.'
          : formatNativeSpeechError(nativeMessage),
      );
      setIsListening(false);
      setIsProcessingVoice(false);
    }
  };

  const stopVoiceRecording = () => {
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
  };

  // Screen Time screenshot upload handlers
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Compress image before upload to reduce size and speed up AI analysis
  const compressImage = async (file: File, maxWidth = 1200, quality = 0.8): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions while maintaining aspect ratio
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to blob with compression
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Could not compress image'));
              return;
            }
            
            // Create new file from blob
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            
            console.log(`📸 Image compressed: ${(file.size / 1024).toFixed(0)}KB → ${(compressedFile.size / 1024).toFixed(0)}KB`);
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  };

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPG, etc.)');
      e.target.value = '';
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be under 10MB');
      e.target.value = '';
      return;
    }

    setIsUploadingScreenshot(true);
    setError(null);
    
    // Store filename for display (no image preview needed)
    setUploadedFileName(file.name);

    try {
      const startTime = performance.now();
      
      // Compress image before upload - smaller = faster OpenAI processing
      // 800px width + 70% quality is enough for text recognition
      const compressedFile = await compressImage(file, 800, 0.7);
      console.log(`⏱️ Compression: ${(performance.now() - startTime).toFixed(0)}ms`);
      
      const uploadStart = performance.now();
      const sessionToken = await getToken();
      const formData = new FormData();
      formData.append('file', compressedFile);

      // Get the Python API URL from environment
      const apiUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      
      // Use the preview endpoint for confirmation flow
      const res = await fetch(`${apiUrl}/api/screenshot/preview`, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': sessionToken ? `Bearer ${sessionToken}` : '',
        },
      });
      console.log(`⏱️ API call (upload + OpenAI): ${(performance.now() - uploadStart).toFixed(0)}ms`);
      console.log(`⏱️ Total time: ${(performance.now() - startTime).toFixed(0)}ms`);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.detail || 'Failed to process screenshot';
        setError(errorMessage);
        setUploadedFileName(null);
        return;
      }

      const data: ScreenshotPreview = await res.json();
      
      // Set preview data for confirmation
      setScreenshotPreview(data);
      setEditedValue(String(data.value));
      setSelectedHabitId(data.habit_id);
      setShowHabitPicker(false);
      
      // Clear any existing input
      setInput('');

    } catch (err: any) {
      console.error('Screenshot upload error:', err);
      setError(err.message || 'Failed to upload screenshot. Please try again.');
      setUploadedFileName(null);
    } finally {
      setIsUploadingScreenshot(false);
      // Reset input so the same file can be selected again if needed
      e.target.value = '';
    }
  };

  // Confirm and log the screenshot data
  const handleConfirmScreenshot = async () => {
    if (!screenshotPreview) return;
    
    setIsConfirming(true);
    setError(null);

    try {
      const sessionToken = await getToken();
      const apiUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      
      // Find the selected habit name
      const habitName = selectedScreenshotHabit?.name || screenshotPreview.habit_name;
      const habitUnit = selectedScreenshotHabit?.unit_type || screenshotPreview.unit;
      
      const res = await fetch(`${apiUrl}/api/screenshot/confirm`, {
        method: 'POST',
        headers: {
          'Authorization': sessionToken ? `Bearer ${sessionToken}` : '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          habit_id: selectedHabitId,
          habit_name: habitName,
          value: parseFloat(editedValue) || screenshotPreview.value,
          unit: habitUnit,
          detected_type: screenshotPreview.detected_type,
          description: screenshotPreview.description,
          create_new_habit: screenshotPreview.is_new_habit && !selectedHabitId,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        setError(errorData.detail || 'Failed to log screenshot data');
        return;
      }

      const data = await res.json();
      
      // Clear preview state
      setUploadedFileName(null);
      setScreenshotPreview(null);
      setEditedValue('');
      setSelectedHabitId(null);
      
      // Trigger habit update callback to refresh dashboard data
      if (onHabitUpdate) {
        onHabitUpdate({
          success: true,
          refreshNeeded: true,
          playSound: true,
          message: data.message || `Logged ${data.value} ${data.unit} of ${data.habit_name}.`,
        });
      }

      // Track the successful upload
      trackHabitLogged({
        habitId: data.habit_id,
        habitName: data.habit_name,
        value: data.value,
        unit: data.unit,
        source: 'screenshot',
      });

    } catch (err: any) {
      console.error('Screenshot confirm error:', err);
      setError(err.message || 'Failed to confirm. Please try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  // Cancel the screenshot preview
  const handleCancelScreenshot = () => {
    setUploadedFileName(null);
    setScreenshotPreview(null);
    setEditedValue('');
    setSelectedHabitId(null);
    setShowHabitPicker(false);
    setIsUploadingScreenshot(false);
    setError(null);
  };

  const adjustEditedValue = (delta: number) => {
    const parsed = Number.parseFloat(editedValue);
    const fallback = screenshotPreview?.value ?? 0;
    const base = Number.isFinite(parsed) ? parsed : fallback;
    const next = Math.max(0, Math.round((base + delta) * 10) / 10);
    setEditedValue(next.toString());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const canUseSuggestions =
      isFocused &&
      visibleInlineOptions.length > 0 &&
      !error &&
      !isListening &&
      !isProcessingVoice &&
      !isUploadingScreenshot &&
      !screenshotPreview

    if (canUseSuggestions && e.key === 'ArrowDown') {
      e.preventDefault();
      setKeyboardSuggestionActive(true);
      setSelectedSuggestionIndex((prev) => (prev + 1) % visibleInlineOptions.length);
      return;
    }

    if (canUseSuggestions && e.key === 'ArrowUp') {
      e.preventDefault();
      setKeyboardSuggestionActive(true);
      setSelectedSuggestionIndex((prev) => (prev - 1 + visibleInlineOptions.length) % visibleInlineOptions.length);
      return;
    }

    if (canUseSuggestions && e.key === 'Tab' && visibleInlineOptions[selectedSuggestionIndex]) {
      e.preventDefault();
      handleInlineOptionSelect(visibleInlineOptions[selectedSuggestionIndex]);
      return;
    }

    if (canUseSuggestions && e.key === 'Enter' && !e.shiftKey && keyboardSuggestionActive && visibleInlineOptions[selectedSuggestionIndex]) {
      e.preventDefault();
      handleInlineOptionSelect(visibleInlineOptions[selectedSuggestionIndex]);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFormSubmit(e as any);
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const showSuggestions =
    isFocused &&
    (clarificationOptions.length > 0 || input.trim().length > 0) &&
    visibleInlineOptions.length > 0 &&
    !error &&
    !isListening &&
    !isProcessingVoice &&
    !isUploadingScreenshot &&
    !screenshotPreview

  return (
    <div className="w-full">
      {/* Screenshot Modal - Compact macOS-inspired */}
      <ScreenshotConfirmationModal
        isUploadingScreenshot={isUploadingScreenshot}
        screenshotPreview={screenshotPreview}
        uploadedFileName={uploadedFileName}
        editedValue={editedValue}
        setEditedValue={setEditedValue}
        selectedHabitId={selectedHabitId}
        setSelectedHabitId={setSelectedHabitId}
        selectedScreenshotHabit={selectedScreenshotHabit}
        screenshotHabitOptions={screenshotHabitOptions}
        showHabitPicker={showHabitPicker}
        setShowHabitPicker={setShowHabitPicker}
        isConfirming={isConfirming}
        adjustEditedValue={adjustEditedValue}
        handleCancelScreenshot={handleCancelScreenshot}
        handleConfirmScreenshot={handleConfirmScreenshot}
      />

      <div className="relative border border-gray-200/80 bg-[#F9F9F9] shadow-sm rounded-sm transition-all duration-300 hover:shadow-md hover:border-gray-300 focus-within:shadow-md focus-within:border-gray-300">
        <form onSubmit={handleFormSubmit}>
          <div className="px-5 pt-3 pb-3">
            {/* Input Area */}
            <div className="mb-1 relative">
              {isListening && audioStream ? (
                <div className="w-full flex flex-col items-center justify-center gap-1">
                  <div className="w-full h-[42px] flex items-center justify-center">
                    <VoiceWaveform isActive={true} audioStream={audioStream} className="h-10 w-full" />
                  </div>
                </div>
              ) : isListening || isProcessingVoice ? (
                <div className="w-full h-[42px]" aria-hidden />
              ) : (
                <textarea
                  ref={textareaRef}
                  value={isListening && partialTranscript ? partialTranscript : input}
                  onChange={(e) => {
                    if (clarifications.length > 0) {
                      setClarifications([]);
                    }
                    setInput(e.target.value);
                    setSelectedSuggestionIndex(0);
                    setKeyboardSuggestionActive(false);
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  placeholder={isListening
                    ? "Listening..."
                    : mode === 'log'
                      ? "Log anything..."
                      : "Ask about your personal data..."
                  }
                  className="w-full resize-none border-0 outline-none text-base text-gray-900 placeholder-gray-500 bg-transparent py-1.5 font-normal leading-6"
                  rows={1}
                  disabled={submitButtonLoading}
                  readOnly={isListening}
                />
              )}
            </div>

            <div
              className={cn(
                "overflow-hidden transition-all duration-150 ease-out",
                showSuggestions ? "max-h-[104px] opacity-100 pt-1 pb-0" : "max-h-0 opacity-0"
              )}
            >
              <div className="max-h-[98px] overflow-y-auto border-t border-gray-200/70 pt-0.5">
                {visibleInlineOptions.map((option, idx) => (
                  <button
                    key={option.key}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleInlineOptionSelect(option)}
                    onMouseEnter={() => {
                      setSelectedSuggestionIndex(idx);
                      setKeyboardSuggestionActive(true);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 px-0 py-[7px] text-left text-[13px] transition-colors group",
                      idx === selectedSuggestionIndex
                        ? "text-gray-950"
                        : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate leading-snug">{option.label}</div>
                      {option.kind === 'clarification' && option.sublabel && (
                        <div className="truncate text-[11px] leading-snug text-gray-400">
                          {option.sublabel}
                        </div>
                      )}
                    </div>
                    <ArrowUpRight
                      className={cn(
                        "w-3 h-3 flex-shrink-0 transition-colors",
                        idx === selectedSuggestionIndex ? "text-gray-500" : "text-gray-300 group-hover:text-gray-500"
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="mb-2 p-2 bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Bottom Row */}
            <div className="flex justify-between items-center mt-1.5">
              {/* Left side: Mode Toggle + Voice Button */}
              <div className="flex items-center gap-2 text-gray-600">
                {/* Mode Toggle - iOS style (FIRST) */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMode(mode === 'log' ? 'chat' : 'log')}
                    className={cn(
                      "relative w-9 h-5 rounded-full transition-colors duration-200 ease-in-out focus:outline-none",
                      mode === 'chat' ? "bg-gray-900" : "bg-gray-300"
                    )}
                    role="switch"
                    aria-checked={mode === 'chat'}
                    aria-label="Toggle between log and chat mode"
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ease-in-out",
                        mode === 'chat' ? "translate-x-4" : "translate-x-0"
                      )}
                    />
                  </button>
                  {mode === 'chat' ? (
                    <button
                      type="button"
                      onClick={() => router.push('/chat')}
                      className="text-xs text-gray-600 font-medium hover:text-gray-900 hover:underline transition-colors"
                      title="Open chat history"
                    >
                      Chat
                    </button>
                  ) : (
                    <span className="text-xs text-gray-500 font-medium">
                      Log
                    </span>
                  )}
                </div>

                {/* Voice Button (SECOND) */}
                <div className="relative group">
                  <button
                    type="button"
                    className={cn(
                      "w-8 h-8 flex items-center justify-center transition-all duration-200 bg-transparent hover:bg-transparent",
                      isListening || isProcessingVoice
                        ? "text-gray-900"
                        : "text-gray-600 hover:text-gray-800"
                    )}
                    onClick={startVoiceRecognition}
                    aria-label={isListening ? 'Stop recording' : 'Start voice recording'}
                  >
                    {isListening ? (
                      <VoiceWaveformMini isActive={isListening} />
                    ) : isProcessingVoice ? (
                      <BrailleSpinner className="text-sm text-gray-900" />
                    ) : (
                      <AudioLines className="w-[18px] h-[18px] stroke-[1.5]" />
                    )}
                  </button>
                  {/* Tooltip */}
                  {!isListening && !isProcessingVoice && (
                    <div className="absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                      Voice Mode
                    </div>
                  )}
                </div>

                {/* Screen Time Upload Button (THIRD) */}
                <div className="relative group">
                  <button
                    type="button"
                    className={cn(
                      "w-8 h-8 flex items-center justify-center transition-all duration-200",
                      isUploadingScreenshot
                        ? "text-gray-900"
                        : "text-gray-600 hover:text-gray-800"
                    )}
                    onClick={handleUploadClick}
                    disabled={isUploadingScreenshot}
                    aria-label="Upload Screen Time screenshot"
                  >
                    {isUploadingScreenshot ? (
                      <BrailleSpinner className="text-sm text-gray-900" />
                    ) : (
                      <Paperclip className="w-4 h-4 stroke-[1.5]" />
                    )}
                  </button>
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {/* Tooltip */}
                  {!isUploadingScreenshot && (
                    <div className="absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                      Attach file
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!input.trim() || submitButtonLoading}
                className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-sm transition-colors duration-200 hover:bg-[#27251E] disabled:cursor-not-allowed"
              >
                {submitButtonLoading ? (
                  <BrailleSpinner className="text-sm text-white" />
                ) : (
                  <ArrowUp className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
