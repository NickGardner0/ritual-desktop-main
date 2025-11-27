"use client"

import React, { useRef, useEffect, useState } from 'react';
import { ArrowRight, ArrowUp, Hourglass, Paperclip, Mic, Search, SlidersHorizontal } from 'lucide-react';
import { cn } from "@/lib/utils";
// Removed supabase import - now using Clerk + Python backend
import { useHabits } from '@/contexts/HabitsContext'; // Updated to use Python backend
import { useUser, useAuth } from '@clerk/nextjs';
import { VoiceWaveform, VoiceWaveformMini } from './voice-waveform';
import { RitualLogo } from '@/components/ritual-logo';

import { useAI } from '@/contexts/AIContext';
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface AIHabitChatProps {
  onHabitUpdate?: (habitData: any) => void;
  onModeChange?: (mode: 'log' | 'chat') => void;
}

export function AIHabitChat({ onHabitUpdate, onModeChange }: AIHabitChatProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<string>('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<'log' | 'chat'>('log'); // New mode state
  const [conversationHistory, setConversationHistory] = useState<Array<{ role: 'user' | 'assistant', content: string, timestamp: Date }>>([]);
  // Native speech recognition - no Web Speech API state needed
  const { habits } = useHabits(); // Get current habits for smart matching
  const { user } = useUser(); // Get current Clerk user
  const { getToken } = useAuth(); // Get Clerk auth token method
  const { setIsFullScreenChat } = useAI(); // Track full-screen chat state

  // Manual streaming chat implementation (simpler and more reliable than useChat)
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([]);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [hasScrolledToTop, setHasScrolledToTop] = useState(false);

  const sendChatMessage = async (userMessage: string) => {
    console.log('💬 Sending chat message:', userMessage);
    setIsChatLoading(true);
    setError(null);
    setStreamingMessage('');

    // Add user message immediately
    const newMessages = [...messages, { role: 'user' as const, content: userMessage }];
    setMessages(newMessages);
    setHasScrolledToTop(false); // Reset flag for new question

    try {
      const token = await getToken({ skipCache: false });
      console.log('🔑 Got auth token for chat:', !!token);

      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: newMessages,
          userId: user?.id,
        }),
      });

      console.log('📡 Chat response status:', response.status);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Read the stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      console.log('📖 Starting to read stream...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('✅ Stream reading complete');
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        console.log('📦 Received chunk:', chunk.substring(0, 100)); // Log first 100 chars

        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue; // Skip empty lines

          if (line.startsWith('0:')) {
            // Data chunk in format: 0:"text"
            const jsonStr = line.substring(2).trim();
            if (jsonStr) {
              try {
                const data = JSON.parse(jsonStr);
                if (typeof data === 'string') {
                  fullResponse += data;
                  setStreamingMessage(fullResponse);
                }
              } catch (e) {
                console.warn('⚠️ Failed to parse chunk:', jsonStr, e);
              }
            }
          }
        }
      }

      // Add complete assistant message
      setMessages([...newMessages, { role: 'assistant', content: fullResponse }]);
      setStreamingMessage('');
      console.log('✅ Chat complete');

    } catch (err) {
      console.error('❌ Chat error:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsChatLoading(false);
    }
  };

  // Auto-scroll to bottom when new messages arrive in chat mode
  useEffect(() => {
    // Only auto-scroll down when streaming message is actually present AND we've already scrolled to top
    if (mode === 'chat' && messagesEndRef.current && streamingMessage && hasScrolledToTop) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streamingMessage, mode, hasScrolledToTop]);

  // Track full-screen chat state for hiding sidebar/header
  useEffect(() => {
    const isInFullScreenView = mode === 'chat' && (messages.length > 0 || !!streamingMessage || isChatLoading);
    setIsFullScreenChat(isInFullScreenView);
  }, [mode, messages.length, streamingMessage, isChatLoading, setIsFullScreenChat]);

  // Ensure container starts at top when entering full-screen chat
  useEffect(() => {
    const isFullScreen = mode === 'chat' && messages.length > 0;
    if (isFullScreen && messagesContainerRef.current && !hasScrolledToTop) {
      // Aggressively force scroll to top - multiple attempts
      const container = messagesContainerRef.current;

      // Immediate scroll
      container.scrollTop = 0;

      // Multiple frame attempts to override any browser behavior
      requestAnimationFrame(() => {
        if (container) container.scrollTop = 0;
        requestAnimationFrame(() => {
          if (container) container.scrollTop = 0;
          setTimeout(() => {
            if (container) {
              container.scrollTop = 0;
              setHasScrolledToTop(true);
            }
          }, 10);
        });
      });
    }
  }, [mode, messages.length, hasScrolledToTop]);

  // Initialize speech recognition
  // Speech recognition is now handled natively via Swift/Tauri
  // No need for Web Speech API setup

  // Handle voice input submission
  const handleVoiceSubmit = async (transcript: string) => {
    if (!transcript.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    // INSTANT optimistic update - parse input immediately
    const parsedHabit = parseHabitInput(transcript);
    console.log('🔍 Voice parseHabitInput result:', parsedHabit);

    if (parsedHabit && onHabitUpdate) {
      console.log('🚀 Applying optimistic update for voice input:', parsedHabit);
      onHabitUpdate({
        success: true,
        refreshNeeded: false,
        optimisticUpdate: parsedHabit,
        playSound: true
      });
    } else {
      console.log('❌ No parsedHabit found for voice input:', transcript);
    }

    // Set loading to false immediately after optimistic update for better UX
    setTimeout(() => {
      setIsLoading(false);
    }, 500);

    try {
      // Use Clerk user instead of Supabase session
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Get Clerk session token
      const sessionToken = await getToken();

      // Process AI in background (don't wait for it)
      fetch('/api/chat/habits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': sessionToken ? `Bearer ${sessionToken}` : '',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: transcript }],
          userId: user.id,
        }),
      }).then(async (response) => {
        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ API response error:', { status: response.status, text: errorText });
          return;
        }

        const result = await response.json();
        console.log('✅ Voice API response success:', result);

        // If the API successfully logged something, trigger a refresh
        if (result && (result.success || result.habitData)) {
          console.log('🔄 API logged habit successfully, triggering refresh...');
          if (onHabitUpdate) {
            onHabitUpdate({
              success: true,
              refreshNeeded: true, // Force refresh from database
              message: result.message || 'Habit logged successfully!'
            });
          }
        }
      }).catch((err) => {
        console.error('❌ Error submitting voice to AI:', err);
        if (!parsedHabit) {
          setError('Failed to process your voice request. Please try again.');
        }
      });

    } catch (err) {
      console.error('❌ Error with voice session:', err);
      if (!parsedHabit) {
        setError('Failed to process your voice request. Please try again.');
      }
    }
  };

  // Enhanced voice recognition with better UI
  const startVoiceRecognition = async () => {
    if (isListening) {
      // Stop current recording (instant stop on click)
      console.log('🛑 User clicked to stop recording');
      stopVoiceRecording();
      return;
    }

    try {
      setError(null);
      setVoiceTranscript('');

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        }
      });

      setAudioStream(stream);

      // Check supported audio formats
      let mimeType = '';
      const supportedTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/wav',
        'audio/ogg;codecs=opus',
        'audio/ogg'
      ];

      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          console.log('🎤 Using audio format:', type);
          break;
        }
      }

      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      const audioChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsListening(false);
        setIsProcessingVoice(true);

        // Clean up audio stream
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
          setAudioStream(null);
        }

        if (audioChunks.length === 0) {
          setError('No audio recorded. Please try again.');
          setIsProcessingVoice(false);
          return;
        }

        const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/wav' });

        try {
          // Send to Whisper API
          const formData = new FormData();
          const getFileExtension = (mimeType: string) => {
            if (mimeType.includes('webm')) return 'webm';
            if (mimeType.includes('mp4')) return 'mp4';
            if (mimeType.includes('ogg')) return 'ogg';
            if (mimeType.includes('wav')) return 'wav';
            return 'webm';
          };

          const fileExtension = getFileExtension(mimeType || 'audio/wav');
          formData.append('file', audioBlob, `audio.${fileExtension}`);

          const response = await fetch('/api/whisper', {
            method: 'POST',
            body: formData,
          });

          if (response.ok) {
            const result = await response.json();
            const transcript = result.text;
            console.log('🎤 Whisper transcription:', transcript);

            if (!transcript.trim()) {
              setError('No speech detected. Please try again.');
              setIsProcessingVoice(false);
              return;
            }

            setVoiceTranscript(transcript);
            setIsProcessingVoice(false); // Stop showing waveform
            setInput(transcript); // Show transcribed text in input box

            // Focus the textarea so user can immediately press Enter to submit
            setTimeout(() => {
              textareaRef.current?.focus();
            }, 100);

            // ✅ NO AUTO-SUBMIT - Let user review and manually submit
            console.log('✅ Transcription complete. Waiting for manual submission...');
          } else {
            const errorText = await response.text();
            console.error('❌ Whisper API error:', response.status, errorText);
            setError('Failed to transcribe audio. Please try again.');
            setIsProcessingVoice(false);
          }
        } catch (err) {
          console.error('❌ Error transcribing audio:', err);
          setError('Failed to process voice input. Please try again.');
          setIsProcessingVoice(false);
        }
      };

      // Start recording
      mediaRecorder.start(100);
      setIsListening(true);

      // Auto-stop after 3 seconds (faster like SuperWhisper)
      const autoStopTimer = setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          console.log('🎤 Auto-stopping recording after 3 seconds');
          mediaRecorder.stop();
        }
      }, 3000);

      // Store for manual control
      (window as any).__mediaRecorder = mediaRecorder;
      (window as any).__autoStopTimer = autoStopTimer;

    } catch (err: any) {
      console.error('❌ Error accessing microphone:', err);
      if (err.name === 'NotAllowedError') {
        setError('Microphone access denied. Please allow microphone access and try again.');
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found. Please connect a microphone and try again.');
      } else if (err.name === 'NotSupportedError') {
        setError('Voice recording format not supported. Please try again.');
      } else if (err.name === 'NotReadableError') {
        setError('Microphone is being used by another application.');
      } else {
        setError(`Microphone error: ${err.message || 'Unknown error'}`);
      }
      setIsListening(false);
      setIsProcessingVoice(false);
    }
  };

  // Stop voice recording
  const stopVoiceRecording = () => {
    const mediaRecorder = (window as any).__mediaRecorder;
    const autoStopTimer = (window as any).__autoStopTimer;

    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
    }

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }

    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      setAudioStream(null);
    }

    setIsListening(false);
  };

  // Native speech recognition handles permissions automatically

  // Smart habit parsing that uses your actual habits
  const parseHabitInput = (text: string) => {
    const lowerText = text.toLowerCase();

    // Parse input for habit matching

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
    ];

    // Find the best matching habit from your actual habits
    const findMatchingHabit = (text: string) => {
      const searchTerms = text.toLowerCase();
      console.log('🔍 Searching for habit match in text:', searchTerms);
      console.log('🔍 Available habits:', habits.map(h => h.name));

      // Try to find exact or partial matches
      for (const habit of habits) {
        const habitName = habit.name.toLowerCase();
        const habitWords = habitName.split(' ');

        // Check if any significant words from the habit name appear in the text
        const significantWords = habitWords.filter(word => word.length > 2); // Skip short words like "a", "the"

        // Enhanced matching for common activities
        // For "reading" input, match with "Daily Reading"
        if ((searchTerms.includes('read') || searchTerms.includes('reading')) && habitName.includes('reading')) {
          console.log('✅ Matched reading habit:', habit.name);
          return habit;
        }

        // For "walk/walked/walking" input, match with "Daily Walk"
        if ((searchTerms.includes('walk') || searchTerms.includes('walked') || searchTerms.includes('walking')) && habitName.includes('walk')) {
          console.log('✅ Matched walking habit:', habit.name);
          return habit;
        }

        // For "meditate/meditated/meditation" input, match with "Meditation"
        if ((searchTerms.includes('meditat') || searchTerms.includes('meditation')) && habitName.includes('meditat')) {
          console.log('✅ Matched meditation habit:', habit.name);
          return habit;
        }

        // For "workout/exercise/gym" input, match with "Morning Workout"
        if ((searchTerms.includes('workout') || searchTerms.includes('exercise') || searchTerms.includes('gym') || searchTerms.includes('worked out')) && habitName.includes('workout')) {
          console.log('✅ Matched workout habit:', habit.name);
          return habit;
        }

        // For "work/working/focus" input, match with "Deep Work Sessions"
        if ((searchTerms.includes('deep work') || searchTerms.includes('work session') || searchTerms.includes('focus')) && habitName.includes('work')) {
          console.log('✅ Matched work habit:', habit.name);
          return habit;
        }

        // For "skill/learning/study" input, match with "Technical Skills"
        if ((searchTerms.includes('skill') || searchTerms.includes('learning') || searchTerms.includes('study') || searchTerms.includes('technical')) && habitName.includes('skill')) {
          console.log('✅ Matched skills habit:', habit.name);
          return habit;
        }

        // For "caffeine/coffee/consumed" input, match with "Caffeine Consumption"
        if ((searchTerms.includes('caffeine') || searchTerms.includes('coffee') || (searchTerms.includes('consumed') && searchTerms.includes('mg'))) && habitName.includes('caffeine')) {
          console.log('✅ Matched caffeine habit:', habit.name);
          return habit;
        }

        // For "water/hydration/drank" input, match with water-related habits
        if ((searchTerms.includes('water') || searchTerms.includes('hydrat') || searchTerms.includes('drank')) && (habitName.includes('water') || habitName.includes('hydrat'))) {
          console.log('✅ Matched hydration habit:', habit.name);
          return habit;
        }

        // For "sleep/slept" input, match with "Sleep Duration"
        if ((searchTerms.includes('sleep') || searchTerms.includes('slept')) && habitName.includes('sleep')) {
          console.log('✅ Matched sleep habit:', habit.name);
          return habit;
        }

        // For "code/coding/programm" input, match with "Coding"
        if ((searchTerms.includes('code') || searchTerms.includes('coding') || searchTerms.includes('programm')) && habitName.includes('cod')) {
          console.log('✅ Matched coding habit:', habit.name);
          return habit;
        }

        if (significantWords.some(word => searchTerms.includes(word))) {
          console.log('✅ Matched habit by significant word:', habit.name);
          return habit;
        }

        // Also check if the text contains the full habit name
        if (searchTerms.includes(habitName)) {
          console.log('✅ Matched habit by full name:', habit.name);
          return habit;
        }
      }
      console.log('❌ No habit match found');
      return null;
    };

    // Try to extract value and unit
    for (const pattern of timePatterns) {
      const match = text.match(pattern.regex);
      if (match) {
        const value = parseFloat(match[1]);
        const matchingHabit = findMatchingHabit(text);

        if (matchingHabit) {
          // For duration, send in minutes - the optimistic update will convert to seconds
          const durationInMinutes = pattern.isDuration ?
            (pattern.unit === 'Hours' ? value * 60 : value) : null;

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
    if (!input.trim()) return;

    const inputText = input.trim();

    // CHAT MODE: Stream response inline (Perplexity style)
    if (mode === 'chat') {
      if (isChatLoading) return;

      setInput(''); // Clear input immediately
      await sendChatMessage(inputText);
      return;
    }

    // LOG MODE: Use existing habit logging logic
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    // INSTANT optimistic update - parse input immediately
    const parsedHabit = parseHabitInput(inputText);
    console.log('🔍 Parsing result for:', inputText, '→', parsedHabit);
    console.log('🔍 Current habits in context:', habits.map(h => ({ id: h.id, name: h.name })));

    if (parsedHabit && onHabitUpdate) {
      // Find the matching habit ID
      const matchingHabit = habits.find(h =>
        h.name.toLowerCase() === parsedHabit.habitName.toLowerCase()
      );

      if (matchingHabit) {
        console.log('🚀 Instant optimistic update:', parsedHabit);
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
      }
    } else {
      console.warn('⚠️ No parsed habit found for input:', inputText);
    }

    setInput(''); // Clear input immediately

    // Set loading to false immediately after optimistic update for better UX
    setTimeout(() => {
      setIsLoading(false);
    }, 500); // Short delay to show feedback

    try {
      // Use Clerk user instead of Supabase session
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Get Clerk session token
      const sessionToken = await getToken();

      console.log('🔍 Making API call to /api/chat/habits with:', {
        userId: user.id,
        inputText,
        hasAccessToken: !!sessionToken
      });

      // Add to conversation history
      const newUserMessage = { role: 'user' as const, content: inputText, timestamp: new Date() };
      setConversationHistory(prev => [...prev, newUserMessage]);

      // Process AI in background (don't wait for it)
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
        console.log('📡 API response status:', response.status);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ API response error:', { status: response.status, text: errorText });
          setError(`Failed to log habit: ${errorText}`);
          return;
        }

        const result = await response.json();
        console.log('✅ API response success:', result);

        // Add assistant response to conversation history
        if (result.message) {
          const assistantMessage = { role: 'assistant' as const, content: result.message, timestamp: new Date() };
          setConversationHistory(prev => [...prev, assistantMessage]);
          setLastResponse(result.message);
        }

        // If the API successfully logged something, trigger a refresh (matching original behavior)
        if (result && (result.success || result.habitData)) {
          console.log('🔄 API logged habit successfully, triggering refresh...');
          if (onHabitUpdate) {
            onHabitUpdate({
              success: true,
              refreshNeeded: true, // Force refresh from database
              message: result.message || 'Habit logged successfully!'
            });
          }
        } else {
          console.warn('⚠️ API did not return success - result:', result);
        }
      }).catch((err) => {
        console.error('❌ Error submitting to AI:', err);
        console.error('❌ Error stack:', err.stack);
        setError(`Failed to process your request: ${err.message}`);
      });

    } catch (err) {
      console.error('❌ Error with session:', err);
      if (!parsedHabit) {
        setError('Failed to process your request. Please try again.');
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (lastResponse) {
      setLastResponse(''); // Clear previous response when user starts typing
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // Prevent new line
      handleFormSubmit(e as any); // Submit the form
    }
    // Allow Shift+Enter for new lines if needed
  };

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);



  // Generate smart suggestions based on user's actual habits
  const generateSmartSuggestions = () => {
    const suggestions: string[] = [];

    // Add habit-specific suggestions
    habits.forEach(habit => {
      const habitName = habit.name.toLowerCase();
      if (habitName.includes('workout') || habitName.includes('exercise')) {
        suggestions.push(`I just worked out for 1 hour`);
      } else if (habitName.includes('read')) {
        suggestions.push(`Read 25 pages of my book`);
      } else if (habitName.includes('meditat')) {
        suggestions.push(`Meditated for 15 minutes`);
      } else if (habitName.includes('walk') || habitName.includes('run')) {
        suggestions.push(`Ran 3 miles today`);
      } else if (habitName.includes('water')) {
        suggestions.push(`Drank 8 glasses of water`);
      }
    });

    // Add generic suggestions if no specific ones
    if (suggestions.length === 0) {
      return [
        "I went for a 30-minute run",
        "Read 25 pages today",
        "Meditated for 10 minutes"
      ];
    }

    return suggestions.slice(0, 3); // Limit to 3 suggestions
  };

  const logSuggestionPrompts = generateSmartSuggestions();

  const chatSuggestionPrompts = [
    "What's my current streak?",
    "How am I doing this week?",
    "What is my spending on habits?"
  ];

  const currentSuggestions = mode === 'log' ? logSuggestionPrompts : chatSuggestionPrompts;

  return (
    <>
      {/* CHAT MODE - Full Screen Overlay (Perplexity-style) */}
      {mode === 'chat' && (messages.length > 0 || streamingMessage || isChatLoading) && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-white">
          {/* Warmer Beige Overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(245, 240, 230, 0.5)' }}></div>

          {/* Back Button - Top Left (Perplexity-style) */}
          <button
            onClick={() => {
              setMessages([]);
              setStreamingMessage('');
              setIsChatLoading(false);
              setHasScrolledToTop(false);
            }}
            className="absolute top-4 left-4 z-50 w-8 h-8 flex items-center justify-center hover:bg-gray-200/50 rounded-lg transition-all duration-200"
            aria-label="Back to dashboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-700">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Messages Container */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto relative z-0" style={{ scrollBehavior: hasScrolledToTop ? 'smooth' : 'auto' }}>
            <div className="max-w-3xl mx-auto px-6 py-16">
              {messages.map((message, index) => (
                <div key={index}>
                  {message.role === 'user' ? (
                    // User question - Large prominent text at top (Perplexity-style)
                    <h1 className="text-3xl font-normal text-gray-900 mb-8 leading-tight">
                      {message.content}
                    </h1>
                  ) : (
                    // AI response - Clean paragraph style
                    <div className="text-base leading-7 text-gray-800 whitespace-pre-wrap mb-6">
                      {message.content}
                    </div>
                  )}
                </div>
              ))}
              {streamingMessage && (
                <div className="text-base leading-7 text-gray-800 whitespace-pre-wrap">
                  {streamingMessage}
                  <span className="inline-block w-0.5 h-5 ml-1 bg-gray-900 animate-pulse" />
                </div>
              )}
              {isChatLoading && !streamingMessage && (
                <div className="flex items-center gap-2 text-gray-400 mt-4">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              )}
              {hasScrolledToTop && <div ref={messagesEndRef} />}
            </div>
          </div>

          {/* Follow-up Input - Transparent background matching page */}
          <div className="relative z-0">
            <div className="max-w-3xl mx-auto px-6 py-4">
              <div className="relative border border-gray-300 shadow-sm rounded-lg" style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}>
                <form onSubmit={handleFormSubmit}>
                  <div className="px-5 py-4">
                    <div className="mb-2.5 h-[48px] flex items-center">
                      <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask a follow-up question..."
                        className="w-full resize-none border-0 outline-none text-base text-gray-900 placeholder-gray-500 bg-transparent h-[48px] font-normal leading-6 pl-0 pr-3"
                        rows={1}
                        disabled={isChatLoading}
                      />
                    </div>

                    <div className="flex justify-end items-center">
                      <button
                        type="submit"
                        disabled={!input.trim() || isChatLoading}
                        className="w-10 h-10 flex items-center justify-center bg-black text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                      >
                        <ArrowUp className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Regular Chat Input - Show on dashboard when NOT in full-screen chat */}
      <div className="w-full transition-all duration-300 flex flex-col h-full">

        {/* Input Area - Show on dashboard (hide only in full-screen chat view) */}
        {!(mode === 'chat' && (messages.length > 0 || streamingMessage || isChatLoading)) && (
          <div className="relative border border-gray-300 bg-white shadow-sm rounded-lg">
            <form onSubmit={handleFormSubmit}>
              <div className="px-5 py-4">
                {/* Regular input for both log and chat mode on dashboard */}
                <div className="mb-2.5 h-[48px] flex items-center">
                  {(isListening || isProcessingVoice) ? (
                    <div className="w-full flex items-center justify-center">
                      <VoiceWaveform
                        isActive={isListening}
                        audioStream={audioStream}
                        className="h-12 w-full"
                      />
                    </div>
                  ) : (
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      placeholder={
                        mode === 'log'
                          ? "Log anything..."
                          : "Ask me anything about your habits..."
                      }
                      className="w-full resize-none border-0 outline-none text-base text-gray-900 placeholder-gray-500 bg-transparent h-[48px] font-normal leading-6 pl-0 pr-3"
                      rows={1}
                      disabled={mode === 'log' ? isLoading : isChatLoading}
                    />
                  )}
                </div>


                {/* Error Display */}
                {error && (
                  <div className="mb-2 p-2 bg-red-50 border border-red-200 text-red-700 text-sm">
                    {error}
                  </div>
                )}

                {/* Bottom Row - Show for both log and chat mode on dashboard */}
                <div className="flex justify-between items-center">
                  {/* Left Side - Action Icons */}
                  <div className="flex items-center gap-3 text-gray-600">
                    {/* Mode Toggle Switch */}
                    <div className="flex items-center mr-2">
                      <Switch
                        id="mode-toggle"
                        checked={mode === 'chat'}
                        onCheckedChange={(checked) => {
                          const newMode = checked ? 'chat' : 'log';
                          setMode(newMode);
                          onModeChange?.(newMode);
                        }}
                      />
                    </div>

                    {/* Enhanced Voice Mode Button */}
                    <div className="relative group">
                      <button
                        type="button"
                        className={cn(
                          "w-8 h-8 flex items-center justify-center rounded-full transition-all duration-300 relative overflow-hidden",
                          isListening || isProcessingVoice
                            ? "bg-gray-100 text-gray-900"
                            : "hover:bg-gray-100 text-gray-600 hover:text-gray-900"
                        )}
                        onClick={startVoiceRecognition}
                        aria-label={isListening ? 'Stop recording' : 'Start voice recording'}
                      >
                        {/* Icon or waveform */}
                        {isListening ? (
                          <VoiceWaveformMini isActive={true} className="relative z-10" />
                        ) : isProcessingVoice ? (
                          <Hourglass className="w-4 h-4 animate-spin relative z-10" />
                        ) : (
                          <Mic className="w-4 h-4 relative z-10 transition-transform hover:scale-110" />
                        )}
                      </button>

                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                        {isListening ? 'Recording...' : isProcessingVoice ? 'Processing...' : 'Voice Mode'}
                      </div>
                    </div>

                    {/* Attach Files */}
                    <div className="relative group">
                      <div className="w-5 h-5 flex items-center justify-center hover:text-gray-900 cursor-pointer transition-colors">
                        <Paperclip className="w-4 h-4" />
                      </div>
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                        Attach Files
                      </div>
                    </div>

                    {/* Search */}
                    <div className="relative group">
                      <div className="w-5 h-5 flex items-center justify-center hover:text-gray-900 cursor-pointer transition-colors">
                        <Search className="w-4 h-4" />
                      </div>
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                        Search
                      </div>
                    </div>
                  </div>

                  {/* Right Side - Submit Button */}
                  <div className="flex items-center gap-2">

                    {/* Submit Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        const currentLoading = mode === 'log' ? isLoading : isChatLoading;
                        if (input.trim() && !currentLoading) {
                          handleFormSubmit(e as any);
                        }
                      }}
                      disabled={!input.trim() || (mode === 'log' ? isLoading : isChatLoading)}
                      className="px-3 py-2 min-w-[40px] flex items-center justify-center bg-black hover:bg-gray-800 text-white transition-all duration-200 disabled:cursor-not-allowed"
                    >
                      {(mode === 'log' ? isLoading : isChatLoading) ? (
                        <Hourglass className="w-4 h-4 text-white animate-spin" />
                      ) : (
                        <ArrowUp className="w-4 h-4 text-white" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
    </>
  );
}