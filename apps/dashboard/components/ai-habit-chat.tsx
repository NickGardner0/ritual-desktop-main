"use client"

import React, { startTransition, useDeferredValue, useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useHabits } from '@/contexts/HabitsContext';
import { useUser, useAuth } from '@clerk/nextjs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAnalytics } from '@/lib/analytics';
import { apiOperationWithAuth } from '@/lib/api/client';
import { buildInstantSuggestions, mergeSuggestions, type ChatSuggestion } from '@/lib/ai/chat-suggestions';
import { useAiHabitLogMutation } from '@/hooks/use-ai-habit-log-mutation';
import {
  buildDeterministicLogSuggestion,
  getHabitByParsedName,
  getParsedDisplayValue,
  parseLocalHabitInput,
} from './ai-habit-chat/local-log-parser';
import type {
  AIHabitChatProps,
  Clarification,
  InlineSuggestionOption,
  InputMode,
  LoggingResult,
  ParsedHabitInput,
} from './ai-habit-chat/ai-habit-chat.types';
import { useAiHabitVoice } from './ai-habit-chat/use-ai-habit-voice';
import { useAiHabitScreenshot } from './ai-habit-chat/use-ai-habit-screenshot';
import { AiHabitChatForm } from './ai-habit-chat/ai-habit-chat-form';

const MAX_VISIBLE_INLINE_SUGGESTIONS = 2;

export function AIHabitChat({ onHabitUpdate }: AIHabitChatProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<InputMode>('log');
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [keyboardSuggestionActive, setKeyboardSuggestionActive] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsAbortRef = useRef<AbortController | null>(null);

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

  const {
    isListening,
    isProcessingVoice,
    audioStream,
    partialTranscript,
    startVoiceRecognition,
  } = useAiHabitVoice({ textareaRef, setInput, setError });

  const screenshot = useAiHabitScreenshot({
    habits,
    getToken,
    onHabitUpdate,
    trackHabitLogged,
    setError,
    setInput,
  });

  useEffect(() => {
    router.prefetch('/chat');
  }, [router]);

  useEffect(() => {
    const compose = searchParams.get('compose');
    const prefillValue = searchParams.get('prefill');
    if (compose !== 'log' && !prefillValue) return;

    queueMicrotask(() => {
      setMode('log');
      if (prefillValue) {
        setInput(prefillValue);
      }
    });

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
  // ================================
  // SUGGESTIONS - Perplexity-style autocomplete
  // ================================

  const fetchSuggestions = useCallback(async (
    currentMode: InputMode,
    query: string,
    signal?: AbortSignal
  ): Promise<ChatSuggestion[]> => {
    try {
      const data = await apiOperationWithAuth(
        'get_suggestions_api_suggestions_get',
        getToken,
        {
          query: { mode: currentMode, q: query },
          signal,
        },
      ) as { suggestions?: ChatSuggestion[] };
      return (data.suggestions || []).slice(0, 5).map((suggestion) => ({
        ...suggestion,
        score: suggestion.score || 0,
        source: 'server',
      }));
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
      if (selectedSuggestionIndex !== 0) queueMicrotask(() => setSelectedSuggestionIndex(0));
      return;
    }
    if (selectedSuggestionIndex >= visibleInlineOptions.length) {
      queueMicrotask(() => setSelectedSuggestionIndex(0));
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

    // Fast path: local parse chooses the habit, then the backend returns the
    // canonical post-write snapshot. Avoid local optimistic totals here; a
    // partial habit-log cache can otherwise zero unrelated Overview metrics.
    const localParsed = parseHabitInput(inputText);
    const matchedHabit = findHabitByParsedName(localParsed?.habitName);

    if (localParsed?.success && matchedHabit) {
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

  const handleClarificationSelect = async (clarificationIndex: number, habitId: string, habitName: string) => {
    const clarification = clarifications[clarificationIndex];
    if (!clarification) return;

    try {
      await submitClarification({ clarification, habitId, habitName });
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
  }, [handleClarificationSelect, handleSuggestionClick]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const canUseSuggestions =
      isFocused &&
      visibleInlineOptions.length > 0 &&
      !error &&
      !isListening &&
      !isProcessingVoice &&
      !screenshot.isUploadingScreenshot &&
      !screenshot.screenshotPreview

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
    !screenshot.isUploadingScreenshot &&
    !screenshot.screenshotPreview


  return (
    <AiHabitChatForm
      mode={mode}
      setMode={setMode}
      input={input}
      setInput={setInput}
      error={error}
      isListening={isListening}
      isProcessingVoice={isProcessingVoice}
      audioStream={audioStream}
      partialTranscript={partialTranscript}
      submitButtonLoading={submitButtonLoading}
      isUploadingScreenshot={screenshot.isUploadingScreenshot}
      screenshotPreview={screenshot.screenshotPreview}
      uploadedFileName={screenshot.uploadedFileName}
      editedValue={screenshot.editedValue}
      setEditedValue={screenshot.setEditedValue}
      selectedHabitId={screenshot.selectedHabitId}
      setSelectedHabitId={screenshot.setSelectedHabitId}
      selectedScreenshotHabit={screenshot.selectedScreenshotHabit}
      screenshotHabitOptions={screenshot.screenshotHabitOptions}
      showHabitPicker={screenshot.showHabitPicker}
      setShowHabitPicker={screenshot.setShowHabitPicker}
      isConfirming={screenshot.isConfirming}
      visibleInlineOptions={visibleInlineOptions}
      selectedSuggestionIndex={selectedSuggestionIndex}
      setSelectedSuggestionIndex={setSelectedSuggestionIndex}
      keyboardSuggestionActive={keyboardSuggestionActive}
      setKeyboardSuggestionActive={setKeyboardSuggestionActive}
      showSuggestions={showSuggestions}
      clarifications={clarifications}
      setClarifications={setClarifications}
      textareaRef={textareaRef}
      fileInputRef={screenshot.fileInputRef}
      router={router}
      handleFormSubmit={handleFormSubmit}
      handleKeyDown={handleKeyDown}
      handleInputFocus={handleInputFocus}
      handleInputBlur={handleInputBlur}
      handleInlineOptionSelect={handleInlineOptionSelect}
      startVoiceRecognition={startVoiceRecognition}
      handleUploadClick={screenshot.handleUploadClick}
      handleFileChange={screenshot.handleFileChange}
      handleCancelScreenshot={screenshot.handleCancelScreenshot}
      handleConfirmScreenshot={screenshot.handleConfirmScreenshot}
      adjustEditedValue={screenshot.adjustEditedValue}
    />
  );
}
