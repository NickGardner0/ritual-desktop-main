/**
 * Chat Page - Server Component
 * 
 * This page uses useSearchParams() in the client component,
 * which requires a Suspense boundary to handle dynamic rendering.
 */

import { Suspense } from 'react';
import { ChatClient } from './chat-client';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chat | Ritual',
  description: 'Ask questions about your habits and tracking data',
};

// Loading state while chat client initializes
function ChatLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#fafaf8]">
      <div className="text-center">
        <div className="text-[13px] text-[#6b7280]">Preparing chat...</div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatLoading />}>
      <ChatClient />
    </Suspense>
  );
}
