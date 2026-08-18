'use client';

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { submitCurrentLocationPing } from '@/lib/location-ping';
import { privacySettingsHeaders } from '@/lib/privacy/privacy-settings';
import {
  getOverviewActivityBundle,
  hasMeaningfulOverviewActivity,
  getOverviewActivityRangeKeysForText,
  overviewActivityKeys,
  type LocalOverviewActivityBundle,
} from '@/lib/ai/overview-activity/overview-activity-query';
import {
  buildCanvasFromToolData,
  cleanContentForDisplay,
  extractCanvasData,
  getToolLabel,
} from './chat-client.shared';
import {
  CHAT_STREAM_FLUSH_INTERVAL_MS,
  getNextStreamingFlushDelay,
  shouldFlushStreamingContent,
} from './chat-stream-buffer';
import type { Message } from './chat-client.shared';
import type { HabitCanvasData } from '@/components/chat/habit-canvas';
import { perfInfo } from '@/lib/perf-debug';
import { parsePhaseLine, labelForChatPhase } from './chat-stream-protocol';
import { canonicalEntityType, parseEntityMentionTokens } from '@ritual/shared-contracts';
import { syncEntityMentions } from '@/lib/entities/sync-mentions';

const HABIT_LOG_LOCATION_PREFLIGHT_PATTERN =
  /\b(log|logged|logging|track|tracked|record|recorded|completed|finished|walked|ran|meditated|workout|worked out|read|drank|consumed|slept)\b/i;

function shouldPreflightLocationForChat(text: string): boolean {
  return HABIT_LOG_LOCATION_PREFLIGHT_PATTERN.test(text);
}

function entityRefsFromReceipts(receipts: Message['actionReceipts']): Message['entityRefs'] {
  if (!receipts?.length) return undefined;
  const refs: NonNullable<Message['entityRefs']> = [];
  const seen = new Set<string>();
  for (const receipt of receipts) {
    if (receipt.habit_id && !seen.has(`habit:${receipt.habit_id}`)) {
      seen.add(`habit:${receipt.habit_id}`);
      refs.push({ type: 'habit', id: receipt.habit_id, title: receipt.habit_name || undefined });
    }
    if (receipt.log_id && !seen.has(`habit_log:${receipt.log_id}`)) {
      seen.add(`habit_log:${receipt.log_id}`);
      refs.push({ type: 'habit_log', id: receipt.log_id, title: receipt.habit_name || undefined });
    }
  }
  return refs.length ? refs : undefined;
}

