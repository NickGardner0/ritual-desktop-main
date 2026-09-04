'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@ritual/ui/button';
import { AgentTranscript } from '@/components/chat/agent-transcript';
import { useAgentSendMessage } from '@/components/chat/use-agent-send-message';
import { ChatPermissionDock } from '@/app/(dashboard)/chat/chat-permission-dock';
import type { Message } from '@/components/chat/chat-message';
import type { HabitCanvasData } from '@/components/chat/habit-canvas';

export function AgentChat() {
  const { getToken } = useAuth();
  const [sessionId] = useState(() => `sess_${crypto.randomUUID()}`);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [, setCurrentQuestion] = useState('');
  const [, setToolStatus] = useState<{ label: string; done: boolean } | null>(null);
  const [, setCanvasData] = useState<HabitCanvasData | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );

  const { sendMessage, items } = useAgentSendMessage({
    getToken,
    timezone,
    sessionId,
    messages,
    setMessages,
    isLoading,
    setIsLoading,
    setStreamingContent,
    setCurrentQuestion,
    setToolStatus,
    setCanvasData,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items, streamingContent]);

  return (
    <div className="flex h-full flex-col bg-[var(--ritual-surface-canvas)]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl">
          <AgentTranscript
            items={items}
            streamingText={streamingContent}
            isStreaming={isLoading}
          />
          <ChatPermissionDock />
        </div>
      </div>

      <div className="border-t border-[var(--ritual-border-default)] bg-[var(--ritual-surface-raised)] px-4 py-3">
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                const text = input.trim();
                if (!text || isLoading) return;
                setInput('');
                void sendMessage(text);
              }
            }}
            placeholder="Ask Ritual anything…"
            disabled={isLoading}
            className="flex-1 rounded-lg border border-[var(--ritual-border-default)] bg-[var(--ritual-surface-raised)] px-3 py-2 text-[14px] text-[var(--ritual-text-primary)] placeholder:text-[var(--ritual-text-muted)] focus:border-[var(--ritual-focus-ring)] focus:outline-none focus:ring-1 focus:ring-[var(--ritual-focus-ring)] disabled:opacity-50"
          />
          <Button
            type="button"
            onClick={() => {
              const text = input.trim();
              if (!text || isLoading) return;
              setInput('');
              void sendMessage(text);
            }}
            disabled={isLoading || !input.trim()}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
