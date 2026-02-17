/**
 * Dashboard/Index Page - Server Component
 * 
 * Unified page with Overview/Metrics toggle (Midday-style).
 * This is the primary destination combining:
 * - Overview: Habit list with totals and stats
 * - Metrics: Spark cards, charts, and computer activity
 * 
 * URL params:
 * - ?view=overview - Shows the habit list (default)
 * - ?view=metrics - Shows the charts and spark cards
 */

import { Suspense } from 'react';
import { UnifiedAnalyticsClient } from '@/components/analytics/unified-analytics-client';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard | Ritual',
  description: 'Track and manage your daily habits',
};

// Loading skeleton
function DashboardLoading() {
  return (
    <div className="space-y-6 p-6 lg:p-8">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-32 rounded animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
          <div className="h-4 w-48 rounded animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-9 w-32 rounded animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
          <div className="h-9 w-40 rounded animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
        </div>
      </div>
      
      {/* Content skeleton */}
      <div className="max-w-[500px] mx-auto space-y-2">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div 
            key={i} 
            className="h-8 animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" 
          />
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="flex-1 overflow-auto bg-white relative">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 pt-7 pb-72">
        <Suspense fallback={<DashboardLoading />}>
          <UnifiedAnalyticsClient />
        </Suspense>
      </div>
    </div>
  );
}
