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
      <div className="h-full flex flex-col bg-[#fbfbf9] relative">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Loading chat...</p>
          </div>
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
