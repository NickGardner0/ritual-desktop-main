'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { SessionItem, SSEEvent } from '@ritual/agent';
import type { HabitCanvasData } from '@/components/chat/habit-canvas';
import {
  applySseEvent,
  postAgentApproval,
  postAgentPrompt,
  readAgentSse,
} from '@/components/chat/agent-session-client';
import type { Message } from '@/components/chat/chat-message';
import {
  resetChatSessionUi,
  setAgentApprovalHandler,
  setChatAuthToken,
  setChatPermissionAsk,
  upsertChatToolPart,
} from '@/app/(dashboard)/chat/chat-session-ui';
import { rememberAlwaysToolScope } from '@/lib/chat-permission-memory';

type SendMessageOptions = { entityRefs?: Message['entityRefs']; turnId?: string; retryExisting?: boolean };

function upsertItem(prev: SessionItem[], sessionId: string, event: SSEEvent): SessionItem[] {
  return applySseEvent(prev, sessionId, event);
}

function itemsToMessages(items: SessionItem[]): Message[] {
  const messages: Message[] = [];
  for (const item of items) {
    if (item.type === 'user') {
      messages.push({
        id: `user-${item.seq}`,
        role: 'user',
        content: item.payload.text,
      });
    } else if (item.type === 'assistant_text') {
      messages.push({
        id: `assistant-${item.seq}`,
        role: 'assistant',
        content: item.payload.text,
      });
    }
  }
  return messages;
}

export function useAgentSendMessage({
  getToken,
  timezone,
  sessionId,
  setMessages,
  setIsLoading,
  setStreamingContent,
  setCurrentQuestion,
  setToolStatus,
  setCanvasData,
}: {
  getToken: () => Promise<string | null>;
  timezone: string;
  sessionId: string;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
  setStreamingContent: (value: string) => void;
  setCurrentQuestion: (value: string) => void;
  setToolStatus: Dispatch<SetStateAction<{ label: string; done: boolean } | null>>;
  setCanvasData: (value: HabitCanvasData | null) => void;
}) {
  const [items, setItems] = useState<SessionItem[]>([]);

  const consume = useCallback(async (response: Response) => {
    let streaming = '';
    try {
      await readAgentSse(response, (event) => {
        if (event.type === 'assistant_text_delta') {
          streaming += event.payload.text;
          setStreamingContent(streaming);
          return;
        }
        if (event.type === 'done') {
          setStreamingContent('');
          setToolStatus((current) => current ? { ...current, done: true } : null);
          return;
        }
        setItems((prev) => {
          const next = upsertItem(prev, sessionId, event);
          setMessages(itemsToMessages(next));
          return next;
        });
        if (event.type === 'tool_called') {
          upsertChatToolPart({
            id: event.payload.call_id,
            name: event.payload.name,
            status: 'running',
          });
          setToolStatus({ label: event.payload.name, done: false });
        }
        if (event.type === 'tool_result') {
          upsertChatToolPart({
            id: event.payload.call_id,
            name: event.payload.name,
            status: event.payload.status === 'error' ? 'error' : 'done',
          });
          if (event.payload.canvas) {
            setCanvasData(event.payload.canvas as HabitCanvasData);
          }
        }
        if (event.type === 'approval_ask') {
          setChatPermissionAsk({
            id: String(event.seq),
            name: event.payload.name,
            scope: event.payload.name,
            profile: 'act',
            protocol: 'agent',
            sessionId,
            askSeq: event.seq,
          });
        }
        if (event.type === 'assistant_text') {
          streaming = '';
          setStreamingContent('');
        }
      });
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, setCanvasData, setIsLoading, setMessages, setStreamingContent, setToolStatus]);

  const sendMessage = useCallback(async (text: string, _options?: SendMessageOptions): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    setIsLoading(true);
    setStreamingContent('');
    setCurrentQuestion(trimmed);
    resetChatSessionUi();
    const token = await getToken();
    setChatAuthToken(token);
    const commandId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `cmd_${Date.now()}`;
    try {
      const response = await postAgentPrompt({
        token,
        sessionId,
        commandId,
        text: trimmed,
        timezone,
      });
      await consume(response);
      return true;
    } catch (error) {
      console.error(error);
      setIsLoading(false);
      return false;
    }
  }, [consume, getToken, sessionId, setCurrentQuestion, setIsLoading, setStreamingContent, timezone]);

  const submitApproval = useCallback(async (decision: 'allow' | 'deny' | 'always_allow', askSeq: number) => {
    setIsLoading(true);
    setChatPermissionAsk(null);
    const ask = items.find((item) => item.seq === askSeq && item.type === 'approval_ask');
    if (decision === 'always_allow' && ask?.type === 'approval_ask') {
      rememberAlwaysToolScope(ask.payload.name);
    }
    const token = await getToken();
    try {
      const response = await postAgentApproval({
        token,
        sessionId,
        askSeq,
        decision,
        timezone,
      });
      await consume(response);
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  }, [consume, getToken, items, sessionId, setIsLoading, timezone]);

  useEffect(() => {
    setAgentApprovalHandler(submitApproval);
    return () => setAgentApprovalHandler(null);
  }, [submitApproval]);

  return { sendMessage, submitApproval, items };
}
