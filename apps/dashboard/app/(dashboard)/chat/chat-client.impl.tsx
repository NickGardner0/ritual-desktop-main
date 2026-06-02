'use client'

import React, { startTransition, useDeferredValue, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { HabitCanvasData } from '@/components/chat/habit-canvas';
import { useHabits } from '@/contexts/HabitsContext';
import type { ViewMode } from '@/components/analytics/view-mode-toggle';
import { buildInstantSuggestions, mergeSuggestions, type ChatSuggestion } from '@/lib/ai/chat-suggestions';
import { isTauri } from '@/lib/tauri-utils';
import {
  getOverviewActivityBundle,
  hasMeaningfulOverviewActivity,
  getOverviewActivityRangeKeysForText,
  overviewActivityKeys,
  type LocalOverviewActivityBundle,
} from '@/lib/ai/overview-activity/overview-activity-query';
import type {
  AiFact,
  AiFactListResponse,
  ArtifactDetail,
  ArtifactKind,
  ConversationQueueItem,
  ConversationQueueListResponse,
  ConversationQueueRunResponse,
} from '@/lib/workflows/types';

import {
  CHAT_PAGE_CONNECT_BAR_DISMISS_KEY,
  DEFAULT_CANVAS_WIDTH,
  MAX_CANVAS_WIDTH,
  MAX_VISIBLE_CHAT_SUGGESTIONS,
  MIN_CANVAS_WIDTH,
  PYTHON_API_BASE,
  buildCanvasFromToolData,
  buildConversationArtifactBody,
  cleanContentForDisplay,
  extractCanvasData,
  getPersistedAfterMessageId,
  getToolLabel,
} from './chat-client.shared';
import type {
  ConversationContextMenuState,
  ConversationListItem,
  Message,
  PersistedConversation,
} from './chat-client.shared';
import { createChatClientLayout } from './chat-client.layout';
import { ChatSuggestionList } from './chat-suggestion-list';
import { useChatOverviewActivityPrefetch } from './use-chat-overview-activity-prefetch';
import { useChatVoiceInput } from './use-chat-voice-input';

export function ChatClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuestion = searchParams.get('q');
  const initialConversationId = searchParams.get('conversation');
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { habits, habitLogs } = useHabits();

  // Time-of-day greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Good morning';
    if (hour >= 12 && hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Connect-apps strip under the chat input. Dismissable; persists per user.
  const [showConnectAppsBar, setShowConnectAppsBar] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(CHAT_PAGE_CONNECT_BAR_DISMISS_KEY) !== '1';
    } catch {
      return true;
    }
  });

  const dismissConnectAppsBar = useCallback(() => {
    setShowConnectAppsBar(false);
    try {
      window.localStorage.setItem(CHAT_PAGE_CONNECT_BAR_DISMISS_KEY, '1');
    } catch {
      // ignore storage failures
    }
  }, []);

  const openIntegrationsPage = useCallback(() => {
    router.push('/integrations');
  }, [router]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsAbortRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [canvasData, setCanvasData] = useState<HabitCanvasData | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const initialQuestionSubmissionRef = useRef<string | null>(null);
  
  // Conversation persistence state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  
  // Sidebar state
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);  // Collapsed by default
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [conversationContextMenu, setConversationContextMenu] = useState<ConversationContextMenuState>(null);
  const [queueItems, setQueueItems] = useState<ConversationQueueItem[]>([]);
  const [queueAutoRun, setQueueAutoRun] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [linkedArtifacts, setLinkedArtifacts] = useState<ArtifactDetail[]>([]);
  const [memoryFacts, setMemoryFacts] = useState<AiFact[]>([]);
  
  const {
    audioStream,
    isListening,
    isProcessingVoice,
    partialTranscript,
    startVoiceRecognition,
  } = useChatVoiceInput({ setInput, textareaRef });
  
  // Voice style mode (Phase 4A - conversational responses)
  const [voiceStyleEnabled, setVoiceStyleEnabled] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [keyboardSuggestionActive, setKeyboardSuggestionActive] = useState(false);
  
  // Tool execution status for shimmer → checkmark UI
  const [toolStatus, setToolStatus] = useState<{ label: string; done: boolean } | null>(null);

  // Scroll refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestUserMessageRef = useRef<HTMLDivElement>(null);

  // Resizable side panel state
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_CANVAS_WIDTH);
  const [isResizingCanvas, setIsResizingCanvas] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() => (
    typeof window !== 'undefined' ? window.innerWidth : 1400
  ));
  const [headerLeftSlot, setHeaderLeftSlot] = useState<HTMLElement | null>(null);
  const [headerCenterSlot, setHeaderCenterSlot] = useState<HTMLElement | null>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const maxCanvasWidthForViewport = Math.min(
    MAX_CANVAS_WIDTH,
    Math.max(MIN_CANVAS_WIDTH, Math.floor(viewportWidth * 0.48)),
  );
  const effectiveCanvasWidth = Math.min(canvasWidth, maxCanvasWidthForViewport);
  const deferredInput = useDeferredValue(input.trim());
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );

  useChatOverviewActivityPrefetch({
    input,
    queryClient,
    timezone,
    userId: user?.id,
  });

  useEffect(() => {
    setHeaderLeftSlot(document.getElementById('header-left-slot'));
    setHeaderCenterSlot(document.getElementById('header-center-slot'));
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setCanvasWidth((prev) => Math.min(prev, maxCanvasWidthForViewport));
  }, [maxCanvasWidthForViewport]);

  // Warm dashboard route so header controls don't pop in late on return.
  useEffect(() => {
    router.prefetch('/dashboard');
  }, [router]);

  const handleViewChange = useCallback((newView: ViewMode) => {
    if (newView === 'chat') return;
    router.push(`/dashboard?view=${newView}`);
  }, [router]);

  const fetchSuggestions = useCallback(async (
    query: string,
    signal?: AbortSignal,
  ): Promise<ChatSuggestion[]> => {
    try {
      const token = await getToken();
      const params = new URLSearchParams({ mode: 'chat', q: query });
      const response = await fetch(`/api/suggestions?${params.toString()}`, {
        cache: 'no-store',
        signal,
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return (data.suggestions || []).slice(0, 5).map((suggestion: ChatSuggestion) => ({
        ...suggestion,
        score: suggestion.score || 0,
        source: 'server',
      }));
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return [];
      }
      console.error('Suggestions fetch error:', error);
      return [];
    }
  }, [getToken]);

  useEffect(() => {
    const localSuggestions = buildInstantSuggestions({
      mode: 'chat',
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
  }, [deferredInput, habits, habitLogs]);

  useEffect(() => {
    const localSuggestions = buildInstantSuggestions({
      mode: 'chat',
      query: deferredInput,
      habits,
      habitLogs,
      limit: 4,
    });

    suggestionsAbortRef.current?.abort();
    const controller = new AbortController();
    suggestionsAbortRef.current = controller;

    const timer = window.setTimeout(async () => {
      const remoteSuggestions = await fetchSuggestions(deferredInput, controller.signal);
      if (controller.signal.aborted) return;

      startTransition(() => {
        setSuggestions(mergeSuggestions(localSuggestions, remoteSuggestions, 4));
      });
    }, deferredInput ? 120 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [deferredInput, habits, habitLogs, fetchSuggestions]);
  
  // Start in a clean empty state unless an explicit saved conversation is requested.
  useEffect(() => {
    if (initialQuestion || initialConversationId) return;
    setIsLoadingConversation(false);
  }, [initialConversationId, initialQuestion]);

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

  const loadQueueItems = useCallback(async (targetConversationId: string) => {
    try {
      const response = await fetch(`/api/conversations/${targetConversationId}/queue`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data: ConversationQueueListResponse = await response.json();
      setQueueItems(data.items || []);
      setQueueAutoRun(Boolean(data.auto_run_queued));
    } catch (error) {
      console.error('Failed to load queue items:', error);
    }
  }, []);

  const loadLinkedArtifacts = useCallback(async (targetConversationId: string) => {
    try {
      const response = await fetch(`/api/artifacts?linked_to=${encodeURIComponent(targetConversationId)}&limit=12`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = await response.json() as { items?: Array<{ id: string }> };
      const artifactIds = (data.items || []).map((item) => item.id).slice(0, 6);
      if (artifactIds.length === 0) {
        setLinkedArtifacts([]);
        return;
      }
      const details = await Promise.all(
        artifactIds.map(async (artifactId) => {
          const detailResponse = await fetch(`/api/artifacts/${artifactId}`, { cache: 'no-store' });
          if (!detailResponse.ok) return null;
          return detailResponse.json() as Promise<ArtifactDetail>;
        }),
      );
      setLinkedArtifacts(details.filter(Boolean) as ArtifactDetail[]);
    } catch (error) {
      console.error('Failed to load linked artifacts:', error);
    }
  }, []);

  const loadMemoryFacts = useCallback(async () => {
    try {
      const response = await fetch('/api/ai-facts', { cache: 'no-store' });
      if (!response.ok) return;
      const data: AiFactListResponse = await response.json();
      setMemoryFacts(data.items || []);
    } catch (error) {
      console.error('Failed to load AI facts:', error);
    }
  }, []);

  // Load conversations list on mount
  useEffect(() => {
    loadConversationsList();
  }, [loadConversationsList]);

  useEffect(() => {
    loadMemoryFacts();
  }, [loadMemoryFacts]);

  useEffect(() => {
    if (!conversationId) {
      setQueueItems([]);
      setLinkedArtifacts([]);
      return;
    }
    void loadQueueItems(conversationId);
    void loadLinkedArtifacts(conversationId);
  }, [conversationId, loadLinkedArtifacts, loadQueueItems]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.dataset.chatSidebarCollapsed = String(isSidebarCollapsed);
    return () => {
      delete document.body.dataset.chatSidebarCollapsed;
    };
  }, [isSidebarCollapsed]);

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
              const toolData = m.tool_payload as { stats?: unknown; dailyBreakdown?: unknown; dailyBreakdownHabit?: unknown; correlation?: unknown; screenTimeSpent?: unknown; weeklyOverview?: unknown; dailyOverview?: unknown; monthlyOverview?: unknown };
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
          
          // Initialize voice style from conversation's response_mode
          setVoiceStyleEnabled(conversation.response_mode === 'voice');
          setQueueAutoRun(Boolean(conversation.auto_run_queued));
          
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

  useEffect(() => {
    if (!initialConversationId || initialQuestion) {
      return;
    }
    void switchConversation(initialConversationId);
  }, [initialConversationId, initialQuestion, switchConversation]);

  // Start a new conversation
  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setCanvasData(null);
    setStreamingContent('');
    setInput('');
    setVoiceStyleEnabled(false); // Reset voice style for new conversations
    setQueueItems([]);
    setLinkedArtifacts([]);
  }, []);

  // Delete a conversation
  const deleteConversation = useCallback(async (targetConversationId: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      
      const response = await fetch(`${PYTHON_API_BASE}/api/conversations/${targetConversationId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        setConversationContextMenu((current) => (
          current?.conversationId === targetConversationId ? null : current
        ));
        // Remove from local list
        setConversations(prev => prev.filter(c => c.id !== targetConversationId));
        
        // If the deleted conversation was the active one, start a new conversation
        if (targetConversationId === conversationId) {
          startNewConversation();
        }
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  }, [getToken, conversationId, startNewConversation]);

  const showConversationContextMenu = useCallback((targetConversationId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setConversationContextMenu({
      conversationId: targetConversationId,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  useEffect(() => {
    if (!conversationContextMenu) return;

    const closeMenu = () => setConversationContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [conversationContextMenu]);

  const handleConversationContextDelete = useCallback(() => {
    if (!conversationContextMenu) return;
    void deleteConversation(conversationContextMenu.conversationId);
  }, [conversationContextMenu, deleteConversation]);

  const saveConversationArtifact = useCallback(async (kind: ArtifactKind, message: Message) => {
    if (!conversationId) {
      toast.error('Save this after the conversation has been created.');
      return;
    }

    const titleBase = message.content.split('\n')[0]?.trim() || (kind === 'plan' ? 'New plan' : 'New notebook');
    const payload = {
      title: titleBase.slice(0, 80),
      summary: message.content.slice(0, 280),
      body: buildConversationArtifactBody(message, titleBase.slice(0, 80)),
      kind,
    };

    const response = await fetch(`/api/conversations/${conversationId}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      toast.error('Failed to save artifact.');
      return;
    }

    toast.success(kind === 'plan' ? 'Plan saved.' : 'Notebook saved.');
    void loadLinkedArtifacts(conversationId);
  }, [conversationId, loadLinkedArtifacts]);

  const appendToLatestNotebook = useCallback(async (message: Message) => {
    const latestNotebook = linkedArtifacts.find((artifact) => artifact.kind === 'notebook');
    if (!latestNotebook) {
      await saveConversationArtifact('notebook', message);
      return;
    }

    const currentBlocks = Array.isArray(latestNotebook.body?.blocks) ? latestNotebook.body.blocks : [];
    const nextBlocks = [
      ...currentBlocks,
      { type: 'summary', text: message.content },
    ];

    const response = await fetch(`/api/artifacts/${latestNotebook.id}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_version: latestNotebook.revision_count,
        editor_type: 'user',
        summary: latestNotebook.summary || message.content.slice(0, 160),
        change_note: 'Appended from chat response',
        body: {
          schemaVersion: 1,
          blocks: nextBlocks,
        },
      }),
    });

    if (!response.ok) {
      toast.error('Failed to append to notebook.');
      return;
    }

    toast.success('Appended to notebook.');
    void loadLinkedArtifacts(conversationId!);
  }, [conversationId, linkedArtifacts, loadLinkedArtifacts, saveConversationArtifact]);

  const queuePrompt = useCallback(async (promptText: string, source: ConversationQueueItem['source'] = 'manual') => {
    if (!conversationId) {
      toast.error('Queueing starts after the conversation is created.');
      return;
    }
    const anchorId = getPersistedAfterMessageId(messages[messages.length - 1]?.id);
    const response = await fetch(`/api/conversations/${conversationId}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt_text: promptText,
        source,
        auto_run: queueAutoRun,
        after_message_id: anchorId,
      }),
    });
    if (!response.ok) {
      toast.error('Failed to queue prompt.');
      return;
    }
    setInput('');
    toast.success('Queued for later.');
    await loadQueueItems(conversationId);
  }, [conversationId, loadQueueItems, messages, queueAutoRun]);

  const sendMessage = useCallback(async (text: string): Promise<boolean> => {
    if (isLoading || !text.trim()) return false;
    
    setIsLoading(true);
    setStreamingContent('');
    setCurrentQuestion(text);
    setToolStatus({ label: getToolLabel(text), done: false });
    
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
    };
    
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    
    const overviewRangeKeys = [...new Set(getOverviewActivityRangeKeysForText(text))];
    let localOverviewActivity: LocalOverviewActivityBundle[] | null = null;

    if (isTauri() && user?.id && overviewRangeKeys.length > 0) {
      const resolvedOverviewBundles = await Promise.all(
        overviewRangeKeys.map(async (rangeKey) => {
          const queryKey = overviewActivityKeys.detail(user.id, timezone, rangeKey);
          const cached = queryClient.getQueryData<LocalOverviewActivityBundle | null>(queryKey);

          if (hasMeaningfulOverviewActivity(cached)) {
            return cached;
          }

          try {
            return await queryClient.fetchQuery({
              queryKey,
              queryFn: () => getOverviewActivityBundle(rangeKey, timezone),
              staleTime: 1000 * 60 * 5,
            });
          } catch (error) {
            console.warn('Failed to resolve overview activity bundle for chat request', {
              rangeKey,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          }
        }),
      );

      const meaningfulOverviewBundles = resolvedOverviewBundles.filter(
        (bundle): bundle is LocalOverviewActivityBundle => hasMeaningfulOverviewActivity(bundle),
      );

      localOverviewActivity = meaningfulOverviewBundles.length > 0
        ? meaningfulOverviewBundles
        : null;
    }
    
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
          timezone,
          conversationId: conversationId, // Include conversation ID for persistence
          responseMode: voiceStyleEnabled ? 'voice' : 'text', // Phase 4A: Voice style mode
          localOverviewActivity,
        }),
      });
      
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      if (!response.body) throw new Error('No response body');
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let toolData: { stats?: any; dailyBreakdown?: any; dailyBreakdownHabit?: any; correlation?: any; trends?: any; anomalies?: any; screenTimeSpent?: any; weeklyOverview?: any; dailyOverview?: any; monthlyOverview?: any; suggested_followups?: string[]; reply_chips?: string[] } | null = null;
      let streamBuffer = '';
      let toolMarkedDone = false;

      const processStreamLine = (rawLine: string) => {
        const line = rawLine.replace(/\r$/, '');
        if (!line.trim()) return;

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
          return;
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
          return;
        }

        if (line.startsWith('0:')) {
          if (!toolMarkedDone) {
            toolMarkedDone = true;
            setToolStatus((prev) => prev ? { ...prev, done: true } : null);
          }
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
      };
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() ?? '';

        for (const line of lines) {
          processStreamLine(line);
        }
      }

      streamBuffer += decoder.decode();
      if (streamBuffer) {
        for (const line of streamBuffer.split('\n')) {
          processStreamLine(line);
        }
      }
      
      // Build canvas data - prefer tool data, then optional text extraction fallback.
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
      
      // Show follow-up suggestion chips for all modes
      const toolReplyChips = (toolData as any)?.reply_chips as string[] | undefined;
      const td = toolData as any;
      const replyChips = toolReplyChips && toolReplyChips.length > 0
        ? toolReplyChips
        : td?.weeklyOverview ? ['Show my trends', 'Any unusual days?', 'How does this compare to last month?']
        : td?.dailyOverview ? ['What did I work on today?', 'Show my weekly recap', 'Any anomalies this week?']
        : td?.monthlyOverview ? ['Compare to last month', 'Show my trends', 'What were my best days?']
        : td?.trends ? ['Show weekly recap', 'Any anomalies?', 'What habits are improving?']
        : td?.stats ? ['Show daily breakdown', 'Compare with another habit', 'Any unusual days?']
        : undefined;

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: displayContent || 'I was unable to process your request.',
        canvasData: extractedCanvas,
        replyChips: replyChips,  // Phase 4A
      };
      
      setMessages([...newMessages, assistantMessage]);
      setStreamingContent('');
      void loadMemoryFacts();
      return true;
    } catch (error) {
      console.error('Chat error:', error);
      setMessages([...newMessages, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, there was an error processing your request. Please try again.',
      }]);
      return false;
    } finally {
      setIsLoading(false);
      setCurrentQuestion('');
      setToolStatus(null);
    }
  }, [messages, isLoading, getToken, conversationId, loadConversationsList, loadMemoryFacts, voiceStyleEnabled, queryClient, timezone, user?.id]);

  const runQueuedItem = useCallback(async (itemId: string) => {
    if (!conversationId || isLoading) return;
    const response = await fetch(`/api/conversations/${conversationId}/queue/${itemId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      toast.error('Failed to start queued prompt.');
      return;
    }
    const data: ConversationQueueRunResponse = await response.json();
    if (data.stale) {
      toast.error('Queued prompt is stale because the conversation moved on.');
      await loadQueueItems(conversationId);
      return;
    }

    const success = await sendMessage(data.item.prompt_text);
    await fetch(`/api/conversations/${conversationId}/queue/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: success ? 'completed' : 'failed',
        error: success ? null : { message: 'Queued prompt failed during execution.' },
        auto_run: queueAutoRun,
      }),
    });
    await loadQueueItems(conversationId);
  }, [conversationId, isLoading, loadQueueItems, queueAutoRun, sendMessage]);

  useEffect(() => {
    if (!queueAutoRun || isLoading || !conversationId) return;
    const nextItem = queueItems.find((item) => item.status === 'pending');
    if (!nextItem) return;
    void runQueuedItem(nextItem.id);
  }, [conversationId, isLoading, queueAutoRun, queueItems, runQueuedItem]);

  const latestNotebook = useMemo(
    () => linkedArtifacts.find((artifact) => artifact.kind === 'notebook') || null,
    [linkedArtifacts],
  );
  const pendingFacts = useMemo(
    () => memoryFacts.filter((fact) => fact.status === 'pending'),
    [memoryFacts],
  );
  const activeFacts = useMemo(
    () => memoryFacts.filter((fact) => fact.status === 'active'),
    [memoryFacts],
  );

  const approveFact = useCallback(async (factId: string) => {
    const response = await fetch(`/api/ai-facts/${factId}/approve`, { method: 'POST' });
    if (!response.ok) {
      toast.error('Failed to approve fact.');
      return;
    }
    toast.success('Fact approved.');
    await loadMemoryFacts();
  }, [loadMemoryFacts]);

  const dismissFact = useCallback(async (factId: string) => {
    const response = await fetch(`/api/ai-facts/${factId}/dismiss`, { method: 'POST' });
    if (!response.ok) {
      toast.error('Failed to dismiss fact.');
      return;
    }
    toast.success('Fact dismissed.');
    await loadMemoryFacts();
  }, [loadMemoryFacts]);

  useEffect(() => {
    if (!initialQuestion) {
      initialQuestionSubmissionRef.current = null;
      return;
    }

    // Wait for explicit conversation loading to finish before processing ?q=
    if (isLoadingConversation) return;

    const normalizedQuestion = initialQuestion.trim();
    if (!normalizedQuestion) return;

    // StrictMode / Suspense remounts in dev can re-run this effect before
    // state updates settle. Guard with a ref keyed to the current question.
    if (initialQuestionSubmissionRef.current === normalizedQuestion) {
      return;
    }
    initialQuestionSubmissionRef.current = normalizedQuestion;

    // Clear the ?q= param first so route transitions and remounts don't
    // resubmit the same question while the first request is in flight.
    window.history.replaceState(null, '', '/chat');

    // Start a new conversation when coming from ?q= query param.
    setConversationId(null);
    setMessages([]);

    void sendMessage(normalizedQuestion);
  }, [initialQuestion, isLoadingConversation, sendMessage]);

  // Scroll the latest user message into view when a new query is sent
  useEffect(() => {
    if (messages.length > 0 && isLoading) {
      latestUserMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [messages.length, isLoading]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    suggestionsAbortRef.current?.abort();
  }, []);

  const handleCanvasResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsResizingCanvas(true);
    resizeStateRef.current = {
      startX: e.clientX,
      startWidth: canvasWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      const delta = resizeState.startX - moveEvent.clientX;
      const nextWidth = Math.min(
        maxCanvasWidthForViewport,
        Math.max(MIN_CANVAS_WIDTH, resizeState.startWidth + delta),
      );
      setCanvasWidth(nextWidth);
    };

    const onMouseUp = () => {
      setIsResizingCanvas(false);
      resizeStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [canvasWidth, maxCanvasWidthForViewport]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput('');
  };

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
    blurTimeoutRef.current = setTimeout(() => {
      setIsFocused(false);
    }, 200);
  }, []);

  const handleSuggestionSelect = useCallback((suggestion: ChatSuggestion) => {
    const question = suggestion.text.trim();
    if (!question || isLoading) return;
    setInput('');
    setIsFocused(false);
    setKeyboardSuggestionActive(false);
    void sendMessage(question);
  }, [isLoading, sendMessage]);

  const visibleSuggestions = useMemo(
    () => suggestions.slice(0, MAX_VISIBLE_CHAT_SUGGESTIONS),
    [suggestions],
  );

  useEffect(() => {
    if (visibleSuggestions.length === 0) {
      if (selectedSuggestionIndex !== 0) setSelectedSuggestionIndex(0);
      return;
    }
    if (selectedSuggestionIndex >= visibleSuggestions.length) {
      setSelectedSuggestionIndex(0);
    }
  }, [selectedSuggestionIndex, visibleSuggestions]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const canUseSuggestions =
      isFocused &&
      visibleSuggestions.length > 0 &&
      input.trim().length > 0 &&
      !isLoading &&
      !isListening &&
      !isProcessingVoice;

    if (canUseSuggestions && e.key === 'ArrowDown') {
      e.preventDefault();
      setKeyboardSuggestionActive(true);
      setSelectedSuggestionIndex((prev) => (prev + 1) % visibleSuggestions.length);
      return;
    }

    if (canUseSuggestions && e.key === 'ArrowUp') {
      e.preventDefault();
      setKeyboardSuggestionActive(true);
      setSelectedSuggestionIndex((prev) => (prev - 1 + visibleSuggestions.length) % visibleSuggestions.length);
      return;
    }

    if (canUseSuggestions && e.key === 'Tab' && visibleSuggestions[selectedSuggestionIndex]) {
      e.preventDefault();
      handleSuggestionSelect(visibleSuggestions[selectedSuggestionIndex]);
      return;
    }

    if (
      canUseSuggestions &&
      e.key === 'Enter' &&
      !e.shiftKey &&
      keyboardSuggestionActive &&
      visibleSuggestions[selectedSuggestionIndex]
    ) {
      e.preventDefault();
      handleSuggestionSelect(visibleSuggestions[selectedSuggestionIndex]);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const showSuggestions =
    isFocused &&
    input.trim().length > 0 &&
    visibleSuggestions.length > 0 &&
    !isLoading &&
    !isListening &&
    !isProcessingVoice;

  const suggestionList = (
    <ChatSuggestionList
      show={showSuggestions}
      suggestions={visibleSuggestions}
      selectedIndex={selectedSuggestionIndex}
      onSelect={handleSuggestionSelect}
      onHoverIndex={(index) => {
        setSelectedSuggestionIndex(index);
        setKeyboardSuggestionActive(true);
      }}
    />
  );

  const chatLayout = createChatClientLayout({
    activeFacts,
    appendToLatestNotebook,
    approveFact,
    audioStream,
    canvasData,
    conversationContextMenu,
    conversationId,
    conversations,
    currentQuestion,
    deleteConversation,
    dismissConnectAppsBar,
    dismissFact,
    effectiveCanvasWidth,
    greeting,
    handleCanvasResizeStart,
    handleConversationContextDelete,
    handleInputBlur,
    handleInputFocus,
    handleKeyDown,
    handleSubmit,
    handleViewChange,
    headerCenterSlot,
    headerLeftSlot,
    input,
    isListening,
    isLoading,
    isLoadingConversations,
    isMemoryOpen,
    isProcessingVoice,
    isQueueOpen,
    isResizingCanvas,
    isSidebarCollapsed,
    latestNotebook,
    latestUserMessageRef,
    linkedArtifacts,
    loadQueueItems,
    messages,
    openIntegrationsPage,
    partialTranscript,
    pendingFacts,
    queueAutoRun,
    queueItems,
    queuePrompt,
    router,
    runQueuedItem,
    saveConversationArtifact,
    scrollRef,
    sendMessage,
    setCanvasData,
    setInput,
    setIsMemoryOpen,
    setIsQueueOpen,
    setIsSidebarCollapsed,
    setKeyboardSuggestionActive,
    setQueueAutoRun,
    setSelectedSuggestionIndex,
    showConnectAppsBar,
    showConversationContextMenu,
    startNewConversation,
    startVoiceRecognition,
    streamingContent,
    suggestionList,
    switchConversation,
    textareaRef,
    toolStatus,
    voiceStyleEnabled,
  });

  if (isLoadingConversation) {
    return chatLayout.renderLoadingConversation();
  }

  if (messages.length === 0 && isLoading && currentQuestion.trim()) {
    return chatLayout.renderPendingFirstMessage();
  }

  if (messages.length === 0 && !isLoading) {
    return chatLayout.renderEmptyChat();
  }

  return chatLayout.renderActiveChat();
}
