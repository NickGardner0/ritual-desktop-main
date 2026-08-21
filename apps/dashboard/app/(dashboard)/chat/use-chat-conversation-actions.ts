'use client';

import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiOperationWithAuth } from '@/lib/api/client';
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
  ArtifactDetail,
  ArtifactKind,
  ConversationQueueItem,
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
      setIsLoadingConversations(true);
      const data = await apiOperationWithAuth(
        'list_conversations_api_conversations_get',
        getToken,
        { query: { limit: 10 } },
      ) as { conversations?: ConversationListItem[] };
      if (data.conversations) {
        setConversations(data.conversations);
      }
    } catch (error) {
      console.error('Failed to load conversations list:', error);
    } finally {
      setIsLoadingConversations(false);
    }
  }, [getToken]);

  const loadQueueItems = useCallback(async (targetConversationId: string) => {
    try {
      const data = await apiOperationWithAuth(
        'get_conversation_queue_api_conversations__conversation_id__queue_get',
        getToken,
        { pathParams: { conversation_id: targetConversationId } },
      );
      setQueueItems((data.items || []) as ConversationQueueItem[]);
      setQueueAutoRun(Boolean(data.auto_run_queued));
    } catch (error) {
      console.error('Failed to load queue items:', error);
    }
  }, [getToken]);

  const loadLinkedArtifacts = useCallback(async (targetConversationId: string) => {
    try {
      const data = await apiOperationWithAuth(
        'get_artifacts_api_artifacts_get',
        getToken,
        { query: { linked_to: targetConversationId, limit: 12 } },
      );
      const artifactIds = (data.items || []).map((item) => item.id).slice(0, 6);
      if (artifactIds.length === 0) {
        setLinkedArtifacts([]);
        return;
      }
      const details = await Promise.all(
        artifactIds.map(async (artifactId) => {
          try {
            return await apiOperationWithAuth(
              'get_artifact_api_artifacts__artifact_id__get',
              getToken,
              { pathParams: { artifact_id: artifactId } },
            ) as ArtifactDetail;
          } catch {
            return null;
          }
        }),
      );
      setLinkedArtifacts(details.filter(Boolean) as ArtifactDetail[]);
    } catch (error) {
      console.error('Failed to load linked artifacts:', error);
    }
  }, [getToken]);

  const loadMemoryFacts = useCallback(async () => {
    try {
      const data = await apiOperationWithAuth(
        'get_facts_api_ai_facts_get',
        getToken,
      );
      setMemoryFacts((data.items || []) as AiFact[]);
    } catch (error) {
      console.error('Failed to load AI facts:', error);
    }
  }, [getToken]);

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

      const conversation = await apiOperationWithAuth(
        'get_conversation_api_conversations__conversation_id__get',
        getToken,
        { pathParams: { conversation_id: targetConversationId } },
      ) as PersistedConversation;

      if (conversation && conversation.messages && conversation.messages.length > 0) {
          const loadedMessages: Message[] = conversation.messages.map((m) => {
            let messageCanvasData: HabitCanvasData | undefined;
            let actionReceipts: Message['actionReceipts'];
            let entityRefs: Message['entityRefs'];
            if (m.tool_payload && m.role === 'assistant') {
              const toolData = m.tool_payload as {
                stats?: unknown;
                dailyBreakdown?: unknown;
                dailyBreakdownHabit?: unknown;
                correlation?: unknown;
                screenTimeSpent?: unknown;
                weeklyOverview?: unknown;
                dailyOverview?: unknown;
                monthlyOverview?: unknown;
                actionReceipts?: Message['actionReceipts'];
                entityRefs?: Message['entityRefs'];
              };
              const messageIndex = conversation.messages.findIndex(msg => msg.id === m.id);
              const previousUserMessage = messageIndex > 0 ? conversation.messages[messageIndex - 1] : null;
              const question = previousUserMessage?.role === 'user' ? previousUserMessage.content : '';
              messageCanvasData = buildCanvasFromToolData(toolData, question);
              if (Array.isArray(toolData.actionReceipts)) {
                actionReceipts = toolData.actionReceipts;
              }
              if (Array.isArray(toolData.entityRefs)) {
                entityRefs = toolData.entityRefs;
              }
            }
            
            return {
              id: m.id,
              role: m.role,
              content: m.content,
              canvasData: messageCanvasData,
              actionReceipts,
              entityRefs,
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
      
      await apiOperationWithAuth(
        'delete_conversation_api_conversations__conversation_id__delete',
        getToken,
        { pathParams: { conversation_id: targetConversationId } },
      );
      setConversationContextMenu((current) => (
        current?.conversationId === targetConversationId ? null : current
      ));
      setConversations(prev => prev.filter(c => c.id !== targetConversationId));
      if (targetConversationId === conversationId) {
        startNewConversation();
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

    try {
      await apiOperationWithAuth(
        'create_conversation_artifact_api_conversations__conversation_id__artifacts_post',
        getToken,
        {
          pathParams: { conversation_id: conversationId },
          body: payload,
        },
      );
    } catch {
      toast.error('Failed to save artifact.');
      return;
    }

    toast.success(kind === 'plan' ? 'Plan saved.' : 'Notebook saved.');
    void loadLinkedArtifacts(conversationId);
  }, [conversationId, getToken, loadLinkedArtifacts]);

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

    try {
      await apiOperationWithAuth(
        'create_artifact_revision_api_artifacts__artifact_id__revisions_post',
        getToken,
        {
          pathParams: { artifact_id: latestNotebook.id },
          body: {
            base_version: latestNotebook.revision_count,
            editor_type: 'user',
            summary: latestNotebook.summary || message.content.slice(0, 160),
            change_note: 'Appended from chat response',
            body: {
              schemaVersion: 1,
              blocks: nextBlocks,
            },
          },
        },
      );
    } catch {
      toast.error('Failed to append to notebook.');
      return;
    }

    toast.success('Appended to notebook.');
    void loadLinkedArtifacts(conversationId!);
  }, [conversationId, getToken, linkedArtifacts, loadLinkedArtifacts, saveConversationArtifact]);

  const queuePrompt = useCallback(async (promptText: string, source: ConversationQueueItem['source'] = 'manual') => {
    if (!conversationId) {
      toast.error('Queueing starts after the conversation is created.');
      return;
    }
    const anchorId = getPersistedAfterMessageId(messages[messages.length - 1]?.id);
    try {
      await apiOperationWithAuth(
        'create_conversation_queue_item_api_conversations__conversation_id__queue_post',
        getToken,
        {
          pathParams: { conversation_id: conversationId },
          body: {
            prompt_text: promptText,
            source,
            auto_run: queueAutoRun,
            after_message_id: anchorId,
          },
        },
      );
    } catch {
      toast.error('Failed to queue prompt.');
      return;
    }
    setInput('');
    toast.success('Queued for later.');
    await loadQueueItems(conversationId);
  }, [conversationId, getToken, loadQueueItems, messages, queueAutoRun]);

  const cancelQueuedItem = useCallback(async (itemId: string) => {
    if (!conversationId) return;
    try {
      await apiOperationWithAuth(
        'cancel_conversation_queue_item_api_conversations__conversation_id__queue__item_id__cancel_post',
        getToken,
        {
          pathParams: { conversation_id: conversationId, item_id: itemId },
          body: {},
        },
      );
    } catch {
      toast.error('Failed to cancel queued prompt.');
    }
    await loadQueueItems(conversationId);
  }, [conversationId, getToken, loadQueueItems]);

  const approveFact = useCallback(async (factId: string) => {
    try {
      await apiOperationWithAuth(
        'approve_fact_api_ai_facts__fact_id__approve_post',
        getToken,
        { pathParams: { fact_id: factId } },
      );
    } catch {
      toast.error('Failed to approve fact.');
      return;
    }
    toast.success('Fact approved.');
    await loadMemoryFacts();
  }, [getToken, loadMemoryFacts]);

  const dismissFact = useCallback(async (factId: string) => {
    try {
      await apiOperationWithAuth(
        'dismiss_fact_api_ai_facts__fact_id__dismiss_post',
        getToken,
        { pathParams: { fact_id: factId } },
      );
    } catch {
      toast.error('Failed to dismiss fact.');
      return;
    }
    toast.success('Fact dismissed.');
    await loadMemoryFacts();
  }, [getToken, loadMemoryFacts]);

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
    cancelQueuedItem,
    approveFact,
    dismissFact,
  };
}
