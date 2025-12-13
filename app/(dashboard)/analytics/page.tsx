/**
 * Analytics Page - Server Component
 * 
 * Following best practices:
 * - Server Component for metadata and initial shell
 * - Client component for interactive React Query data fetching
 * - Suspense boundary for streaming
 * 
 * This gives you:
 * - Better SEO with server-rendered metadata
 * - Smaller initial JS bundle
 * - Instant navigation with cached data (via React Query in client)
 */

import { Suspense } from 'react';
import { AnalyticsClient } from './analytics-client';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Analytics | Ritual',
  description: 'View insights and trends for your habits',
};

// Loading skeleton for analytics
function AnalyticsLoading() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <div 
            key={i} 
            className="border border-gray-300 p-3 h-32 animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" 
          />
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <div className="flex-1 overflow-auto bg-white relative">
      <div className="max-w-7xl mx-auto p-6 lg:p-8">
        <Suspense fallback={<AnalyticsLoading />}>
          <AnalyticsClient />
        </Suspense>
      </div>
    </div>
  );
}