export function useChatSendMessage({
  getToken,
  queryClient,
  userId,
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
}: {
  getToken: () => Promise<string | null>;
  queryClient: ReturnType<typeof useQueryClient>;
  userId?: string | null;
  timezone: string;
  isDesktop: boolean;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
  setStreamingContent: (value: string) => void;
  setCurrentQuestion: (value: string) => void;
  setToolStatus: Dispatch<SetStateAction<{ label: string; done: boolean } | null>>;
  setCanvasData: (value: HabitCanvasData | null) => void;
  loadConversationsList: () => Promise<void>;
  loadMemoryFacts: () => Promise<void>;
  voiceStyleEnabled: boolean;
}) {
  const sendMessage = useCallback(async (text: string, options?: { entityRefs?: Message['entityRefs'] }): Promise<boolean> => {
    if (isLoading || !text.trim()) return false;
    
    setIsLoading(true);
    setStreamingContent('');
    setCurrentQuestion(text);
    setToolStatus({ label: getToolLabel(text), done: false });
    const clickAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    perfInfo('chat', 'send_click');
    const tokenPromise = getToken();
    
    const tokenRefs = parseEntityMentionTokens(text).map((ref) => ({ type: ref.type, id: ref.id }));
    const attachedRefs = [...tokenRefs, ...(options?.entityRefs || [])].filter((ref) => {
      const type = canonicalEntityType(ref?.type);
      return Boolean(type && ref?.id);
    }).filter((ref, index, items) => {
      const type = canonicalEntityType(ref.type) || ref.type;
      return items.findIndex((item) => (canonicalEntityType(item.type) || item.type) === type && item.id === ref.id) === index;
    });
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      entityRefs: attachedRefs.length ? attachedRefs : undefined,
    };
    
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    
    const overviewRangeKeys = [...new Set(getOverviewActivityRangeKeysForText(text))];
    let localOverviewActivity: LocalOverviewActivityBundle[] | null = null;

    if (isDesktop && userId && overviewRangeKeys.length > 0) {
      const cachedBundles: LocalOverviewActivityBundle[] = [];

      for (const rangeKey of overviewRangeKeys) {
        const queryKey = overviewActivityKeys.detail(userId, timezone, rangeKey);
        const cached = queryClient.getQueryData<LocalOverviewActivityBundle | null>(queryKey);

        if (hasMeaningfulOverviewActivity(cached)) {
          cachedBundles.push(cached);
          continue;
        }

        void queryClient.fetchQuery({
          queryKey,
          queryFn: () => getOverviewActivityBundle(rangeKey, timezone),
          staleTime: 1000 * 60 * 5,
        }).catch((error) => {
          console.warn('Failed to prefetch overview activity bundle for chat request', {
            rangeKey,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      localOverviewActivity = cachedBundles.length > 0 ? cachedBundles : null;
    }
    
    let cancelStreamingFlushTimer: (() => void) | null = null;

    try {
      const token = await tokenPromise;
      if (shouldPreflightLocationForChat(text)) {
        void submitCurrentLocationPing({
          authToken: token,
          reason: 'chat_stream_preflight',
        });
      }

      perfInfo('chat', 'request_start', {
        duration_ms: Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - clickAt).toFixed(2)),
      });
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json',
          ...privacySettingsHeaders(),
        },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          timezone,
          conversationId: conversationId, // Include conversation ID for persistence
          responseMode: voiceStyleEnabled ? 'voice' : 'text', // Phase 4A: Voice style mode
          localOverviewActivity,
          entityRefs: attachedRefs.length ? attachedRefs : undefined,
        }),
      });
      
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const durationFromClick = () => Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - clickAt).toFixed(2));
      let sawFirstByte = false;
      let sawFirstPhase = false;
      let sawFirstText = false;
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let resolvedConversationId = conversationId;
      let toolData: {
        stats?: any;
        dailyBreakdown?: any;
        dailyBreakdownHabit?: any;
        correlation?: any;
        trends?: any;
        anomalies?: any;
        screenTimeSpent?: any;
        weeklyOverview?: any;
        dailyOverview?: any;
        monthlyOverview?: any;
        suggested_followups?: string[];
        reply_chips?: string[];
        actionReceipts?: Message['actionReceipts'];
        entityRefs?: Message['entityRefs'];
      } | null = null;
      let streamBuffer = '';
      let toolMarkedDone = false;
      let pendingStreamingContent = '';
      let lastStreamingFlushAt = 0;
      let streamingFlushTimer: ReturnType<typeof setTimeout> | null = null;

      const clearStreamingFlushTimer = () => {
        if (streamingFlushTimer) {
          clearTimeout(streamingFlushTimer);
          streamingFlushTimer = null;
        }
      };
      cancelStreamingFlushTimer = clearStreamingFlushTimer;

      const flushStreamingContent = (force = false) => {
        const now = Date.now();
        if (shouldFlushStreamingContent({ force, lastFlushAt: lastStreamingFlushAt, now })) {
          clearStreamingFlushTimer();
          lastStreamingFlushAt = now;
          setStreamingContent(pendingStreamingContent);
          return;
        }

        if (!streamingFlushTimer) {
          streamingFlushTimer = setTimeout(
            () => flushStreamingContent(true),
            getNextStreamingFlushDelay({
              lastFlushAt: lastStreamingFlushAt,
              now,
              intervalMs: CHAT_STREAM_FLUSH_INTERVAL_MS,
            }),
          );
        }
      };

      const appendStreamingDelta = (delta: string) => {
        fullResponse += delta;
        pendingStreamingContent = fullResponse;
        flushStreamingContent(false);
      };

      const processStreamLine = (rawLine: string) => {
        const line = rawLine.replace(/\r$/, '');
        if (!line.trim()) return;

        // Check for conversation ID (sent first by server)
        if (line.includes('__CONVERSATION_ID__')) {
          const match = line.match(/__CONVERSATION_ID__(.+?)__END_CONVERSATION_ID__/);
          if (match) {
            const newConversationId = match[1];
            console.log('💬 Received conversation ID:', newConversationId);
            resolvedConversationId = newConversationId;
            setConversationId(newConversationId);
            // Refresh conversations list to include the new conversation
            loadConversationsList();
          }
          return;
        }

        if (line === '__STREAM_OPEN__') {
          return;
        }

        const phaseEvent = parsePhaseLine(line);
        if (phaseEvent) {
          if (!sawFirstPhase) {
            sawFirstPhase = true;
            perfInfo('chat', 'first_phase', { duration_ms: durationFromClick(), phase: phaseEvent.phase });
          }
          if (phaseEvent.phase === 'answering') {
            setToolStatus((prev) => prev ? { ...prev, done: true } : { label: labelForChatPhase(phaseEvent.phase, phaseEvent.label), done: true });
          } else {
            setToolStatus({
              label: labelForChatPhase(phaseEvent.phase, phaseEvent.label),
              done: false,
            });
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
          if (!sawFirstText) {
            sawFirstText = true;
            perfInfo('chat', 'first_text', { duration_ms: durationFromClick() });
          }
          if (!toolMarkedDone) {
            toolMarkedDone = true;
            setToolStatus((prev) => prev ? { ...prev, done: true } : null);
          }
          try {
            const data = JSON.parse(line.substring(2).trim());
            if (typeof data === 'string') {
              appendStreamingDelta(data);
            }
          } catch {
            const lineText = line.substring(2).trim();
            if (lineText && !lineText.startsWith('{')) {
              appendStreamingDelta(lineText);
            }
          }
        } else if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.substring(5).trim());
            if (data.type === 'text-delta' && data.delta) {
              appendStreamingDelta(data.delta);
            }
          } catch {}
        }
      };
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!sawFirstByte) {
          sawFirstByte = true;
          perfInfo('chat', 'first_byte', { duration_ms: durationFromClick() });
        }

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

      flushStreamingContent(true);
      perfInfo('chat', 'stream_complete', { duration_ms: durationFromClick() });
      
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

      const actionReceipts = Array.isArray((toolData as any)?.actionReceipts)
        ? ((toolData as any).actionReceipts as Message['actionReceipts'])
        : undefined;
      const entityRefs = Array.isArray((toolData as any)?.entityRefs)
        ? ((toolData as any).entityRefs as Message['entityRefs'])
        : entityRefsFromReceipts(actionReceipts);

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: displayContent || 'I was unable to process your request.',
        canvasData: extractedCanvas,
        replyChips: replyChips,  // Phase 4A
        actionReceipts,
        entityRefs,
      };
      
      setMessages([...newMessages, assistantMessage]);
      clearStreamingFlushTimer();
      setStreamingContent('');
      void loadMemoryFacts();
      if (resolvedConversationId) {
        void syncEntityMentions({
          source: { type: 'conversation', id: resolvedConversationId },
          text,
          extraTargets: attachedRefs,
          provenance: 'user',
          getToken,
          userId,
        });
        if (entityRefs?.length) {
          void syncEntityMentions({
            source: { type: 'conversation', id: resolvedConversationId },
            extraTargets: entityRefs,
            provenance: 'assistant',
            getToken,
            userId,
          });
        }
      }
      return true;
    } catch (error) {
      console.error('Chat error:', error);
      cancelStreamingFlushTimer?.();
      setStreamingContent('');
      setMessages([...newMessages, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, there was an error processing your request. Please try again.',
      }]);
      return false;
    } finally {
      setIsLoading(false);
      cancelStreamingFlushTimer?.();
      setCurrentQuestion('');
      setToolStatus(null);
    }
  }, [messages, isLoading, getToken, conversationId, loadConversationsList, loadMemoryFacts, voiceStyleEnabled, queryClient, timezone, userId, isDesktop]);

  return sendMessage;
}
