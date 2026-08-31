'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, PanelRightClose } from 'lucide-react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@ritual/ui/button';
import { cn } from '@ritual/ui/cn';
import { useRegisterRightDockClose, useRightDockTarget } from '@/contexts/RightDockContext';
import { useAI } from '@/contexts/AIContext';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import type { HabitCanvasData } from '@/components/chat/habit-canvas';
import { ChatPermissionDock } from '@/app/(dashboard)/chat/chat-permission-dock';
import {
  Response,
  TextShimmer,
  type Message,
} from '@/app/(dashboard)/chat/chat-client.shared';
import { useChatSendMessage } from '@/app/(dashboard)/chat/use-chat-send-message';

const STORAGE_KEY = 'ritual:index-chat-panel-width';
const DEFAULT_PANEL_WIDTH = 400;
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 720;

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_PANEL_WIDTH;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(parsed)) return DEFAULT_PANEL_WIDTH;
    return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, parsed));
  } catch {
    return DEFAULT_PANEL_WIDTH;
  }
}

function clampWidth(next: number): number {
  const maxForViewport = Math.min(
    MAX_PANEL_WIDTH,
    Math.max(MIN_PANEL_WIDTH, Math.floor(window.innerWidth * 0.52)),
  );
  return Math.min(maxForViewport, Math.max(MIN_PANEL_WIDTH, next));
}

