"use client"

import React, { startTransition, useDeferredValue, useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { ArrowUp, ArrowUpRight, AudioLines, Paperclip, X, Check, AlertTriangle, ChevronDown, ChevronUp, ImageIcon, Sparkles } from 'lucide-react';
import spinners, { type BrailleSpinnerName } from 'unicode-animations';
import { cn } from "@/lib/utils";
import { useHabits } from '@/contexts/HabitsContext';
import { useUser, useAuth } from '@clerk/nextjs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { VoiceWaveform, VoiceWaveformMini } from './voice-waveform';
import { useAnalytics } from '@/lib/analytics';
import { buildInstantSuggestions, mergeSuggestions, type ChatSuggestion } from '@/lib/ai/chat-suggestions';
import { isTauri } from '@/lib/tauri-utils';
import {
  clearNativeDesktopSpeechState,
  formatNativeSpeechError,
  getNativeDesktopSpeechState,
  startNativeDesktopSpeechRecognition,
  stopNativeDesktopSpeechRecognition,
} from '@/lib/native-voice';

type InputMode = 'log' | 'chat';

interface AIHabitChatProps {
  onHabitUpdate?: (habitData: any) => void;
}

// Screenshot preview data from the preview endpoint
interface ScreenshotPreview {
  habit_id: string | null;
  habit_name: string;
  value: number;
  unit: string;
  description: string;
  detected_type: string;
  confidence: number;
  low_confidence: boolean;
  validation: {
    is_valid: boolean;
    reason?: string;
    suggested_value?: number;
  };
  is_new_habit: boolean;
  available_habits: Array<{ id: string; name: string; unit_type: string }>;
}

// Phase 5A: Multi-intent logging types
interface LogResult {
  index: number;
  success: boolean;
  habit_id?: string;
  habit_name?: string;
  value?: number;
  unit?: string;
  date?: string;
  error?: string;
}

interface Clarification {
  index: number;
  habit_hint: string;
  value: number | null;
  unit: string | null;
  date: string;
  alternatives: Array<{ id: string; name: string; confidence: number }>;
  reason: string;
}

interface LoggingResult {
  success: boolean;
  message: string;
  logged: LogResult[];
  clarifications: Clarification[];
  refreshNeeded?: boolean;
  affectedHabitIds?: string[];
}

interface HabitOption {
  id: string;
  name: string;
  unit_type: string;
}

interface BrailleSpinnerProps {
  name?: BrailleSpinnerName;
  className?: string;
}

function BrailleSpinner({ name = 'braille', className }: BrailleSpinnerProps) {
  const spinner = useMemo(() => spinners[name] ?? spinners.braille, [name]);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % spinner.frames.length);
    }, spinner.interval);
    return () => window.clearInterval(timer);
  }, [spinner]);

  return (
    <span
      className={cn(
        "font-mono leading-none tracking-[-0.02em] text-base scale-110 origin-center text-[#1f2937]",
        className
      )}
      aria-hidden="true"
    >
      {spinner.frames[frame]}
    </span>
  );
}

/**
 * Simplified AI Habit Logger
 * 
 * This component handles natural language habit logging and routes chat queries to /chat.
 */
