"use client"

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { ArrowUp, AudioLines, Hourglass } from 'lucide-react';
import { cn } from "@/lib/utils";
import { useHabits } from '@/contexts/HabitsContext';
import { useUser, useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { VoiceWaveform, VoiceWaveformMini } from './voice-waveform';
import { useAnalytics } from '@/lib/analytics';

type InputMode = 'log' | 'chat';

interface AIHabitChatProps {
  onHabitUpdate?: (habitData: any) => void;
}

/**
 * Simplified AI Habit Logger
 * 
 * This component handles natural language habit logging.
 * For AI chat/analysis features, see the separate chat page.
 */
export function AIHabitChat({ onHabitUpdate }: AIHabitChatProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<InputMode>('log');

  const { habits } = useHabits();
  const { user } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const { trackAIChatMessageSent, trackHabitLogged } = useAnalytics();

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

    // Chat mode: navigate to chat page with query
    if (mode === 'chat') {
      const encodedQuery = encodeURIComponent(inputText);
      setInput('');
      // Track AI chat message
      trackAIChatMessageSent({ messageLength: inputText.length });
      router.push(`/chat?q=${encodedQuery}`);
      return;
    }

    // Log mode: existing behavior
    setIsLoading(true);
    setError(null);

    // Instant optimistic update
    const parsedHabit = parseHabitInput(inputText);

    if (parsedHabit && onHabitUpdate) {
      const matchingHabit = habits.find(h =>
        h.name.toLowerCase() === parsedHabit.habitName.toLowerCase()
      );

      if (matchingHabit && matchingHabit.id) {
        onHabitUpdate({
          success: true,
          refreshNeeded: false,
          optimisticUpdate: true,
          playSound: true,
          habitId: matchingHabit.id,
          duration: parsedHabit.duration || 0,
          amount: parsedHabit.amount || null,
          unit: parsedHabit.unit,
          notes: `Logged via AI: ${parsedHabit.activity}`
        });
        
        // Track habit logged via AI
        trackHabitLogged({
          habitId: matchingHabit.id,
          habitName: matchingHabit.name,
          value: parsedHabit.amount ?? parsedHabit.duration ?? undefined,
          unit: parsedHabit.unit || undefined,
          source: 'ai_chat',
        });
      }
    }
    
    // Track AI chat message for logging mode
    trackAIChatMessageSent({ messageLength: inputText.length });

    setInput('');
    setTimeout(() => setIsLoading(false), 500);

    // Process in background
    try {
      if (!user) throw new Error('User not authenticated');
      const sessionToken = await getToken();

      fetch('/api/chat/habits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': sessionToken ? `Bearer ${sessionToken}` : '',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: inputText }],
          userId: user.id,
        }),
      }).then(async (response) => {
        if (!response.ok) return;
        const result = await response.json();

        if (result?.success && onHabitUpdate) {
          onHabitUpdate({
            success: true,
            refreshNeeded: true,
            // Play sound on backend success if local parsing didn't already play it
            playSound: !parsedHabit,
            message: result.message || 'Habit logged successfully!'
          });
        }
      }).catch(console.error);

    } catch (err) {
      if (!parsedHabit) {
        setError('Failed to process your request. Please try again.');
      }
    }
  };

  // Voice recording
  const startVoiceRecognition = async () => {
    if (isListening) {
      stopVoiceRecording();
      return;
    }

    try {
      setError(null);
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
        ? 'Microphone access denied.' 
        : `Microphone error: ${err.message}`);
      setIsListening(false);
      setIsProcessingVoice(false);
    }
  };

  const stopVoiceRecording = () => {
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
    <div className="w-full">
      <div className="relative border border-gray-300 bg-[#F2F2F2] shadow-sm">
        <form onSubmit={handleFormSubmit}>
          <div className="px-5 py-3">
            {/* Input Area */}
            <div className="mb-2 h-[42px] flex items-center">
              {(isListening || isProcessingVoice) ? (
                <div className="w-full flex items-center justify-center">
                  <VoiceWaveform isActive={isListening} audioStream={audioStream} className="h-10 w-full" />
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={mode === 'log' 
                    ? "Log anything..." 
                    : "Ask about your personal data..."
                  }
                  className="w-full resize-none border-0 outline-none text-base text-gray-900 placeholder-gray-500 bg-transparent h-[42px] font-normal leading-6"
                  rows={1}
                  disabled={isLoading}
                />
              )}
            </div>

            {/* Error Display */}
            {error && (
              <div className="mb-2 p-2 bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Bottom Row */}
            <div className="flex justify-between items-center mt-2">
              {/* Left side: Mode Toggle + Voice Button */}
              <div className="flex items-center gap-3 text-gray-600">
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
                  <span className="text-xs text-gray-500 font-medium">
                    {mode === 'chat' ? 'Chat' : 'Log'}
                  </span>
                </div>

                {/* Voice Button (SECOND) */}
                <div className="relative group">
                  <button
                    type="button"
                    className={cn(
                      "w-8 h-8 flex items-center justify-center transition-all duration-200",
                      isListening || isProcessingVoice
                        ? "text-gray-900"
                        : "text-gray-400 hover:text-gray-600"
                    )}
                    onClick={startVoiceRecognition}
                    aria-label={isListening ? 'Stop recording' : 'Start voice recording'}
                  >
                    {isListening ? (
                      <VoiceWaveformMini isActive={true} />
                    ) : isProcessingVoice ? (
                      <Hourglass className="w-4 h-4 animate-spin" />
                    ) : (
                      <AudioLines className="w-[18px] h-[18px] stroke-[1.5]" />
                    )}
                  </button>
                  {/* Tooltip */}
                  {!isListening && !isProcessingVoice && (
                    <div className="absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                      Voice Mode
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="px-3 py-2 min-w-[40px] flex items-center justify-center bg-black hover:bg-gray-800 text-white transition-all duration-200 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <Hourglass className="w-4 h-4 animate-spin" />
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