export function IndexChatPanel({
  open,
  title,
  habitId,
  onClose,
}: {
  open: boolean;
  title: string;
  habitId: string | null;
  onClose: () => void;
}) {
  const { takePendingIndexChatTexts, takeIndexChatShouldFocus, indexChatEpoch } = useAI();
  const dockTarget = useRightDockTarget();
  const { isDesktop } = useDesktopCapabilities();
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [panelWidth, setPanelWidth] = useState(readStoredWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [, setCurrentQuestion] = useState('');
  const [toolStatus, setToolStatus] = useState<{ label: string; done: boolean } | null>(null);
  const [, setCanvasData] = useState<HabitCanvasData | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const outboundRef = useRef<string[]>([]);
  const activeHabitIdRef = useRef(habitId);
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );

  const noopAsync = useCallback(async () => {}, []);

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
    loadConversationsList: noopAsync,
    loadMemoryFacts: noopAsync,
    voiceStyleEnabled: false,
  });

  useRegisterRightDockClose(open, onClose);

  useEffect(() => {
    if (activeHabitIdRef.current === habitId) return;
    activeHabitIdRef.current = habitId;
    outboundRef.current = [];
    setMessages([]);
    setConversationId(null);
    setStreamingContent('');
    setInput('');
    setIsLoading(false);
    setToolStatus(null);
    setCurrentQuestion('');
    setCanvasData(null);
  }, [habitId]);

  useEffect(() => {
    if (!open) {
      outboundRef.current = [];
      return;
    }
    const incoming = takePendingIndexChatTexts();
    if (incoming.length > 0) {
      outboundRef.current.push(...incoming);
    }
  }, [open, indexChatEpoch, takePendingIndexChatTexts]);

  useEffect(() => {
    if (!open || isLoading) return;
    const next = outboundRef.current[0];
    if (!next) return;
    outboundRef.current = outboundRef.current.slice(1);
    void sendMessage(next, {
      entityRefs: habitId ? [{ type: 'habit', id: habitId, title }] : undefined,
    });
  }, [open, isLoading, sendMessage, habitId, title]);

  useEffect(() => {
    if (!open) return;
    if (!takeIndexChatShouldFocus()) return;
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, habitId, indexChatEpoch, takeIndexChatShouldFocus]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setPanelWidth((current) => clampWidth(current));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (event: MouseEvent) => {
      setPanelWidth(clampWidth(window.innerWidth - event.clientX));
    };
    const onUp = () => {
      setIsResizing(false);
      setPanelWidth((current) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, String(current));
        } catch {
          // ignore storage failures
        }
        return current;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, streamingContent, isLoading]);

  useEffect(() => {
    if (!open) {
      document.documentElement.style.removeProperty('--ritual-right-dock-width');
      return;
    }
    document.documentElement.style.setProperty('--ritual-right-dock-width', `${panelWidth}px`);
    return () => {
      document.documentElement.style.removeProperty('--ritual-right-dock-width');
    };
  }, [open, panelWidth]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    void sendMessage(text, {
      entityRefs: habitId ? [{ type: 'habit', id: habitId, title }] : undefined,
    });
  }, [habitId, input, isLoading, sendMessage, title]);

  if (!open || !dockTarget) return null;

  const hasInput = input.trim().length > 0;
  const showEmpty = messages.length === 0 && !streamingContent && !isLoading;

  return createPortal(
    <aside
      role="complementary"
      aria-label={`${title} chat`}
      onClick={(event) => event.stopPropagation()}
      className="relative flex h-full shrink-0 overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--surface-content)]"
      style={{ width: panelWidth }}
    >
      <div
        onMouseDown={(event) => {
          event.preventDefault();
          setIsResizing(true);
        }}
        className="absolute left-0 top-0 z-20 h-full w-2 -translate-x-1 cursor-col-resize"
        aria-label="Resize chat panel"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={MAX_PANEL_WIDTH}
        aria-valuenow={panelWidth}
      >
        <div
          className={cn(
            'mx-auto h-full w-px',
            isResizing ? 'bg-[var(--border-floating)]' : 'bg-transparent hover:bg-[var(--border-floating)]',
          )}
        />
      </div>

      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
          <div className="min-w-0 truncate text-[13px] font-medium leading-none text-[var(--text-primary)]">
            {title}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-compact"
            aria-label="Close chat"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {showEmpty ? (
            <p className="pt-6 text-[13px] leading-5 text-[var(--text-muted)]">
              {habitId ? `Ask about ${title}.` : 'Ask anything.'}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((message) =>
                message.role === 'user' ? (
                  <div
                    key={message.id}
                    className="max-w-[92%] self-start rounded-[12px] bg-[var(--surface-panel)] px-3 py-2 text-[13px] leading-5 text-[var(--text-primary)]"
                  >
                    {message.content}
                  </div>
                ) : (
                  <div key={message.id} className="text-[13px] leading-[1.55] text-[var(--text-primary)]">
                    <Response className="text-[13px] leading-[1.55] text-[var(--text-primary)]">
                      {message.content}
                    </Response>
                    {message.durability ? (
                      <div className="mt-2 text-[12px] text-[var(--text-muted)]">
                        {message.durability.state === 'queued_local'
                          ? 'Queued locally until the server accepts it.'
                          : 'This reply was not saved.'}
                      </div>
                    ) : null}
                  </div>
                ),
              )}
              {streamingContent ? (
                <div className="text-[13px] leading-[1.55] text-[var(--text-primary)]">
                  <Response className="text-[13px] leading-[1.55] text-[var(--text-primary)]">
                    {streamingContent}
                  </Response>
                  <ChatPermissionDock />
                </div>
              ) : null}
              {isLoading && !streamingContent ? (
                <div className="flex flex-col gap-2 py-1">
                  <TextShimmer className="text-[13px]" duration={1.2}>
                    {toolStatus?.label || 'Thinking...'}
                  </TextShimmer>
                  <ChatPermissionDock />
                </div>
              ) : null}
            </div>
          )}
        </div>

        <form
          className="shrink-0 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="rounded-[var(--radius-floating)] border border-[var(--border-floating)] bg-[var(--surface-raised)] px-3 pb-2.5 pt-2.5">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="Ask anything..."
              rows={2}
              disabled={isLoading}
              aria-label={`Ask about ${title}`}
              className="max-h-32 min-h-[44px] w-full resize-none bg-transparent text-[14px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            <div className="mt-1 flex justify-end">
              <button
                type="submit"
                disabled={!hasInput || isLoading}
                aria-label="Send"
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]',
                  hasInput
                    ? 'bg-[var(--text-primary)] text-[var(--surface-raised)] hover:opacity-90'
                    : 'bg-[var(--surface-panel)] text-[var(--text-muted)]',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </aside>,
    dockTarget,
  );
}

export default IndexChatPanel;
