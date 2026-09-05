/**
 * Calendar Page - Server Component
 *
 * Following best practices:
 * - Server Component for metadata and initial shell
 * - Client component for interactive calendar view
 * - Suspense boundary for streaming
 */

import { Suspense } from 'react';
import { CalendarClient } from './calendar-client';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Calendar | Ritual',
  description: 'Plan commitments and review actual behavior in one calendar workspace.',
};

// Loading skeleton for calendar - Midday style
function CalendarLoading() {
  return (
    <div className="flex min-h-full flex-col bg-[var(--surface-content)]">
      <div className="h-[52px] border-b border-[var(--border-subtle)]" />
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <div className="flex-1 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[linear-gradient(var(--border-subtle)_1px,transparent_1px)] bg-[length:100%_64px]" />
        <div className="hidden w-80 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] xl:block" />
      </div>
    </div>
  );
}

export default function CalendarPage() {
  return (
    <div className="flex min-h-full flex-col bg-[var(--surface-content)]">
      <Suspense fallback={<CalendarLoading />}>
        <CalendarClient />
      </Suspense>
    </div>
  );
}
