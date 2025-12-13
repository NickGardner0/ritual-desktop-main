'use client'

import React, { useEffect, useRef, useState, useCallback, memo, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { ArrowUp, Loader, ArrowLeft, AudioLines, Plus, PanelLeftClose, PanelLeft, MessageSquare } from 'lucide-react';
import { VoiceWaveformMini } from '@/components/voice-waveform';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'framer-motion';
import { Streamdown } from 'streamdown';
import { HabitCanvas, type HabitCanvasData } from '@/components/chat/habit-canvas';
import { useAI } from '@/contexts/AIContext';
import { RitualLogo } from '@/components/ritual-logo';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// TextShimmer component
const TextShimmer = memo(function TextShimmer({ 
  children, 
  className,
  duration = 2,
  spread = 2,
}: { 
  children: string;
  className?: string;
  duration?: number;
  spread?: number;
}) {
  const dynamicSpread = useMemo(() => children.length * spread, [children, spread]);

  return (
    <motion.p
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text",
        "text-transparent [--base-color:#a1a1aa] [--base-gradient-color:#000]",
        "[background-repeat:no-repeat,padding-box] [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      animate={{ backgroundPosition: "0% center" }}
      transition={{
        repeat: Infinity,
        duration,
        ease: "linear",
      }}
      style={{
        '--spread': `${dynamicSpread}px`,
        backgroundImage: 'var(--bg), linear-gradient(var(--base-color), var(--base-color))',
      } as React.CSSProperties}
    >
      {children}
    </motion.p>
  );
});

// Streamdown Response component
const Response = memo(function Response({ 
  children, 
  className 
}: { 
  children: string; 
  className?: string;
}) {
  return (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 space-y-4",
        "[&>ul]:!my-0 [&>*+ul]:!mt-2 [&>ol]:!my-0 [&>*+ol]:!mt-2",
        className,
      )}
      components={{
        ul: ({ children, ...props }) => (
          <ul className="list-disc list-inside m-0 p-0 leading-relaxed space-y-1 ml-1" {...props}>
            {children}
          </ul>
        ),
        ol: ({ children, ...props }) => (
          <ol className="list-decimal list-inside m-0 p-0 leading-relaxed space-y-1 ml-1" {...props}>
            {children}
          </ol>
        ),
        li: ({ children, ...props }) => (
          <li className="py-0.5 my-0 leading-relaxed text-gray-600" {...props}>
            {children}
          </li>
        ),
        h2: ({ children, ...props }) => (
          <h2 className="font-medium text-base text-gray-900 mt-6 mb-2" {...props}>
            {children}
          </h2>
        ),
        h3: ({ children, ...props }) => (
          <h3 className="font-medium text-sm text-gray-900 mt-4 mb-2" {...props}>
            {children}
          </h3>
        ),
        p: ({ children, ...props }) => (
          <p className="leading-relaxed text-gray-600" {...props}>
            {children}
          </p>
        ),
        strong: ({ children, ...props }) => (
          <strong className="font-medium text-gray-900" {...props}>
            {children}
          </strong>
        ),
        // Hide tables in the main response - they'll show in canvas
        table: () => null,
        thead: () => null,
        tbody: () => null,
        tr: () => null,
        th: () => null,
        td: () => null,
      }}
    >
      {children}
    </Streamdown>
  );
});

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  canvasData?: HabitCanvasData;
}

