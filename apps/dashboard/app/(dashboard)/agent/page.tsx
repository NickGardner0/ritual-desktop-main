import { Suspense } from 'react';
import { AgentChat } from './agent-chat';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Agent | Ritual',
  description: 'Ritual agent — unified chat surface',
};

function Loading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#fafaf8]">
      <div className="text-[13px] text-[#6b7280]">Loading agent…</div>
    </div>
  );
}

export default function AgentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AgentChat />
    </Suspense>
  );
}
