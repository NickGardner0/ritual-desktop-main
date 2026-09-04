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
    <div className="flex min-h-full bg-[var(--surface-content)]">
      <div className="w-72 border-r border-[var(--border-subtle)] bg-[var(--surface-raised)]" />
      <div className="flex-1 animate-pulse bg-[linear-gradient(var(--border-subtle)_1px,transparent_1px)] bg-[length:100%_30px]" />
      <div className="hidden w-80 border-l border-[var(--border-subtle)] bg-[var(--surface-raised)] xl:block" />
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
