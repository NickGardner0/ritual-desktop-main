'use client'

import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Message } from '@/components/chat/chat-message';

export type { ChatActionReceiptData, ChatEntityRef, Message } from '@/components/chat/chat-message';
export {
  getToolLabel,
  extractCanvasData,
  buildCanvasFromToolData,
  cleanContentForDisplay,
} from './chat-stream-helpers';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export function SidebarToggleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect width="20" height="18" x="2" y="3" rx="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 3v18" />
      </g>
    </svg>
  );
}

export const MAX_VISIBLE_CHAT_SUGGESTIONS = 2;

export type ConversationContextMenuState = {
  conversationId: string;
  x: number;
  y: number;
} | null;

// Canvas layout constants
export const DEFAULT_CANVAS_WIDTH = 560;
export const MIN_CANVAS_WIDTH = 360;
export const MAX_CANVAS_WIDTH = 860;
// Pure white so the chat card pops cleanly against the page.
export const CHAT_PAGE_CARD_BG = '#ffffff';
// Neutral strip just slightly darker than the card so the Connect-apps bar
// reads as a flush extension rather than a stark grey footer.
export const CHAT_PAGE_CONNECT_BAR_BG = '#ebebea';
export const CHAT_PAGE_CONNECT_BAR_DISMISS_KEY = 'ritual:chat:apps-bar-dismissed';

// Curated from the Integrations page. Icons render inside a shared fixed
// row-height cell for clean vertical alignment, but each logo gets its own
// height tuned by visual weight — portrait silhouettes (Apple) and thin
// marks (Whoop ring) need more height to read at the same optical size as
// dense icons (Google Calendar block).
export const CONNECT_APPS_BAR_CELL_HEIGHT = 16;
export const CONNECT_APPS_BAR_ICONS: Array<{
  id: string;
  alt: string;
  src: string;
  height: number;
}> = [
  { id: 'apple', alt: 'Apple', src: '/images/apple-logo.svg', height: 15 },
  { id: 'whoop', alt: 'Whoop', src: '/images/whoop.svg', height: 15 },
  { id: 'fitbit', alt: 'Fitbit', src: '/images/fitbit.svg', height: 13 },
  { id: 'google-calendar', alt: 'Google Calendar', src: '/images/Google_Calendar_Logo.svg', height: 12 },
  { id: 'plaid', alt: 'Plaid', src: '/images/plaid-mark.svg', height: 13 },
  { id: 'tesla', alt: 'Tesla', src: '/images/Tesla_T_symbol.svg', height: 13 },
];

export interface ConnectAppsBarProps {
  onOpenIntegrations: () => void;
  onDismiss: () => void;
}

export function ConnectAppsBar({ onOpenIntegrations, onDismiss }: ConnectAppsBarProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-t border-gray-200/30 px-4 py-2"
      style={{ backgroundColor: CHAT_PAGE_CONNECT_BAR_BG }}
    >
      <button
        type="button"
        onClick={onOpenIntegrations}
        className="text-[12px] font-normal text-gray-500 transition-colors hover:text-gray-700"
      >
        Connect your devices to get better answers
      </button>
      <div className="flex items-center gap-2.5">
        <div
          className="flex items-center gap-2.5"
          style={{ height: CONNECT_APPS_BAR_CELL_HEIGHT }}
        >
          {CONNECT_APPS_BAR_ICONS.map((app) => (
            <span
              key={app.id}
              className="inline-flex shrink-0 items-center justify-center"
              style={{ height: CONNECT_APPS_BAR_CELL_HEIGHT }}
            >
              <img
                src={app.src}
                alt={app.alt}
                className="object-contain opacity-85"
                style={{ height: app.height, width: 'auto' }}
              />
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
          }}
          className="flex h-4 w-4 items-center justify-center text-gray-400 transition-colors hover:text-gray-600"
          aria-label="Dismiss connect apps bar"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// Persisted conversation types
export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_payload?: Record<string, unknown> | null;
  created_at: string;
}

export interface PersistedConversation {
  id: string;
  user_id: string;
  title: string | null;
  response_mode?: 'text' | 'voice';
  auto_run_queued?: boolean;
  created_at: string;
  updated_at: string;
  messages: PersistedMessage[];
}

// Sidebar conversation item (without full messages)
export interface ConversationListItem {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  first_message?: string;
}

export function buildConversationArtifactBody(message: Message, title: string) {
  return {
    schemaVersion: 1,
    blocks: [
      {
        type: 'hero',
        title,
        periodLabel: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        intro: 'Saved from Ritual chat.',
      },
      { type: 'summary', text: message.content },
    ],
  };
}

export function getPersistedAfterMessageId(messageId: string | undefined): string | null {
  if (!messageId) return null;
  if (
    messageId.startsWith('user-')
    || messageId.startsWith('assistant-')
    || messageId.startsWith('error-')
  ) {
    return null;
  }
  return messageId;
}
