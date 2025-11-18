/**
 * Analytics Page - CLIENT Component with React Query
 * 
 * Following Midday's REAL pattern for instant navigation:
 * - Client-side data fetching with React Query
 * - Aggressive caching (5 minutes)
 * - Prefetch on hover
 * - Shows cached data INSTANTLY on navigation
 * 
 * This is how Midday achieves instant page loads!
 */

'use client';

import { Suspense } from 'react';
import { AnalyticsClient } from './analytics-client';

/**
 * Analytics Page - Fully client-side for instant caching
 */
export default function AnalyticsPage() {
  return (
    <div className="flex-1 overflow-auto bg-white relative">
      <div className="max-w-7xl mx-auto p-6 lg:p-8">
        {/* Client component fetches and caches data */}
        <Suspense fallback={
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => (
                <div key={i} className="bg-white border border-gray-300 p-5 h-24 animate-pulse" />
              ))}
            </div>
            <div className="h-64 bg-white border border-gray-300 animate-pulse" />
          </div>
        }>
          <AnalyticsClient />
        </Suspense>
      </div>
    </div>
  );
}
