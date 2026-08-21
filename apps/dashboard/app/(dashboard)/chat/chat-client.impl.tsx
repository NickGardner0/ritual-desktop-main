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
import { submitCurrentLocationPing } from '@/lib/location-ping';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
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
import { useChatConversationActions } from './use-chat-conversation-actions';
import { useChatSendMessage } from './use-chat-send-message';
import { useChatVoiceInput } from './use-chat-voice-input';
import { useAssistantTurnOutboxDrain } from './use-assistant-turn-outbox';

export function ChatClient() {
  const { isDesktop } = useDesktopCapabilities();
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuestion = searchParams.get('q');
  const initialConversationId = searchParams.get('conversation');
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { habits, habitLogs } = useHabits();
  useAssistantTurnOutboxDrain(user?.id, getToken);

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
  const [attachedEntityRefs, setAttachedEntityRefs] = useState<Message['entityRefs']>([]);
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

  const {
    loadConversationsList,
    loadQueueItems,
    loadLinkedArtifacts,
    loadMemoryFacts,
    switchConversation,
    startNewConversation,
    deleteConversation,
    showConversationContextMenu,
    handleConversationContextDelete,
    saveConversationArtifact,
    appendToLatestNotebook,
    queuePrompt,
  } = useChatConversationActions({
    getToken,
    router,
    initialConversationId,
    initialQuestion,
    conversationId,
    setConversationId,
    messages,
    setMessages,
    setIsLoadingConversation,
    conversations,
    setConversations,
    setIsLoadingConversations,
    setConversationContextMenu,
    conversationContextMenu,
    setQueueItems,
    setQueueAutoRun,
    queueAutoRun,
    linkedArtifacts,
    setLinkedArtifacts,
    setMemoryFacts,
    setInput,
    setCanvasData,
    setStreamingContent,
    setVoiceStyleEnabled,
    isSidebarCollapsed,
  });

  const sendMessage = useChatSendMessage({
    getToken,
    queryClient,
    userId: user?.id,
    timezone,
    isDesktop,
    conversationId,
    setConversationId,
    messages,
    setMessages,
    isLoading,
    setIsLoading,
    setStreamingContent,
    setCurrentQuestion,
    setToolStatus,
    setCanvasData,
    loadConversationsList,
    loadMemoryFacts,
    voiceStyleEnabled,
  });


  const runQueuedItem = useCallback(async (itemId: string) => {
    if (!conversationId || isLoading) return;
    const response = await fetch(`/api/conversations/${conversationId}/queue/${itemId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      if (response.status === 409) await loadQueueItems(conversationId);
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
    await fetch(`/api/conversations/${conversationId}/queue/${itemId}/${success ? 'complete' : 'fail'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: success ? null : { message: 'Queued prompt failed during execution.' },
      }),
    });
    await loadQueueItems(conversationId);
  }, [conversationId, isLoading, loadQueueItems, sendMessage]);

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
    sendMessage(input.trim(), { entityRefs: attachedEntityRefs });
    setInput('');
    setAttachedEntityRefs([]);
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
    attachedEntityRefs,
    setAttachedEntityRefs,
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