// Smarter canvas data extraction - looks for patterns in the response
function extractCanvasData(content: string, question: string): HabitCanvasData | undefined {
  // Strip markdown formatting for easier parsing
  const cleanContent = content.replace(/\*\*/g, '').replace(/\*/g, '');
  
  // Look for date-value patterns (YYYY-MM-DD followed by a number)
  const dateValuePattern = /(\d{4}-\d{2}-\d{2})[:\s]+(\d+\.?\d*)/g;
  const matches = [...cleanContent.matchAll(dateValuePattern)];
  
  // Match full month names like "November 26: 8.3 hours" or "November 26: 8.3"
  const fullMonthPattern = /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s*\d{4})?)[:\s]+(\d+\.?\d*)/gi;
  const fullMonthMatches = [...cleanContent.matchAll(fullMonthPattern)];
  
  // Also try to match abbreviated "Month Day: value" patterns  
  const monthDayPattern = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?)[:\s]+(\d+\.?\d*)/gi;
  const monthMatches = [...cleanContent.matchAll(monthDayPattern)];
  
  // Combine matches - prefer ISO dates, then full months, then abbreviated
  const allMatches = matches.length > 0 ? matches : 
                     fullMonthMatches.length > 0 ? fullMonthMatches : 
                     monthMatches;
  
  if (allMatches.length >= 3) {
    const dailyData = allMatches.map(match => ({
      date: match[1],
      hours: parseFloat(match[2]),
    }));
    
    // Extract habit name from question or content
    const habitPatterns = /(?:sleep|workout|meditation|reading|coding|walk|exercise|running|gym|deep work|technical skills)/i;
    const habitMatch = question.match(habitPatterns) || content.match(habitPatterns);
    const habitName = habitMatch ? habitMatch[0].charAt(0).toUpperCase() + habitMatch[0].slice(1).toLowerCase() : 'Activity';
    
    const totalHours = Math.round(dailyData.reduce((sum, d) => sum + d.hours, 0) * 10) / 10;
    const avgPerDay = Math.round((totalHours / dailyData.length) * 10) / 10;
    
    return {
      type: 'trends',
      title: `${habitName} Trends`,
      habitName,
      dailyData,
      dateRange: {
        start: dailyData[0].date,
        end: dailyData[dailyData.length - 1].date,
      },
      stats: {
        daysTracked: dailyData.length,
        totalHours,
        avgPerDay,
      },
    };
  }
  
  // Look for stats-based responses (totals, averages) - more flexible patterns
  // Note: cleanContent is already defined above with markdown stripped
  
  const totalPatterns = [
    /total\s*(?:sleep|time|duration)?[:\s]+(\d+\.?\d*)\s*(hours?|h|minutes?|min)/i,
    /total of\s+(\d+\.?\d*)\s*(hours?|h|minutes?|min)/i,
    /(\d+\.?\d*)\s*hours?\s*(?:total|in total)/i,
    /tracked[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
  ];
  
  const avgPatterns = [
    /average\s*(?:sleep|time|duration)?(?:\s*per\s*(?:day|night))?[:\s]+(\d+\.?\d*)\s*(hours?|h|minutes?|min)/i,
    /averaging[:\s]+(?:about\s+)?(\d+\.?\d*)\s*(hours?|h)/i,
    /avg[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
    /(\d+\.?\d*)\s*hours?\s*per\s*(?:night|day|session)/i,
    /(\d+\.?\d*)\s*(?:hours?|h)\s*(?:on\s+)?average/i,
  ];
  
  const daysPatterns = [
    /(\d+)\s*days?\s*(?:tracked|during|with data)/i,
    /days\s*(?:tracked|with data)[:\s]+(\d+)/i,
    /tracked\s*(?:your\s+\w+\s+)?(?:for\s+)?(\d+)\s*days?/i,
    /over\s*(?:the\s*past\s+)?(\d+)\s*days?/i,
    /(?:past|last)\s+(\d+)\s*days?/i,
    /for\s+(\d+)\s*days?/i,
  ];
  
  const minPatterns = [
    /minimum\s*(?:sleep|time|duration)?[:\s]+(\d+\.?\d*)\s*(hours?|h|minutes?|min)/i,
    /min[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
    /low(?:est)?[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
  ];
  
  const maxPatterns = [
    /maximum\s*(?:sleep|time|duration)?[:\s]+(\d+\.?\d*)\s*(hours?|h|minutes?|min)/i,
    /max[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
    /high(?:est)?[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
  ];
  
  let totalHours: number | undefined;
  let avgPerDay: number | undefined;
  let daysTracked: number | undefined;
  let minValue: number | undefined;
  let maxValue: number | undefined;
  
  for (const pattern of totalPatterns) {
    const match = cleanContent.match(pattern);
    if (match) { totalHours = parseFloat(match[1]); break; }
  }
  
  for (const pattern of avgPatterns) {
    const match = cleanContent.match(pattern);
    if (match) { avgPerDay = parseFloat(match[1]); break; }
  }
  
  for (const pattern of daysPatterns) {
    const match = cleanContent.match(pattern);
    if (match) { daysTracked = parseInt(match[1]); break; }
  }
  
  for (const pattern of minPatterns) {
    const match = cleanContent.match(pattern);
    if (match) { minValue = parseFloat(match[1]); break; }
  }
  
  for (const pattern of maxPatterns) {
    const match = cleanContent.match(pattern);
    if (match) { maxValue = parseFloat(match[1]); break; }
  }
  
  // Show canvas if we have meaningful stats (total, avg, or min/max with days)
  const hasStats = totalHours || avgPerDay || (minValue && maxValue);
  if (hasStats) {
    const habitPatterns = /(?:sleep|workout|meditation|reading|coding|walk|daily walk|exercise|running|gym|deep work|technical skills|caffeine|water)/i;
    const habitMatch = question.match(habitPatterns) || cleanContent.match(habitPatterns);
    const habitName = habitMatch ? habitMatch[0].charAt(0).toUpperCase() + habitMatch[0].slice(1).toLowerCase() : 'Activity';
    
    return {
      type: 'stats',
      title: `${habitName} Overview`,
      habitName,
      stats: {
        daysTracked: daysTracked || 7,
        totalHours,
        avgPerDay,
        minValue,
        maxValue,
      },
    };
  }
  
  return undefined;
}

// Build canvas data directly from tool results (more reliable than text parsing)
function buildCanvasFromToolData(
  toolData: { stats?: any; dailyBreakdown?: any; dailyBreakdownHabit?: any; correlation?: any } | null,
  question: string
): HabitCanvasData | undefined {
  if (!toolData) return undefined;
  
  // Extract habit name from question
  const habitPatterns = /(?:sleep|workout|meditation|reading|coding|walk|exercise|running|gym|deep work|technical skills|caffeine)/i;
  const habitMatch = question.match(habitPatterns);
  const habitName = habitMatch 
    ? habitMatch[0].charAt(0).toUpperCase() + habitMatch[0].slice(1).toLowerCase() 
    : 'Activity';
  
  // If we have daily breakdown data, build trends canvas (with table)
  if (toolData.dailyBreakdown && Array.isArray(toolData.dailyBreakdown) && toolData.dailyBreakdown.length > 0) {
    // Get habit name and unit from tool data if available
    const actualHabitName = toolData.dailyBreakdownHabit?.name || habitName;
    const habitUnit = toolData.dailyBreakdownHabit?.unit;
    
    // Determine if this is a duration-based or amount-based habit
    // Check the first data item - API returns null (not undefined) for non-applicable fields
    const firstItem = toolData.dailyBreakdown[0];
    const isDuration = (firstItem.total_hours != null && firstItem.total_hours > 0) || 
                       (firstItem.total_duration_seconds != null && firstItem.total_duration_seconds > 0);
    
    // Check if the habit's unit is minutes (user chose to track in minutes, not hours)
    const isMinutesBased = habitUnit && ['minutes', 'minute', 'min', 'm'].includes(habitUnit.toLowerCase());
    
    // Build daily data with proper field - respect the user's chosen unit
    // The API always provides 'value' as a fallback, but also specific fields
    const dailyData = toolData.dailyBreakdown.map((item: any) => {
      if (isDuration) {
        // For duration habits, convert to the user's chosen unit (minutes or hours)
        let durationValue: number;
        if (isMinutesBased) {
          // User wants minutes - convert seconds to minutes
          durationValue = item.total_duration_seconds != null
            ? item.total_duration_seconds / 60
            : item.total_hours != null
              ? item.total_hours * 60
              : item.value ?? 0;
          return { date: item.date, amount: durationValue, entries: item.entries };
        } else {
          // User wants hours (default for duration)
          durationValue = item.total_hours != null 
            ? item.total_hours 
            : item.total_duration_seconds 
              ? item.total_duration_seconds / 3600 
              : item.value ?? 0;
          return { date: item.date, hours: durationValue, entries: item.entries };
        }
      } else {
        // For amount habits, use total_amount or value (API always provides value)
        const amountValue = item.total_amount ?? item.value ?? 0;
        return { date: item.date, amount: amountValue, entries: item.entries };
      }
    });
    
    // Calculate totals - use amount for minutes-based or non-duration, hours for hour-based duration
    const useAmount = isMinutesBased || !isDuration;
    const totalValue = dailyData.reduce((sum: number, d: any) => 
      sum + (useAmount ? (d.amount || 0) : (d.hours || 0)), 0
    );
    const roundedTotal = Math.round(totalValue * 100) / 100;
    const avgPerDay = Math.round((totalValue / dailyData.length) * 100) / 100;
    
    // Also grab min/max and unit from stats if available
    let minValue: number | undefined;
    let maxValue: number | undefined;
    let unit: string | undefined = habitUnit;
    
    if (toolData.stats && Array.isArray(toolData.stats) && toolData.stats.length > 0) {
      const stat = toolData.stats[0];
      // API returns generic 'min' and 'max' fields
      minValue = stat.min;
      maxValue = stat.max;
      unit = stat.unit || habitUnit;
    }
    
    // For minutes-based habits, treat as amount (not hours) so the canvas displays correctly
    const useHoursDisplay = isDuration && !isMinutesBased;
    
    return {
      type: 'trends',
      title: `${actualHabitName} Trends`,
      habitName: actualHabitName,
      dailyData,
      dateRange: {
        start: dailyData[0]?.date || '',
        end: dailyData[dailyData.length - 1]?.date || '',
      },
      stats: {
        daysTracked: dailyData.length,
        totalHours: useHoursDisplay ? roundedTotal : undefined,
        totalAmount: !useHoursDisplay ? roundedTotal : undefined,
        avgPerDay,
        minValue,
        maxValue,
        unit,
      },
    };
  }
  
  // If we have stats data, build stats canvas
  if (toolData.stats && Array.isArray(toolData.stats) && toolData.stats.length > 0) {
    const stat = toolData.stats[0];
    // Check if unit indicates duration (hours, minutes)
    const isDuration = stat.unit && ['hours', 'hour', 'h', 'minutes', 'minute', 'min'].includes(stat.unit.toLowerCase());
    
    return {
      type: 'stats',
      title: `${stat.name || habitName} Overview`,
      habitName: stat.name || habitName,
      stats: {
        daysTracked: stat.days_with_data || 0,
        // Use generic 'total' field from API - it contains the right value regardless of type
        totalHours: isDuration ? stat.total : undefined,
        totalAmount: !isDuration ? stat.total : undefined,
        avgPerDay: stat.average,
        minValue: stat.min,
        maxValue: stat.max,
        unit: stat.unit,
      },
    };
  }
  
  // If we have correlation data
  if (toolData.correlation) {
    return {
      type: 'stats',
      title: 'Correlation Analysis',
      habitName: `${toolData.correlation.habit1_name} vs ${toolData.correlation.habit2_name}`,
      stats: {
        daysTracked: toolData.correlation.data_points || 0,
        avgPerDay: toolData.correlation.correlation_coefficient,
      },
      insights: [toolData.correlation.interpretation || ''],
    };
  }
  
  return undefined;
}

// Remove table and daily breakdown from content when canvas is showing
function cleanContentForDisplay(content: string): string {
  let cleaned = content;
  
  // Remove markdown tables
  const tablePattern = /\|[\s\S]*?\|[\s\S]*?(?=\n\n|\n[^|]|$)/g;
  cleaned = cleaned.replace(tablePattern, '');
  
  // Remove "Daily Breakdown" section with bullet points
  // Matches "Daily Breakdown" header followed by bullet list items with dates
  const dailyBreakdownPattern = /(?:Daily Breakdown|Here's a breakdown)[:\s]*\n(?:\s*[-•*]\s*\*{0,2}(?:January|February|March|April|May|June|July|August|September|October|November|December|\d{4}-\d{2}-\d{2})[^•\n]*\n?)+/gi;
  cleaned = cleaned.replace(dailyBreakdownPattern, '');
  
  // Also remove standalone date lists (bullet points starting with dates)
  const dateListPattern = /(?:\s*[-•*]\s*\*{0,2}(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\*{0,2}[:\s]+[\d.]+\s*hours?\s*\n?)+/gi;
  cleaned = cleaned.replace(dateListPattern, '');
  
  // Remove multiple consecutive newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // Remove leading/trailing whitespace
  cleaned = cleaned.trim();
  
  return cleaned;
}

// Python API base URL
const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// Persisted conversation types
interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_payload?: Record<string, unknown> | null;
  created_at: string;
}

interface PersistedConversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: PersistedMessage[];
}

// Sidebar conversation item (without full messages)
interface ConversationListItem {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  first_message?: string;
}

export function ChatClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuestion = searchParams.get('q');
  const { getToken } = useAuth();
  const { setIsFullScreenChat } = useAI();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [hasSubmittedInitial, setHasSubmittedInitial] = useState(false);
  const [canvasData, setCanvasData] = useState<HabitCanvasData | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  
  // Conversation persistence state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoadingConversation, setIsLoadingConversation] = useState(true);
  
  // Sidebar state
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  
  // Voice mode state
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Set full screen chat mode on mount, reset on unmount
  useEffect(() => {
    setIsFullScreenChat(true);
    return () => setIsFullScreenChat(false);
  }, [setIsFullScreenChat]);
  
  // Load latest conversation on mount (only if no initial question)
  useEffect(() => {
    const loadLatestConversation = async () => {
      // Skip loading if there's an initial question - we'll start fresh
      if (initialQuestion) {
        setIsLoadingConversation(false);
        return;
      }
      
      try {
        const token = await getToken();
        if (!token) {
          setIsLoadingConversation(false);
          return;
        }
        
        const response = await fetch(`${PYTHON_API_BASE}/api/conversations/latest`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const conversation: PersistedConversation | null = await response.json();
          
          if (conversation && conversation.messages && conversation.messages.length > 0) {
            console.log('📥 Loaded conversation:', conversation.id, 'with', conversation.messages.length, 'messages');
            
            // Convert persisted messages to our Message format
            const loadedMessages: Message[] = conversation.messages.map((m) => {
              // Build canvasData from tool_payload if available
              let messageCanvasData: HabitCanvasData | undefined;
              if (m.tool_payload && m.role === 'assistant') {
                const toolData = m.tool_payload as { stats?: unknown; dailyBreakdown?: unknown; dailyBreakdownHabit?: unknown; correlation?: unknown };
                // Find the original user question (previous message)
                const messageIndex = conversation.messages.findIndex(msg => msg.id === m.id);
                const previousUserMessage = messageIndex > 0 ? conversation.messages[messageIndex - 1] : null;
                const question = previousUserMessage?.role === 'user' ? previousUserMessage.content : '';
                
                messageCanvasData = buildCanvasFromToolData(toolData, question);
              }
              
              return {
                id: m.id,
                role: m.role,
                content: m.content,
                canvasData: messageCanvasData,
              };
            });
            
            setMessages(loadedMessages);
            setConversationId(conversation.id);
            
            // Set canvas data from the last assistant message that has it
            const lastMessageWithCanvas = [...loadedMessages].reverse().find(m => m.canvasData);
            if (lastMessageWithCanvas?.canvasData) {
              setCanvasData(lastMessageWithCanvas.canvasData);
            }
          }
        }
      } catch (error) {
        console.error('Failed to load conversation:', error);
      } finally {
        setIsLoadingConversation(false);
      }
    };
    
    loadLatestConversation();
  }, [getToken, initialQuestion]);

  // Load conversations list for sidebar
  const loadConversationsList = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      
      setIsLoadingConversations(true);
      const response = await fetch(`${PYTHON_API_BASE}/api/conversations?limit=10`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.conversations) {
          setConversations(data.conversations);
        }
      }
    } catch (error) {
      console.error('Failed to load conversations list:', error);
    } finally {
      setIsLoadingConversations(false);
    }
  }, [getToken]);

  // Load conversations list on mount
  useEffect(() => {
    loadConversationsList();
  }, [loadConversationsList]);

  // Switch to a different conversation
  const switchConversation = useCallback(async (targetConversationId: string) => {
    if (targetConversationId === conversationId) return;
    
    try {
      const token = await getToken();
      if (!token) return;
      
      setIsLoadingConversation(true);
      setMessages([]);
      setCanvasData(null);
      setStreamingContent('');
      
      const response = await fetch(`${PYTHON_API_BASE}/api/conversations/${targetConversationId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const conversation: PersistedConversation = await response.json();
        
        if (conversation && conversation.messages && conversation.messages.length > 0) {
          const loadedMessages: Message[] = conversation.messages.map((m) => {
            let messageCanvasData: HabitCanvasData | undefined;
            if (m.tool_payload && m.role === 'assistant') {
              const toolData = m.tool_payload as { stats?: unknown; dailyBreakdown?: unknown; dailyBreakdownHabit?: unknown; correlation?: unknown };
              const messageIndex = conversation.messages.findIndex(msg => msg.id === m.id);
              const previousUserMessage = messageIndex > 0 ? conversation.messages[messageIndex - 1] : null;
              const question = previousUserMessage?.role === 'user' ? previousUserMessage.content : '';
              messageCanvasData = buildCanvasFromToolData(toolData, question);
            }
            
            return {
              id: m.id,
              role: m.role,
              content: m.content,
              canvasData: messageCanvasData,
            };
          });
          
          setMessages(loadedMessages);
          setConversationId(conversation.id);
          
          const lastMessageWithCanvas = [...loadedMessages].reverse().find(m => m.canvasData);
          if (lastMessageWithCanvas?.canvasData) {
            setCanvasData(lastMessageWithCanvas.canvasData);
          }
        }
      }
    } catch (error) {
      console.error('Failed to switch conversation:', error);
    } finally {
      setIsLoadingConversation(false);
    }
  }, [getToken, conversationId]);

  // Start a new conversation
  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setCanvasData(null);
    setStreamingContent('');
    setInput('');
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (isLoading || !text.trim()) return;
    
    setIsLoading(true);
    setStreamingContent('');
    setCurrentQuestion(text);
    
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
    };
    
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    
    try {
      const token = await getToken();
      
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          conversationId: conversationId, // Include conversation ID for persistence
        }),
      });
      
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      if (!response.body) throw new Error('No response body');
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let toolData: { stats?: any; dailyBreakdown?: any; dailyBreakdownHabit?: any; correlation?: any } | null = null;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          // Check for conversation ID (sent first by server)
          if (line.includes('__CONVERSATION_ID__')) {
            const match = line.match(/__CONVERSATION_ID__(.+?)__END_CONVERSATION_ID__/);
            if (match) {
              const newConversationId = match[1];
              console.log('💬 Received conversation ID:', newConversationId);
              setConversationId(newConversationId);
              // Refresh conversations list to include the new conversation
              loadConversationsList();
            }
            continue;
          }
          
          // Check for tool data
          if (line.includes('__TOOL_DATA__')) {
            const match = line.match(/__TOOL_DATA__(.+?)__END_TOOL_DATA__/);
            if (match) {
              try {
                toolData = JSON.parse(match[1]);
                console.log('📦 Received tool data:', toolData);
              } catch (e) {
                console.error('Failed to parse tool data:', e);
              }
            }
            continue;
          }
          
          if (line.startsWith('0:')) {
            try {
              const data = JSON.parse(line.substring(2).trim());
              if (typeof data === 'string') {
                fullResponse += data;
                setStreamingContent(fullResponse);
              }
            } catch {
              const lineText = line.substring(2).trim();
              if (lineText && !lineText.startsWith('{')) {
                fullResponse += lineText;
                setStreamingContent(fullResponse);
              }
            }
          } else if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.substring(5).trim());
              if (data.type === 'text-delta' && data.delta) {
                fullResponse += data.delta;
                setStreamingContent(fullResponse);
              }
            } catch {}
          }
        }
      }
      
      // Build canvas data - prefer tool data, fall back to text extraction
      let extractedCanvas = buildCanvasFromToolData(toolData, text);
      if (!extractedCanvas) {
        extractedCanvas = extractCanvasData(fullResponse, text);
      }
      
      if (extractedCanvas) {
        setCanvasData(extractedCanvas);
      }
      
      // Clean content if canvas is showing
      const displayContent = extractedCanvas 
        ? cleanContentForDisplay(fullResponse)
        : fullResponse;
      
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: displayContent || 'I was unable to process your request.',
        canvasData: extractedCanvas,
      };
      
      setMessages([...newMessages, assistantMessage]);
      setStreamingContent('');
      
    } catch (error) {
      console.error('Chat error:', error);
      setMessages([...newMessages, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, there was an error processing your request. Please try again.',
      }]);
    } finally {
      setIsLoading(false);
      setCurrentQuestion('');
    }
  }, [messages, isLoading, getToken, conversationId, loadConversationsList]);

  useEffect(() => {
    // Wait for conversation loading to complete before processing initial question
    if (isLoadingConversation) return;
    
    if (initialQuestion && !hasSubmittedInitial) {
      setHasSubmittedInitial(true);
      // Start a new conversation when coming from ?q= query param
      setConversationId(null);
      setMessages([]);
      sendMessage(initialQuestion);
      
      // Clear the ?q= param from URL so refresh doesn't re-ask the question
      // Use replace to avoid adding to history
      router.replace('/chat', { scroll: false });
    }
  }, [initialQuestion, hasSubmittedInitial, isLoadingConversation, sendMessage, router]);

  useEffect(() => {
    if (messages.length > 0 || streamingContent) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingContent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Voice recording
  const startVoiceRecognition = async () => {
    if (isListening) {
      stopVoiceRecording();
      return;
    }

    try {
      setVoiceError(null);
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
              setInput(result.text);
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
      setIsListening(true);

      const autoStopTimer = setTimeout(() => {
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
      }, 5000);

      (window as any).__mediaRecorder = mediaRecorder;
      (window as any).__autoStopTimer = autoStopTimer;

    } catch (err: any) {
      setVoiceError(err.name === 'NotAllowedError' 
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

  // Loading conversation state
  if (isLoadingConversation) {
    return (
      <div className="h-full flex flex-col bg-[#fafaf8] relative">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2">
            <Loader className="w-5 h-5 animate-spin text-gray-400" />
            <span className="text-gray-500 text-sm">Loading conversation...</span>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (messages.length === 0 && !isLoading) {
    return (
      <div className="h-full flex bg-[#fafaf8] relative">
        {/* Conversation History Sidebar - Also shown in empty state */}
        <motion.div
          initial={false}
          animate={{ width: isSidebarCollapsed ? 48 : 220 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className="h-full border-r border-gray-100 bg-[#fafaf8] flex flex-col overflow-hidden"
        >
          {/* Sidebar Header with Logo */}
          <div className="flex items-center justify-between p-3 pt-8 pb-3">
            {!isSidebarCollapsed ? (
              <div className="flex items-center gap-1.5">
                <RitualLogo className="w-4 h-4" />
                <span className="text-sm font-semibold text-gray-900">Ritual</span>
              </div>
            ) : (
              <div className="mx-auto">
                <RitualLogo className="w-4 h-4" />
              </div>
            )}
            {!isSidebarCollapsed && (
              <button
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-[#F3F3F3] rounded transition-colors"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          
          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto py-1">
            {isSidebarCollapsed ? (
              <div className="flex flex-col items-center gap-0.5 px-2">
                <button
                  onClick={() => setIsSidebarCollapsed(false)}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-[#F3F3F3] rounded transition-colors mb-1"
                  title="Expand sidebar"
                >
                  <PanelLeft className="w-4 h-4" />
                </button>
                {conversations.slice(0, 10).map((conv, index) => (
                  <button
                    key={conv.id}
                    onClick={() => switchConversation(conv.id)}
                    className={cn(
                      "w-8 h-8 flex items-center justify-center rounded transition-colors",
                      conv.id === conversationId
                        ? "bg-[#E8E8E8] text-gray-900"
                        : "text-gray-400 hover:text-gray-600 hover:bg-[#F3F3F3]"
                    )}
                    title={conv.first_message || conv.title || `Conversation ${index + 1}`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 px-2">
                {isLoadingConversations ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader className="w-4 h-4 animate-spin text-gray-400" />
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-400 text-center">
                    No conversations yet
                  </div>
                ) : (
                  conversations.slice(0, 10).map((conv) => {
                    const displayTitle = conv.first_message || conv.title || 'New conversation';
                    const truncatedTitle = displayTitle.length > 26 
                      ? displayTitle.substring(0, 26) + '...' 
                      : displayTitle;
                    
                    return (
                      <button
                        key={conv.id}
                        onClick={() => switchConversation(conv.id)}
                        className={cn(
                          "w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors truncate",
                          conv.id === conversationId
                            ? "bg-[#E8E8E8] text-gray-900 font-medium"
                            : "text-gray-600 hover:bg-[#F3F3F3] hover:text-gray-800"
                        )}
                        title={displayTitle}
                      >
                        {truncatedTitle}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </motion.div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Back Button */}
          <div className="px-6 pt-10">
            <button
              onClick={() => router.push('/dashboard')}
              className="w-9 h-9 flex items-center justify-center bg-white border border-gray-200 hover:bg-[#F3F3F3] text-gray-500 hover:text-gray-700 transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center p-6">
            <div className="max-w-lg w-full space-y-6">
              <div className="text-center space-y-2">
                <h1 className="text-xl font-medium text-gray-900">Ask about your personal data</h1>
                <p className="text-gray-500 text-sm">Get insights, trends, and analysis of your tracking data.</p>
              </div>

              <form onSubmit={handleSubmit} className="relative">
                <div className="bg-[#fafaf8] border border-gray-200 shadow-sm overflow-hidden transition-shadow hover:shadow-md focus-within:shadow-md focus-within:border-gray-300">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="How have I been sleeping this week?"
                    className="w-full resize-none border-0 outline-none text-[15px] text-gray-900 placeholder-gray-400 bg-transparent px-4 py-4 min-h-[60px] max-h-[120px]"
                    rows={1}
                  />
                  <div className="flex justify-between items-center px-3 pb-3">
                    {/* Voice Button */}
                    <div className="flex items-center gap-2 group">
                      <button
                        type="button"
                        onClick={startVoiceRecognition}
                        className={cn(
                          "w-8 h-8 flex items-center justify-center transition-all duration-200",
                          isListening || isProcessingVoice
                            ? "text-gray-900"
                            : "text-gray-400 hover:text-gray-600"
                        )}
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
                      {!isListening && !isProcessingVoice && (
                        <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          Voice
                        </span>
                      )}
                    </div>
                    
                    {/* Submit Button */}
                    <button
                      type="submit"
                      disabled={!input.trim()}
                      className="w-8 h-8 flex items-center justify-center bg-black hover:bg-gray-800 text-white transition-all disabled:cursor-not-allowed"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </form>

              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  "How's my sleep this week?",
                  "Show my workout progress",
                  "What habits need attention?",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setInput(suggestion);
                      textareaRef.current?.focus();
                    }}
                    className="px-3 py-1.5 text-xs text-gray-500 bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:text-gray-700 transition-all"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Chat view
  return (
    <div className="h-full flex bg-[#fafaf8] relative">
      {/* Conversation History Sidebar */}
      <motion.div
        initial={false}
        animate={{ width: isSidebarCollapsed ? 48 : 220 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        className="h-full border-r border-gray-100 bg-[#fafaf8] flex flex-col overflow-hidden"
      >
        {/* Sidebar Header with Logo */}
        <div className="flex items-center justify-between p-3 pt-8 pb-3">
          {!isSidebarCollapsed ? (
            <div className="flex items-center gap-1.5">
              <RitualLogo className="w-4 h-4" />
              <span className="text-sm font-semibold text-gray-900">Ritual</span>
            </div>
          ) : (
            <div className="mx-auto">
              <RitualLogo className="w-4 h-4" />
            </div>
          )}
          {!isSidebarCollapsed && (
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-[#F3F3F3] rounded transition-colors"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        
        {/* New Chat Button */}
        <div className="px-2 pb-2">
          {!isSidebarCollapsed ? (
            <button
              onClick={startNewConversation}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-[#F3F3F3] rounded transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Chat</span>
            </button>
          ) : (
            <button
              onClick={startNewConversation}
              className="w-8 h-8 mx-auto flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-[#F3F3F3] rounded transition-colors"
              title="New Chat"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
        
        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto py-1">
          {isSidebarCollapsed ? (
            // Collapsed state - show icons only
            <div className="flex flex-col items-center gap-0.5 px-2">
              <button
                onClick={() => setIsSidebarCollapsed(false)}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-[#F3F3F3] rounded transition-colors mb-1"
                title="Expand sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
              {conversations.slice(0, 10).map((conv, index) => (
                <button
                  key={conv.id}
                  onClick={() => switchConversation(conv.id)}
                  className={cn(
                    "w-8 h-8 flex items-center justify-center rounded transition-colors",
                    conv.id === conversationId
                      ? "bg-[#E8E8E8] text-gray-900"
                      : "text-gray-400 hover:text-gray-600 hover:bg-[#F3F3F3]"
                  )}
                  title={conv.first_message || conv.title || `Conversation ${index + 1}`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          ) : (
            // Expanded state - show full list
            <div className="flex flex-col gap-0.5 px-2">
              {isLoadingConversations ? (
                <div className="flex items-center justify-center py-4">
                  <Loader className="w-4 h-4 animate-spin text-gray-400" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="px-3 py-4 text-xs text-gray-400 text-center">
                  No conversations yet
                </div>
              ) : (
                conversations.slice(0, 10).map((conv) => {
                  const displayTitle = conv.first_message || conv.title || 'New conversation';
                  const truncatedTitle = displayTitle.length > 26 
                    ? displayTitle.substring(0, 26) + '...' 
                    : displayTitle;
                  
                  return (
                    <button
                      key={conv.id}
                      onClick={() => switchConversation(conv.id)}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors truncate",
                        conv.id === conversationId
                          ? "bg-[#E8E8E8] text-gray-900 font-medium"
                          : "text-gray-600 hover:bg-[#F3F3F3] hover:text-gray-800"
                      )}
                      title={displayTitle}
                    >
                      {truncatedTitle}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Chat Area */}
      <div className={cn(
        "flex-1 flex flex-col transition-all duration-300 ease-out",
        canvasData ? "pr-0" : ""
      )}>
        <div className="flex-1 overflow-y-auto">
          {/* Back button row - like Perplexity, with extra top padding to clear traffic lights */}
          <div className="px-6 pt-10 pb-2">
            <button
              onClick={() => router.push('/dashboard')}
              className="w-9 h-9 flex items-center justify-center bg-white border border-gray-200 hover:bg-[#F3F3F3] text-gray-500 hover:text-gray-700 transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>
            
          {/* Chat content - centered below back button */}
          <div className={cn(
            "mx-auto px-8 pt-4 pb-32 transition-all duration-300",
            canvasData ? "max-w-2xl" : "max-w-3xl"
          )}>
            {messages.map((message) => (
              <div key={message.id}>
                {message.role === 'user' ? (
                  <h1 className="text-2xl font-medium text-gray-900 leading-snug mb-6">
                    {message.content}
                  </h1>
                ) : (
                  <div className="mb-8">
                    <Response className="text-[15px] leading-[1.7] text-gray-700">
                      {message.content}
                    </Response>
                  </div>
                )}
              </div>
            ))}
            
            {streamingContent && (
              <div className="mb-8">
                <Response className="text-[15px] leading-[1.7] text-gray-700">
                  {canvasData ? cleanContentForDisplay(streamingContent) : streamingContent}
                </Response>
              </div>
            )}
            
            {isLoading && !streamingContent && (
              <div className="flex items-center gap-2 py-2">
                <TextShimmer className="text-sm" duration={1.5}>
                  Thinking...
                </TextShimmer>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="sticky bottom-0 left-0 right-0 pb-6 pt-4 bg-gradient-to-t from-[#fafaf8] via-[#fafaf8] to-transparent">
          <div className={cn(
            "mx-auto px-8 transition-all duration-300",
            canvasData ? "max-w-2xl" : "max-w-3xl"
          )}>
            <form onSubmit={handleSubmit}>
              <div className="bg-[#fafaf8] border border-gray-200 shadow-sm overflow-hidden transition-shadow focus-within:shadow-md focus-within:border-gray-300">
                <div className="px-4 py-3">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask a follow-up question..."
                    className="w-full resize-none border-0 outline-none text-[15px] text-gray-900 placeholder-gray-400 bg-transparent min-h-[24px] max-h-[120px]"
                    rows={1}
                    disabled={isLoading}
                  />
                </div>
                <div className="flex justify-between items-center px-3 pb-3">
                  {/* Voice Button */}
                  <div className="flex items-center gap-2 group">
                    <button
                      type="button"
                      onClick={startVoiceRecognition}
                      disabled={isLoading}
                      className={cn(
                        "w-8 h-8 flex items-center justify-center transition-all duration-200",
                        isListening || isProcessingVoice
                          ? "text-gray-900"
                          : "text-gray-400 hover:text-gray-600",
                        "disabled:opacity-50"
                      )}
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
                    {!isListening && !isProcessingVoice && !isLoading && (
                      <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        Voice
                      </span>
                    )}
                  </div>
                  
                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={!input.trim() || isLoading}
                    className="w-8 h-8 flex items-center justify-center bg-black hover:bg-gray-800 text-white transition-all disabled:cursor-not-allowed"
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
      </div>

      {/* Canvas Side Panel */}
      <AnimatePresence>
        {canvasData && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 420, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden border-l border-gray-100"
          >
            <HabitCanvas 
              data={canvasData} 
              onClose={() => setCanvasData(null)} 
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

