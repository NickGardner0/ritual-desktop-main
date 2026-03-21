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
  description: 'View your habits on a calendar',
};

// Loading skeleton for calendar - Midday style
function CalendarLoading() {
  return (
    <div className="flex min-h-full flex-col bg-background">
      {/* Header skeleton */}
      <div className="flex items-center justify-between px-6 py-6">
        {/* Duration skeleton */}
        <div className="h-10 w-32 bg-muted animate-pulse rounded" />
        {/* Controls skeleton */}
        <div className="flex items-center gap-2">
          <div className="h-9 w-40 bg-muted animate-pulse rounded" />
          <div className="h-9 w-9 bg-muted animate-pulse rounded" />
          <div className="h-9 w-28 bg-muted animate-pulse rounded" />
        </div>
      </div>
      {/* Calendar grid skeleton */}
      <div className="flex-1 px-6 pb-8">
        <div className="grid grid-cols-7 gap-px border border-border bg-border">
          {/* Day headers */}
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={`header-${i}`} className="h-12 bg-background" />
          ))}
          {/* Calendar cells */}
          {Array.from({ length: 35 }).map((_, i) => (
            <div
              key={`cell-${i}`}
              className="aspect-square md:aspect-[4/2.25] bg-background"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  return (
    <div className="flex min-h-full flex-col bg-background">
      <Suspense fallback={<CalendarLoading />}>
        <CalendarClient />
      </Suspense>
    </div>
  );
}
