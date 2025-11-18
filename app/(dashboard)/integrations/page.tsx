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
            <div className="flex items-center mb-8 animate-pulse">
              <div className="w-5 h-5 bg-gray-200 rounded mr-2"></div>
              <div className="h-6 w-32 bg-gray-200 rounded"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => (
                <div key={i} className="bg-white border border-gray-200 p-5 h-[280px] animate-pulse" />
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
