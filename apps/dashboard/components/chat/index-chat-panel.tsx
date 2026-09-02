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
const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 720;
const RESIZE_GUTTER_PX = 12;

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

function persistWidth(width: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // ignore storage failures
  }
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
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 128)}px`;
  }, [input, open]);

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
    document.documentElement.style.setProperty(
      '--ritual-right-dock-width',
      `${panelWidth + RESIZE_GUTTER_PX}px`,
    );
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
    <div
      className="flex h-full min-h-0"
      onClick={(event) => event.stopPropagation()}
      style={{ width: panelWidth + RESIZE_GUTTER_PX }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={MAX_PANEL_WIDTH}
        aria-valuenow={panelWidth}
        title="Drag to resize"
        data-tauri-drag-region="false"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          const handle = event.currentTarget;
          handle.setPointerCapture(event.pointerId);
          setIsResizing(true);
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
          const onMove = (moveEvent: PointerEvent) => {
            setPanelWidth(clampWidth(window.innerWidth - moveEvent.clientX));
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            setIsResizing(false);
            setPanelWidth((current) => {
              persistWidth(current);
              return current;
            });
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
          window.addEventListener('pointercancel', onUp);
        }}
        className="group relative z-30 no-drag shrink-0 cursor-col-resize self-stretch touch-none"
        style={{ width: RESIZE_GUTTER_PX }}
      >
        <div
          className={cn(
            'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--border-subtle)]',
            'group-hover:w-[2px] group-hover:bg-[var(--text-muted)]',
            isResizing && 'w-[2px] bg-[var(--text-primary)]',
          )}
        />
      </div>

      <aside
        role="complementary"
        aria-label={`${title} chat`}
        className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--surface-content)]"
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3">
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

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {showEmpty ? (
            <div className="flex h-full min-h-[120px] items-center justify-center">
              <p className="text-center text-[13px] leading-5 text-[var(--text-muted)]">
                {habitId ? `Ask about ${title}.` : 'Ask anything.'}
              </p>
            </div>
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
          className="shrink-0 px-3 pb-3 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="ritual-floating-surface px-3 pb-2.5 pt-2.5">
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
              rows={1}
              disabled={isLoading}
              aria-label={`Ask about ${title}`}
              className="max-h-32 min-h-[24px] w-full resize-none bg-transparent text-[14px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={!hasInput || isLoading}
                aria-label="Send"
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]',
                  hasInput
                    ? 'bg-[var(--text-primary)] text-[var(--surface-raised)] hover:opacity-90'
                    : 'bg-[var(--surface-panel)] text-[var(--text-muted)]',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>,
    dockTarget,
  );
}

export default IndexChatPanel;
