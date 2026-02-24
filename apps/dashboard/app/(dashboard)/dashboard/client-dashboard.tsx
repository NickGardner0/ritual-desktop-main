'use client';

import dynamic from 'next/dynamic';

function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6 lg:p-8">
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

// ssr:false defers the ENTIRE client component tree (React Query, Clerk hooks,
// Radix UI, recharts, @dnd-kit, etc.) to a client-only chunk. The server only
// compiles this thin wrapper + the skeleton above.
const UnifiedAnalyticsClient = dynamic(
  () => import('@/components/analytics/unified-analytics-client').then(m => ({ default: m.UnifiedAnalyticsClient })),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);

export function ClientDashboard() {
  return <UnifiedAnalyticsClient />;
}
