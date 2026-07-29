/**
 * Integrations Page - CLIENT Component with React Query
 * 
 * Following Midday's pattern for instant navigation:
 * - Client-side data fetching with React Query
 * - Aggressive caching (2 minutes)
 * - Shows cached data INSTANTLY on navigation
 */

'use client';

import { Suspense } from 'react';
import { IntegrationsClient } from './integrations-client';

/**
 * Integrations Page - Fully client-side for instant caching
 */
export default function IntegrationsPage() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto py-8 px-8">
        <Suspense fallback={
          <div>
            <div className="flex items-center mb-6">
              <div className="w-4 h-4 rounded mr-2 animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200"></div>
              <div className="h-5 w-28 rounded animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200"></div>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              {[1,2,3,4,5,6].map(i => (
                <div key={i} className="h-[168px] rounded-md border border-gray-200 px-3 py-2 animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
              ))}
            </div>
          </div>
        }>
          <IntegrationsClient />
        </Suspense>
      </div>
    </div>
  );
}
