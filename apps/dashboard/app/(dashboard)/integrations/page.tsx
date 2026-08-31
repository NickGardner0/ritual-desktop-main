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
import { IntegrationsMarketplaceSkeleton } from './integrations-client.cards';

/**
 * Integrations Page - Fully client-side for instant caching
 */
export default function IntegrationsPage() {
  return (
    <div className="flex-1 overflow-auto">
      <Suspense fallback={<IntegrationsMarketplaceSkeleton />}>
        <IntegrationsClient />
      </Suspense>
    </div>
  );
}
