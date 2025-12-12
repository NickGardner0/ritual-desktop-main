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
// We return an empty container with matching bg to prevent flash
function ChatLoading() {
  return <div className="h-full w-full bg-[#fafaf8]" />;
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatLoading />}>
      <ChatClient />
    </Suspense>
  );
}
