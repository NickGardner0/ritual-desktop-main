'use client';

import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  buildCanvasFromToolData,
  buildConversationArtifactBody,
  getPersistedAfterMessageId,
} from './chat-client.shared';
import type {
  ConversationContextMenuState,
  ConversationListItem,
  Message,
  PersistedConversation,
} from './chat-client.shared';
import type { HabitCanvasData } from '@/components/chat/habit-canvas';
import type {
  AiFact,
  AiFactListResponse,
  ArtifactDetail,
  ArtifactKind,
  ConversationQueueItem,
  ConversationQueueListResponse,
} from '@/lib/workflows/types';

export function useChatConversationActions({
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
}: {
  getToken: () => Promise<string | null>;
  router: ReturnType<typeof useRouter>;
  initialConversationId: string | null;
  initialQuestion: string | null;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoadingConversation: (value: boolean) => void;
  conversations: ConversationListItem[];
  setConversations: Dispatch<SetStateAction<ConversationListItem[]>>;
  setIsLoadingConversations: (value: boolean) => void;
  setConversationContextMenu: Dispatch<SetStateAction<ConversationContextMenuState>>;
  conversationContextMenu: ConversationContextMenuState;
  setQueueItems: Dispatch<SetStateAction<ConversationQueueItem[]>>;
  setQueueAutoRun: (value: boolean) => void;
  queueAutoRun: boolean;
  linkedArtifacts: ArtifactDetail[];
  setLinkedArtifacts: Dispatch<SetStateAction<ArtifactDetail[]>>;
  setMemoryFacts: Dispatch<SetStateAction<AiFact[]>>;
  setInput: (value: string) => void;
  setCanvasData: (value: HabitCanvasData | null) => void;
  setStreamingContent: (value: string) => void;
  setVoiceStyleEnabled: (value: boolean) => void;
  isSidebarCollapsed: boolean;
}) {
  const loadConversationsList = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      
      setIsLoadingConversations(true);
      const response = await fetch('/api/conversations?limit=10', {
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
      
      const response = await fetch(`/api/conversations/${targetConversationId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const conversation: PersistedConversation = await response.json();
        setConversationId(conversation.id);
        setVoiceStyleEnabled(conversation.response_mode === 'voice');
        setQueueAutoRun(Boolean(conversation.auto_run_queued));

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
      
      const response = await fetch(`/api/conversations/${targetConversationId}`, {
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

  return {
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
  };
}
