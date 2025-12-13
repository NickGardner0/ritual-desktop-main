"use client"

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { ArrowUp, AudioLines, Loader, Paperclip, X, Check, AlertTriangle, ChevronDown } from 'lucide-react';
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

/**
 * Simplified AI Habit Logger
 * 
 * This component handles natural language habit logging.
 * For AI chat/analysis features, see the separate chat page.
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
  
  // Screenshot confirmation flow state
  const [screenshotPreview, setScreenshotPreview] = useState<ScreenshotPreview | null>(null);
  const [editedValue, setEditedValue] = useState<string>('');
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showHabitDropdown, setShowHabitDropdown] = useState(false);
  
  // Phase 5A: Multi-intent logging state
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [clarificationDropdownIndex, setClarificationDropdownIndex] = useState<number | null>(null);

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
          unit: localParsed.unit || matchedHabit.unit || undefined,
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

  // Screen Time screenshot upload handlers
  const handleUploadClick = () => {
    fileInputRef.current?.click();
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

    try {
      const sessionToken = await getToken();
      const formData = new FormData();
      formData.append('file', file);

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

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.detail || 'Failed to process screenshot';
        setError(errorMessage);
        return;
      }

      const data: ScreenshotPreview = await res.json();
      
      // Set preview data for confirmation
      setScreenshotPreview(data);
      setEditedValue(String(data.value));
      setSelectedHabitId(data.habit_id);
      
      // Clear any existing input
      setInput('');

    } catch (err: any) {
      console.error('Screenshot upload error:', err);
      setError(err.message || 'Failed to upload screenshot. Please try again.');
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
      const selectedHabit = screenshotPreview.available_habits.find(h => h.id === selectedHabitId);
      const habitName = selectedHabit?.name || screenshotPreview.habit_name;
      const habitUnit = selectedHabit?.unit_type || screenshotPreview.unit;
      
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
      
      // Clear preview
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
    setScreenshotPreview(null);
    setEditedValue('');
    setSelectedHabitId(null);
    setError(null);
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

      {/* Screenshot Confirmation UI */}
      {screenshotPreview && (
        <div className="mb-3 border border-gray-300 bg-white shadow-sm">
          <div className="px-4 py-3">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">Confirm Screenshot Data</span>
                {screenshotPreview.low_confidence && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                    <AlertTriangle className="w-3 h-3" />
                    Low confidence
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleCancelScreenshot}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Description */}
            {screenshotPreview.description && (
              <p className="text-xs text-gray-500 mb-3">{screenshotPreview.description}</p>
            )}

            {/* Validation Warning */}
            {!screenshotPreview.validation.is_valid && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 mb-3">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span>{screenshotPreview.validation.reason}</span>
              </div>
            )}

            {/* Editable Fields */}
            <div className="flex items-center gap-3 mb-3">
              {/* Value Input */}
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Value</label>
                <input
                  type="number"
                  value={editedValue}
                  onChange={(e) => setEditedValue(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:border-gray-400"
                  step="0.1"
                  min="0"
                />
              </div>

              {/* Unit Display */}
              <div className="w-24">
                <label className="block text-xs text-gray-500 mb-1">Unit</label>
                <div className="px-3 py-2 border border-gray-200 bg-gray-50 text-sm text-gray-700">
                  {screenshotPreview.available_habits.find(h => h.id === selectedHabitId)?.unit_type || screenshotPreview.unit}
                </div>
              </div>
            </div>

            {/* Habit Selector */}
            <div className="mb-3 relative">
              <label className="block text-xs text-gray-500 mb-1">Habit</label>
              <button
                type="button"
                onClick={() => setShowHabitDropdown(!showHabitDropdown)}
                className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 text-sm text-left hover:border-gray-400 transition-colors"
              >
                <span>
                  {selectedHabitId 
                    ? screenshotPreview.available_habits.find(h => h.id === selectedHabitId)?.name 
                    : screenshotPreview.is_new_habit 
                      ? `Create new: ${screenshotPreview.habit_name}`
                      : screenshotPreview.habit_name
                  }
                </span>
                <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform", showHabitDropdown && "rotate-180")} />
              </button>
              
              {/* Dropdown */}
              {showHabitDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 shadow-lg max-h-48 overflow-y-auto z-50">
                  {/* Create new habit option */}
                  {screenshotPreview.is_new_habit && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedHabitId(null);
                        setShowHabitDropdown(false);
                      }}
                      className={cn(
                        "w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2",
                        !selectedHabitId && "bg-gray-50"
                      )}
                    >
                      <span className="text-green-600">+</span>
                      <span>Create new: {screenshotPreview.habit_name}</span>
                    </button>
                  )}
                  {/* Existing habits */}
                  {screenshotPreview.available_habits.map((habit) => (
                    <button
                      key={habit.id}
                      type="button"
                      onClick={() => {
                        setSelectedHabitId(habit.id);
                        setShowHabitDropdown(false);
                      }}
                      className={cn(
                        "w-full px-3 py-2 text-sm text-left hover:bg-gray-100",
                        selectedHabitId === habit.id && "bg-gray-50"
                      )}
                    >
                      {habit.name}
                      <span className="text-gray-400 text-xs ml-2">({habit.unit_type})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelScreenshot}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                disabled={isConfirming}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmScreenshot}
                disabled={isConfirming || !editedValue}
                className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isConfirming ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative border border-gray-300 bg-[#F2F2F2] shadow-sm">
        <form onSubmit={handleFormSubmit}>
          <div className="px-5 py-3">
            {/* Input Area */}
            <div className="mb-2 h-[42px] flex items-center">
              {isUploadingScreenshot ? (
                <div className="w-full flex items-center justify-center text-gray-500 text-sm gap-2">
                  <Loader className="w-4 h-4 animate-spin" />
                  <span>Analyzing screenshot...</span>
                </div>
              ) : (isListening || isProcessingVoice) ? (
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
                      <Loader className="w-4 h-4 animate-spin" />
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
                      <Loader className="w-4 h-4 animate-spin" />
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
                    <div className="absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                      Attach file
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
                  <Loader className="w-4 h-4 animate-spin" />
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