export function AIHabitChat({ onHabitUpdate }: AIHabitChatProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
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
  const [clarificationDropdownIndex, setClarificationDropdownIndex] = useState<number | null>(null);

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

  const { habits, habitLogs } = useHabits();
  const { user } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { trackAIChatMessageSent, trackHabitLogged } = useAnalytics();
  const deferredInput = useDeferredValue(input.trim());

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
    const localSuggestions = buildInstantSuggestions({
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

  // Smart habit parsing that uses your actual habits
  const parseHabitInput = (text: string) => {
    const lowerText = text.toLowerCase();

    // Extract numbers and units from the text
    const timePatterns = [
      { regex: /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr)/i, unit: 'Hours', isDuration: true, multiplier: 60 },
      { regex: /(\d+)\s*(minutes?|mins?|min)/i, unit: 'Minutes', isDuration: true, multiplier: 1 },
      { regex: /(\d+(?:\.\d+)?)\s*(miles?|mile)/i, unit: 'Miles', isDuration: false },
      { regex: /(\d+)\s*(pages?|page)/i, unit: 'Pages', isDuration: false },
      { regex: /(\d+(?:\.\d+)?)\s*(kilometers?|kms?|km)/i, unit: 'Kilometers', isDuration: false },
      { regex: /(\d+)\s*(steps?|step)/i, unit: 'Steps', isDuration: false },
      { regex: /(\d+(?:\.\d+)?)\s*(milligrams?|mgs?|mg)/i, unit: 'Milligrams', isDuration: false },
      { regex: /(\d+(?:\.\d+)?)\s*(grams?|gms?|g)\b/i, unit: 'Grams', isDuration: false },
      { regex: /(\d+(?:\.\d+)?)\s*(kilograms?|kgs?|kg)/i, unit: 'Kilograms', isDuration: false },
      { regex: /(\d+(?:\.\d+)?)\s*(pounds?|lbs?|lb)/i, unit: 'Pounds', isDuration: false },
      { regex: /(\d+)\s*(calories?|cals?|cal)/i, unit: 'Calories', isDuration: false },
      { regex: /(\d+(?:\.\d+)?)\s*(liters?|litres?|l)\b/i, unit: 'Liters', isDuration: false },
      { regex: /(\d+)\s*(cups?|cup)/i, unit: 'Cups', isDuration: false },
      { regex: /(\d+)\s*(glasses?|glass)/i, unit: 'Glasses', isDuration: false },
      // Count-based exercises (reps)
      { regex: /(\d+)\s*(pull-?ups?|pullups?)/i, unit: 'Count', isDuration: false },
      { regex: /(\d+)\s*(push-?ups?|pushups?)/i, unit: 'Count', isDuration: false },
      { regex: /(\d+)\s*(sit-?ups?|situps?)/i, unit: 'Count', isDuration: false },
      { regex: /(\d+)\s*(squats?)/i, unit: 'Count', isDuration: false },
      { regex: /(\d+)\s*(reps?|repetitions?)/i, unit: 'Count', isDuration: false },
      { regex: /(\d+)\s*(sets?)/i, unit: 'Sets', isDuration: false },
    ];

    // Find the best matching habit from your actual habits
    const findMatchingHabit = (text: string) => {
      const searchTerms = text.toLowerCase();

      for (const habit of habits) {
        const habitName = habit.name.toLowerCase();
        const habitWords = habitName.split(' ');
        const significantWords = habitWords.filter(word => word.length > 2);

        // Activity-based matching
        const matches = [
          { terms: ['read', 'reading'], habitWord: 'reading' },
          { terms: ['walk', 'walked', 'walking'], habitWord: 'walk' },
          { terms: ['meditat', 'meditation'], habitWord: 'meditat' },
          { terms: ['workout', 'exercise', 'gym', 'worked out'], habitWord: 'workout' },
          { terms: ['deep work', 'work session', 'focus'], habitWord: 'work' },
          { terms: ['skill', 'learning', 'study', 'technical'], habitWord: 'skill' },
          { terms: ['caffeine', 'coffee'], habitWord: 'caffeine' },
          { terms: ['water', 'hydrat', 'drank'], habitWord: 'water' },
          { terms: ['sleep', 'slept'], habitWord: 'sleep' },
          { terms: ['code', 'coding', 'programm'], habitWord: 'cod' },
          { terms: ['pull-up', 'pullup', 'pull up'], habitWord: 'pull' },
          { terms: ['push-up', 'pushup', 'push up'], habitWord: 'push' },
          { terms: ['squat'], habitWord: 'squat' },
          { terms: ['run', 'running', 'ran'], habitWord: 'run' },
        ];

        for (const match of matches) {
          if (match.terms.some(term => searchTerms.includes(term)) && habitName.includes(match.habitWord)) {
            return habit;
          }
        }

        // Fallback: significant word matching
        if (significantWords.some(word => searchTerms.includes(word))) {
          return habit;
        }

        // Fallback: full habit name matching
        if (searchTerms.includes(habitName)) {
          return habit;
        }
      }
      return null;
    };

    // Try to extract value and unit
    for (const pattern of timePatterns) {
      const match = text.match(pattern.regex);
      if (match) {
        const value = parseFloat(match[1]);
        const matchingHabit = findMatchingHabit(text);

        if (matchingHabit) {
          const durationInMinutes = pattern.isDuration 
            ? (pattern.unit === 'Hours' ? value * 60 : value) 
            : null;

          return {
            habitName: matchingHabit.name,
            amount: pattern.isDuration ? null : value,
            duration: durationInMinutes,
            unit: pattern.unit,
            activity: text,
            success: true
          };
        }
      }
    }

    return null;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

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

    // Log mode: Phase 5A multi-intent processing
    setIsLoading(true);
    setError(null);
    setClarifications([]);
    
    // Track AI chat message for logging mode
    trackAIChatMessageSent({ messageLength: inputText.length });

    setInput('');

    // OPTIMISTIC UPDATE: Try to parse locally first for instant feedback
    const localParsed = parseHabitInput(inputText);
    if (localParsed?.success && localParsed.habitName && onHabitUpdate) {
      // Find the matching habit to get the ID
      const matchedHabit = habits.find(h => 
        h.name.toLowerCase() === localParsed.habitName?.toLowerCase()
      );
      
      if (matchedHabit) {
        // Send optimistic update IMMEDIATELY (before API call)
        onHabitUpdate({
          success: true,
          optimisticUpdate: true,
          habitId: matchedHabit.id,
          duration: localParsed.duration || undefined,
          amount: localParsed.amount || undefined,
          unit: localParsed.unit || matchedHabit.unit_type || undefined,
          playSound: true,
          refreshNeeded: false, // Don't refresh yet, wait for API
        });
        console.log('⚡ Optimistic update sent for:', matchedHabit.name);
      }
    }

    try {
      if (!user) throw new Error('User not authenticated');
      const sessionToken = await getToken();
      
      // Generate client event ID for idempotency
      const clientEventId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const response = await fetch('/api/chat/habits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': sessionToken ? `Bearer ${sessionToken}` : '',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: inputText }],
          userId: user.id,
          clientEventId,
        }),
      });

      const result: LoggingResult = await response.json();
      
      // Handle successful logs
      if (result.logged && result.logged.length > 0) {
        const successfulLogs = result.logged.filter(r => r.success);
        
        if (successfulLogs.length > 0) {
          // Track each logged habit
          successfulLogs.forEach(log => {
            if (log.habit_id && log.habit_name) {
              trackHabitLogged({
                habitId: log.habit_id,
                habitName: log.habit_name,
                value: log.value,
                unit: log.unit || undefined,
                source: 'ai_chat',
              });
            }
          });
          
          // Trigger background refresh to sync with server (no sound - already played)
          if (onHabitUpdate && result.refreshNeeded) {
            onHabitUpdate({
              success: true,
              refreshNeeded: true,
              playSound: false, // Sound already played in optimistic update
              affectedHabitIds: result.affectedHabitIds,
              message: result.message
            });
          }
        }
      }
      
      // Handle clarifications needed
      if (result.clarifications && result.clarifications.length > 0) {
        setClarifications(result.clarifications);
      }
      
      // Show error if nothing worked
      if (!result.success && result.clarifications?.length === 0) {
        setError(result.message || 'Could not log any habits. Please try again.');
      }

    } catch (err) {
      console.error('Log error:', err);
      setError('Failed to process your request. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Phase 5A: Handle clarification selection
  const handleClarificationSelect = async (clarificationIndex: number, habitId: string, habitName: string) => {
    const clarification = clarifications[clarificationIndex];
    if (!clarification) return;
    
    setIsLoading(true);
    setClarificationDropdownIndex(null);
    
    try {
      const sessionToken = await getToken();
      const apiUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      
      // Direct log to the selected habit
      const response = await fetch(`${apiUrl}/api/logs/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': sessionToken ? `Bearer ${sessionToken}` : '',
        },
        body: JSON.stringify({
          items: [{
            habit_id: habitId,
            date: clarification.date,
            amount: clarification.value,
            unit: clarification.unit,
            source: 'ai_log_v2',
            notes: `Logged via clarification: ${clarification.habit_hint}`
          }],
          client_event_id: `clarify-${Date.now()}`
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          // Remove from clarifications
          setClarifications(prev => prev.filter((_, i) => i !== clarificationIndex));
          
          // Refresh dashboard + play sound (no popup)
          if (onHabitUpdate) {
            onHabitUpdate({
              success: true,
              refreshNeeded: true,
              playSound: true,
              affectedHabitIds: [habitId]
            });
          }
          
          // Track
          trackHabitLogged({
            habitId,
            habitName,
            value: clarification.value ?? undefined,
            unit: clarification.unit || undefined,
            source: 'ai_chat',
          });
        }
      }
    } catch (err) {
      console.error('Clarification log error:', err);
      setError('Failed to log. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Phase 5A: Dismiss clarification
  const dismissClarification = (index: number) => {
    setClarifications(prev => prev.filter((_, i) => i !== index));
  };

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
  }, []);

  const resetNativeVoiceSession = useCallback(async () => {
    clearNativeVoiceTimers();
    nativeVoiceTimestampRef.current = 0;
    await clearNativeDesktopSpeechState().catch(() => undefined);
  }, [clearNativeVoiceTimers]);

  useEffect(() => {
    return () => {
      clearNativeVoiceTimers();
      void stopNativeDesktopSpeechRecognition().catch(() => undefined);
    };
  }, [clearNativeVoiceTimers]);

  const startNativeVoiceRecognition = useCallback(async () => {
    setError(null);
    setIsProcessingVoice(false);
    await resetNativeVoiceSession();
    await startNativeDesktopSpeechRecognition();
    setIsListening(true);

    nativeVoicePollRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const state = await getNativeDesktopSpeechState();
          if (!state.timestamp || state.timestamp <= nativeVoiceTimestampRef.current) {
            return;
          }
          nativeVoiceTimestampRef.current = state.timestamp;

          if (state.event === 'ritual:speech:final') {
            await resetNativeVoiceSession();
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
            setIsListening(false);
            setIsProcessingVoice(false);
            setError(formatNativeSpeechError(state.transcript));
            return;
          }

          if (state.event === 'ritual:speech:status' && state.transcript === 'stopped') {
            await resetNativeVoiceSession();
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
    }, 200);

    nativeVoiceAutoStopRef.current = window.setTimeout(() => {
      stopVoiceRecording();
    }, 3000);
  }, [resetNativeVoiceSession]);

  // Voice recording
  const startVoiceRecognition = async () => {
    if (isListening) {
      stopVoiceRecording();
      return;
    }

    try {
      setError(null);
      if (isTauri()) {
        await startNativeVoiceRecognition();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      setAudioStream(stream);

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
              setInput(result.text);
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
      setIsListening(true);

      const autoStopTimer = setTimeout(() => {
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
      }, 3000);

      (window as any).__mediaRecorder = mediaRecorder;
      (window as any).__autoStopTimer = autoStopTimer;

    } catch (err: any) {
      setError(err.name === 'NotAllowedError' 
        ? 'Microphone access denied. Enable it in System Settings > Privacy & Security > Microphone.'
        : `Microphone error: ${err.message}`);
      setIsListening(false);
      setIsProcessingVoice(false);
    }
  };

  const stopVoiceRecording = () => {
    if (isTauri()) {
      if (nativeVoiceAutoStopRef.current) {
        clearTimeout(nativeVoiceAutoStopRef.current);
        nativeVoiceAutoStopRef.current = null;
      }
      if (nativeVoiceFinalizeTimeoutRef.current) {
        clearTimeout(nativeVoiceFinalizeTimeoutRef.current);
      }

      setIsListening(false);
      setIsProcessingVoice(true);

      void stopNativeDesktopSpeechRecognition()
        .catch((error: any) => {
          setError(`Voice error: ${error?.message || 'Failed to stop native speech recognition.'}`);
          return Promise.resolve();
        })
        .finally(() => {
          nativeVoiceFinalizeTimeoutRef.current = window.setTimeout(() => {
            void resetNativeVoiceSession();
            setIsProcessingVoice(false);
            setError('No speech detected. Please try again.');
          }, 1500);
        });
      return;
    }

    const mediaRecorder = (window as any).__mediaRecorder;
    const autoStopTimer = (window as any).__autoStopTimer;
    if (autoStopTimer) clearTimeout(autoStopTimer);
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
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
      suggestions.length > 0 &&
      !error &&
      !isListening &&
      !isProcessingVoice &&
      !isUploadingScreenshot &&
      !screenshotPreview

    if (canUseSuggestions && e.key === 'ArrowDown') {
      e.preventDefault();
      setKeyboardSuggestionActive(true);
      setSelectedSuggestionIndex((prev) => (prev + 1) % suggestions.length);
      return;
    }

    if (canUseSuggestions && e.key === 'ArrowUp') {
      e.preventDefault();
      setKeyboardSuggestionActive(true);
      setSelectedSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      return;
    }

    if (canUseSuggestions && e.key === 'Tab' && suggestions[selectedSuggestionIndex]) {
      e.preventDefault();
      handleSuggestionClick(suggestions[selectedSuggestionIndex]);
      return;
    }

    if (canUseSuggestions && e.key === 'Enter' && !e.shiftKey && keyboardSuggestionActive && suggestions[selectedSuggestionIndex]) {
      e.preventDefault();
      handleSuggestionClick(suggestions[selectedSuggestionIndex]);
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
    input.trim().length > 0 &&
    suggestions.length > 0 &&
    !error &&
    !isListening &&
    !isProcessingVoice &&
    !isUploadingScreenshot &&
    !screenshotPreview

  return (
    <div className="w-full">
      {/* Phase 5A: Clarification Modal */}
      {clarifications.length > 0 && (
        <div className="mb-3 border border-amber-200 bg-amber-50 shadow-sm">
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">
                Which habit did you mean?
              </span>
            </div>
            <div className="space-y-2">
              {clarifications.map((clarification, idx) => (
                <div key={idx} className="bg-white border border-amber-200 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-700">
                      &quot;{clarification.habit_hint}&quot; 
                      {clarification.value && (
                        <span className="text-gray-500">
                          {' '}— {clarification.value} {clarification.unit}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => dismissClarification(idx)}
                      className="text-gray-400 hover:text-gray-600 text-xs"
                    >
                      Skip
                    </button>
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setClarificationDropdownIndex(clarificationDropdownIndex === idx ? null : idx)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                    >
                      <span className="text-gray-600">Select a habit...</span>
                      <ChevronDown className={cn(
                        "w-4 h-4 text-gray-400 transition-transform",
                        clarificationDropdownIndex === idx && "rotate-180"
                      )} />
                    </button>
                    {clarificationDropdownIndex === idx && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 shadow-lg max-h-48 overflow-y-auto">
                        {clarification.alternatives.map((alt) => (
                          <button
                            key={alt.id}
                            type="button"
                            onClick={() => handleClarificationSelect(idx, alt.id, alt.name)}
                            disabled={isLoading}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 flex items-center justify-between"
                          >
                            <span>{alt.name}</span>
                            <span className="text-xs text-gray-400">
                              {Math.round(alt.confidence * 100)}% match
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Screenshot Modal - Compact macOS-inspired */}
      {(isUploadingScreenshot || screenshotPreview) && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            onClick={handleCancelScreenshot}
          />

          {/* Modal */}
          <div
            className="relative z-10 w-[92vw] max-w-[470px] rounded-none border border-gray-300 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.16)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* HEADER */}
            <div className="flex items-start justify-between gap-3 border-b border-gray-200/80 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {!isUploadingScreenshot && screenshotPreview?.low_confidence && (
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  )}
                  {!isUploadingScreenshot && !screenshotPreview?.low_confidence && (
                    <Check className="h-4 w-4 text-gray-900" />
                  )}

                  <h3 className="text-sm font-medium tracking-tight text-[#111827]">
                    {isUploadingScreenshot ? "Analyzing screenshot" : "Detected"}
                  </h3>

                  {/* Status pill */}
                  {!isUploadingScreenshot && screenshotPreview?.low_confidence && (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                      Review
                    </span>
                  )}
                </div>

                {/* filename */}
                <p className="mt-1 truncate text-xs text-[#6B7280]">
                  {uploadedFileName ?? "Screenshot"}
                </p>
              </div>

              <button
                type="button"
                onClick={handleCancelScreenshot}
                className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:text-gray-700"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* BODY */}
            <div className="px-4 py-4">
              {/* Loading state */}
              {isUploadingScreenshot && (
                <div className="flex min-h-[168px] items-center justify-center">
                  <div className="w-full px-3 py-6 text-center">
                    <p className="text-lg font-medium tracking-tight text-[#111827]">
                      Matching to your habits
                    </p>
                    <div className="mt-3 flex justify-center">
                      <BrailleSpinner name="braille" className="text-[30px]" />
                    </div>
                    <p className="mt-3 text-xs text-[#6B7280]">
                      Extracting values from your image.
                    </p>
                    <p className="mt-1 text-xs text-[#9CA3AF]">
                      Usually done in a few seconds.
                    </p>
                  </div>
                </div>
              )}

              {/* Confirmation state */}
              {screenshotPreview && !isUploadingScreenshot && (
                <div className="space-y-3">
                  {/* HERO VALUE */}
                  <div className="px-2 py-2">
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="number"
                        value={editedValue}
                        onChange={(e) => setEditedValue(e.target.value)}
                        className="w-24 bg-transparent text-center text-[32px] font-medium tracking-tight text-[#111827] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        step="0.1"
                        min="0"
                      />
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => adjustEditedValue(0.1)}
                          className="inline-flex h-5 w-5 items-center justify-center border border-[#D1D5DB] text-[#4B5563] hover:bg-[#F3F4F6]"
                          aria-label="Increase value"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => adjustEditedValue(-0.1)}
                          className="inline-flex h-5 w-5 items-center justify-center border border-[#D1D5DB] text-[#4B5563] hover:bg-[#F3F4F6]"
                          aria-label="Decrease value"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="text-sm text-[#4B5563]">
                        {selectedScreenshotHabit?.unit_type || screenshotPreview.unit}
                      </span>
                    </div>

                    {screenshotPreview.description && (
                      <p className="mt-2 text-center text-xs text-[#6B7280]">
                        {screenshotPreview.description}
                      </p>
                    )}

                    {/* Validation warning */}
                    {!screenshotPreview.validation.is_valid && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium">Check this value</div>
                          <div className="text-amber-800/90">
                            {screenshotPreview.validation.reason}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* HABIT SELECTOR */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6B7280]">Log to</div>

                    <div className="border border-[#C8CDD5] bg-white">
                      <button
                        type="button"
                        onClick={() => setShowHabitPicker((current) => !current)}
                        className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#F9FAFB]"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-[#111827]">
                            {selectedHabitId
                              ? selectedScreenshotHabit?.name
                              : screenshotPreview.habit_name}
                          </div>
                          <div className="text-xs text-[#6B7280]">
                            {selectedHabitId
                              ? "Existing habit"
                              : screenshotPreview.is_new_habit
                                ? "Will create new habit"
                                : "Detected habit"}
                          </div>
                        </div>
                        <div className="ml-3 flex items-center gap-2">
                          <span className="text-xs text-[#9CA3AF]">
                            {selectedScreenshotHabit?.unit_type || screenshotPreview.unit}
                          </span>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 text-[#9CA3AF] transition-transform",
                              showHabitPicker && "rotate-180"
                            )}
                          />
                        </div>
                      </button>

                      {showHabitPicker && (
                        <div className="border-t border-[#E5E7EB]">
                          {screenshotPreview.is_new_habit && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedHabitId(null);
                                setShowHabitPicker(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 border-b border-gray-200 px-2.5 py-1.5 text-left text-sm hover:bg-[#F3F3F3]",
                                !selectedHabitId && "bg-[#F3F3F3]"
                              )}
                            >
                              <span className="text-xs font-semibold text-gray-900">+</span>
                              <span className="truncate">Create &quot;{screenshotPreview.habit_name}&quot;</span>
                            </button>
                          )}

                          <div className="max-h-28 overflow-y-auto">
                            {screenshotHabitOptions.map((habit) => (
                              <button
                                key={habit.id}
                                type="button"
                                onClick={() => {
                                  setSelectedHabitId(habit.id);
                                  setShowHabitPicker(false);
                                }}
                                className={cn(
                                  "flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm hover:bg-[#F3F3F3]",
                                  selectedHabitId === habit.id && "bg-[#F3F3F3]"
                                )}
                              >
                                <span className="truncate">{habit.name}</span>
                                <span className="ml-3 text-xs text-[#9CA3AF]">
                                  {habit.unit_type}
                                </span>
                              </button>
                            ))}
                            {screenshotHabitOptions.length === 0 && (
                              <div className="px-2.5 py-1.5 text-xs text-[#6B7280]">
                                No habits available
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* FOOTER */}
            <div className="flex items-center justify-end gap-2 border-t border-gray-200/80 bg-[#F7F7F8] px-4 py-3">
              <button
                type="button"
                onClick={handleCancelScreenshot}
                className="border border-[#C8CDD5] px-3 py-1.5 text-sm text-[#4B5563] hover:bg-[#EBEDF0] hover:text-[#111827]"
                disabled={isConfirming}
              >
                Cancel
              </button>

              {!isUploadingScreenshot && (
                <button
                  type="button"
                  onClick={handleConfirmScreenshot}
                  disabled={isConfirming || !editedValue}
                  className="inline-flex items-center gap-2 border border-[#111827] bg-[#111827] px-3 py-1.5 text-sm font-medium text-white rounded-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isConfirming ? (
                    <BrailleSpinner className="text-sm text-white" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Log
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="relative border border-gray-200/80 bg-[#F9F9F9] shadow-sm rounded-sm transition-all duration-300 hover:shadow-md hover:border-gray-300 focus-within:shadow-md focus-within:border-gray-300">
        <form onSubmit={handleFormSubmit}>
          <div className="px-5 pt-3 pb-3">
            {/* Input Area */}
            <div className="mb-1 relative">
              {(isListening || isProcessingVoice) ? (
                <div className="w-full h-[42px] flex items-center justify-center">
                  <VoiceWaveform isActive={isListening} audioStream={audioStream} className="h-10 w-full" />
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setSelectedSuggestionIndex(0);
                    setKeyboardSuggestionActive(false);
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  placeholder={mode === 'log' 
                    ? "Log anything..." 
                    : "Ask about your personal data..."
                  }
                  className="w-full resize-none border-0 outline-none text-base text-gray-900 placeholder-gray-500 bg-transparent py-2 font-normal leading-6"
                  rows={1}
                  disabled={isLoading}
                />
              )}
            </div>

            <div
              className={cn(
                "overflow-hidden transition-all duration-150 ease-out",
                showSuggestions ? "max-h-[172px] opacity-100 pt-2 pb-1" : "max-h-0 opacity-0"
              )}
            >
              <div className="max-h-[168px] overflow-y-auto border-t border-gray-200/80 pt-1">
                {suggestions.map((suggestion, idx) => (
                  <button
                    key={`${suggestion.type}-${idx}-${suggestion.text.slice(0, 20)}`}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSuggestionClick(suggestion)}
                    onMouseEnter={() => {
                      setSelectedSuggestionIndex(idx);
                      setKeyboardSuggestionActive(true);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 px-0 py-[9px] text-left text-[13px] transition-colors group",
                      idx === selectedSuggestionIndex
                        ? "text-gray-950"
                        : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    <span className="truncate leading-snug">{suggestion.text}</span>
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
                      "w-8 h-8 flex items-center justify-center transition-all duration-200",
                      isListening || isProcessingVoice
                        ? "text-gray-900"
                        : "text-gray-600 hover:text-gray-800"
                    )}
                    onClick={startVoiceRecognition}
                    aria-label={isListening ? 'Stop recording' : 'Start voice recording'}
                  >
                    {isListening ? (
                      <VoiceWaveformMini isActive={true} />
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
                disabled={!input.trim() || isLoading}
                className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-sm transition-colors duration-200 hover:bg-[#27251E] disabled:cursor-not-allowed"
              >
                {isLoading ? (
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
