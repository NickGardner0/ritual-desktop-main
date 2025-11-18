"use client"

import React, { useRef, useEffect, useState } from 'react';
import { ArrowRight, ArrowUp, Hourglass, Paperclip, Mic, Search, SlidersHorizontal, MessageSquare, List } from 'lucide-react';
import { cn } from "@/lib/utils";
// Removed supabase import - now using Clerk + Python backend
import { useHabits } from '@/contexts/HabitsContext'; // Updated to use Python backend
import { useUser, useAuth } from '@clerk/nextjs';
import { VoiceWaveform, VoiceWaveformMini } from './voice-waveform';

interface AIHabitChatProps {
  onHabitUpdate?: (habitData: any) => void;
}

export function AIHabitChat({ onHabitUpdate }: AIHabitChatProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<string>('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<'log' | 'chat'>('log'); // New mode state
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<Array<{role: 'user' | 'assistant', content: string, timestamp: Date}>>([]);
  // Native speech recognition - no Web Speech API state needed
  const { habits } = useHabits(); // Get current habits for smart matching
  const { user } = useUser(); // Get current Clerk user
  const { getToken } = useAuth(); // Get Clerk auth token method

  // Initialize speech recognition
  // Speech recognition is now handled natively via Swift/Tauri
  // No need for Web Speech API setup

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showModeDropdown) {
        setShowModeDropdown(false);
      }
    };

    if (showModeDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showModeDropdown]);


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
    if (!input.trim() || isLoading) return;

    const inputText = input.trim();
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showModeDropdown) {
        setShowModeDropdown(false);
      }
    };

    if (showModeDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showModeDropdown]);

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
    <div className={cn(
      "w-full mx-auto transition-all duration-300",
      mode === 'log' ? "max-w-3xl" : "max-w-5xl"
    )}>
      {/* Chat Mode Header - Only show in chat mode */}
      {mode === 'chat' && (
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-black rounded-full mb-4">
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
              <div className="w-4 h-4 bg-black rounded-full"></div>
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">
            Hi Nick, how can I help you today?
          </h1>
        </div>
      )}

      {/* Suggestion Pills - Only show in chat mode */}
      {mode === 'chat' && (
        <div className="flex flex-wrap justify-center gap-3 mb-8">
          {currentSuggestions.map((prompt, index) => (
            <button
              key={index}
              onClick={() => setInput(prompt)}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-full transition-colors cursor-pointer border border-gray-200"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Main Input Interface - Compact Style */}
      <div className="relative">
        <form onSubmit={handleFormSubmit}>
          <div className="bg-white border border-gray-300 shadow-sm">
            <div className="px-5 py-4">

              {/* Input Area - Show waveform when recording, textarea otherwise */}
              <div className="mb-2.5 h-[48px] flex items-center">
                {(isListening || isProcessingVoice) ? (
                  <div className="w-full flex items-center justify-center">
                    {/* Waveform Visualization - Inline, Clean */}
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
                        : "Ask Ritual a question..."
                    }
                    className="w-full resize-none border-0 outline-none text-base text-gray-900 placeholder-gray-500 bg-transparent h-[48px] font-normal leading-6 pl-0 pr-3"
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

              {/* Bottom Row - Compact Style */}
              <div className="flex justify-between items-center">
                {/* Left Side - Action Icons */}
                <div className="flex items-center gap-3 text-gray-600">
                  {/* Ritual Logo - Mode Toggle */}
                  <div className="relative group">
                    <button 
                      type="button"
                      className="w-8 h-8 flex items-center justify-center cursor-pointer border border-gray-300 rounded-none bg-white hover:bg-[#F3F3F3] text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300 transition-colors"
                      onClick={() => setShowModeDropdown(!showModeDropdown)}
                      aria-label="Mode"
                      title="Mode"
                    >
                      {mode === 'log' ? (
                        <List className="w-4 h-4" />
                      ) : (
                        <MessageSquare className="w-4 h-4" />
                      )}
                    </button>
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                      Mode
                    </div>
                    
                    {/* Dropdown Menu */}
                    {showModeDropdown && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-none shadow-md z-50 w-[160px]">
                        <div className="py-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setMode('log');
                              setShowModeDropdown(false);
                            }}
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-sm text-gray-900 hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] transition-colors whitespace-nowrap",
                              mode === 'log' && "bg-[#F3F3F3]"
                            )}
                          >
                            Log Mode
                          </button>
                          <div className="h-px bg-gray-200" />
                          <button
                            type="button"
                            onClick={() => {
                              setMode('chat');
                              setShowModeDropdown(false);
                            }}
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-sm text-gray-900 hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] transition-colors whitespace-nowrap",
                              mode === 'chat' && "bg-[#F3F3F3]"
                            )}
                          >
                            Chat Mode
                          </button>
                        </div>
                      </div>
                    )}
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
                      if (input.trim() && !isLoading) {
                        handleFormSubmit(e as any);
                      }
                    }}
                    className="px-3 py-2 min-w-[40px] flex items-center justify-center transition-all duration-200"
                    style={{
                      backgroundColor: '#000000',
                      color: '#ffffff',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#1f2937';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#000000';
                    }}
                  >
                    {isLoading ? (
                      <Hourglass className="w-4 h-4 text-white animate-spin" />
                    ) : (
                      <ArrowUp className="w-4 h-4 text-white" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>

        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}