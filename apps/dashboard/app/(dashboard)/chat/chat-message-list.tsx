'use client';

import React, { memo, useMemo, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check } from 'lucide-react';
import {
  Response,
  TextShimmer,
  cleanContentForDisplay,
} from './chat-client.shared';
import type { Message } from './chat-client.shared';

type ToolStatus = {
  label: string;
  done: boolean;
} | null;

type ChatMessageListProps = {
  messages: Message[];
  streamingContent: string;
  isLoading: boolean;
  toolStatus: ToolStatus;
  canvasData: unknown;
  voiceStyleEnabled: boolean;
  conversationId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  latestUserMessageRef: RefObject<HTMLDivElement | null>;
  setInput: (value: string) => void;
  sendMessage: (value: string) => void | Promise<boolean>;
  queuePrompt: (value: string, source: string) => void | Promise<unknown>;
};

type MessageRow = {
  kind: 'message';
  message: Message;
  messageIndex: number;
};

type StreamingRow = {
  kind: 'streaming';
  content: string;
};

type LoadingRow = {
  kind: 'loading';
};

type ChatRow = MessageRow | StreamingRow | LoadingRow;

const ChatMessageRow = memo(function ChatMessageRow({
  conversationId,
  isLastUserMessage,
  isLoading,
  latestUserMessageRef,
  message,
  messageIndex,
  messagesLength,
  queuePrompt,
  sendMessage,
  setInput,
  voiceStyleEnabled,
}: {
  conversationId: string | null;
  isLastUserMessage: boolean;
  isLoading: boolean;
  latestUserMessageRef: RefObject<HTMLDivElement | null>;
  message: Message;
  messageIndex: number;
  messagesLength: number;
  queuePrompt: (value: string, source: string) => void | Promise<unknown>;
  sendMessage: (value: string) => void | Promise<boolean>;
  setInput: (value: string) => void;
  voiceStyleEnabled: boolean;
}) {
  return (
    <div ref={isLastUserMessage ? latestUserMessageRef : undefined}>
      {message.role === 'user' ? (
        <h1 className="mb-6 text-2xl font-medium leading-snug text-gray-900">
          {message.content}
        </h1>
      ) : (
        <div className="mb-8">
          <Response className="text-[14px] leading-[1.55] text-[#535353]">
            {message.content}
          </Response>
          {voiceStyleEnabled &&
            message.replyChips &&
            message.replyChips.length > 0 &&
            messageIndex === messagesLength - 1 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {message.replyChips.map((chip, chipIndex) => (
                  <div key={`${chip}-${chipIndex}`} className="flex items-center overflow-hidden rounded-full bg-gray-100">
                    <button
                      onClick={() => {
                        setInput(chip);
                        void sendMessage(chip);
                      }}
                      disabled={isLoading}
                      className="px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-800 disabled:opacity-50"
                    >
                      {chip}
                    </button>
                    <button
                      onClick={() => void queuePrompt(chip, 'reply_chip')}
                      disabled={!conversationId}
                      className="border-l border-gray-200 px-2 py-1.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 disabled:opacity-40"
                    >
                      Queue
                    </button>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
});

function StreamingMessageRow({
  canvasData,
  streamingContent,
}: {
  canvasData: unknown;
  streamingContent: string;
}) {
  return (
    <div className="mb-8">
      <Response className="text-[14px] leading-[1.55] text-[#535353]">
        {canvasData ? cleanContentForDisplay(streamingContent) : streamingContent}
      </Response>
    </div>
  );
}

function LoadingMessageRow({ toolStatus }: { toolStatus: ToolStatus }) {
  return (
    <div className="flex items-center gap-2 py-2">
      {toolStatus ? (
        toolStatus.done ? (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-sm text-neutral-500">{toolStatus.label.replace('...', '')}</span>
          </>
        ) : (
          <TextShimmer className="text-sm" duration={0.75}>
            {toolStatus.label}
          </TextShimmer>
        )
      ) : (
        <TextShimmer className="text-sm" duration={1.5}>
          {'Thinking...'}
        </TextShimmer>
      )}
    </div>
  );
}

function getRowKey(row: ChatRow): string {
  if (row.kind === 'message') return row.message.id;
  return row.kind;
}

export function ChatMessageList({
  canvasData,
  conversationId,
  isLoading,
  latestUserMessageRef,
  messages,
  queuePrompt,
  scrollRef,
  sendMessage,
  setInput,
  streamingContent,
  toolStatus,
  voiceStyleEnabled,
}: ChatMessageListProps) {
  const lastUserMessageIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') return index;
    }
    return -1;
  }, [messages]);

  const rows = useMemo<ChatRow[]>(() => {
    const messageRows = messages.map((message, messageIndex) => ({
      kind: 'message' as const,
      message,
      messageIndex,
    }));

    if (streamingContent) {
      return [...messageRows, { kind: 'streaming', content: streamingContent }];
    }

    if (isLoading) {
      return [...messageRows, { kind: 'loading' }];
    }

    return messageRows;
  }, [isLoading, messages, streamingContent]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => getRowKey(rows[index]),
    estimateSize: (index) => {
      const row = rows[index];
      if (!row) return 96;
      if (row.kind === 'loading') return 36;
      if (row.kind === 'streaming') return 160;
      return row.message.role === 'user' ? 72 : 180;
    },
    overscan: 6,
  });

  return (
    <div
      className="relative min-w-0"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (!row) return null;

        return (
          <div
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {row.kind === 'message' ? (
              <ChatMessageRow
                conversationId={conversationId}
                isLastUserMessage={row.messageIndex === lastUserMessageIndex}
                isLoading={isLoading}
                latestUserMessageRef={latestUserMessageRef}
                message={row.message}
                messageIndex={row.messageIndex}
                messagesLength={messages.length}
                queuePrompt={queuePrompt}
                sendMessage={sendMessage}
                setInput={setInput}
                voiceStyleEnabled={voiceStyleEnabled}
              />
            ) : row.kind === 'streaming' ? (
              <StreamingMessageRow canvasData={canvasData} streamingContent={row.content} />
            ) : (
              <LoadingMessageRow toolStatus={toolStatus} />
            )}
          </div>
        );
      })}
    </div>
  );
}
