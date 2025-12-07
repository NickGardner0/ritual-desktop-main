/**
 * Dashboard Loading Skeleton
 * 
 * Shows instantly while data loads in background.
 * This makes the app FEEL faster (perceived performance).
 */

const shimmerClass = "animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200";

export function DashboardLoadingSkeleton() {
  return (
    <div className="flex-1 overflow-auto p-8">
      {/* Header Skeleton */}
      <div className="mb-8">
        <div className={`h-8 w-48 rounded mb-2 ${shimmerClass}`}></div>
        <div className={`h-4 w-64 rounded ${shimmerClass}`}></div>
      </div>

      {/* Stats Cards Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className={`h-24 rounded-lg ${shimmerClass}`}></div>
        ))}
      </div>

      {/* Habits List Skeleton */}
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center justify-between h-16 bg-gray-50 rounded-lg px-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${shimmerClass}`}></div>
              <div className={`h-4 w-32 rounded ${shimmerClass}`}></div>
            </div>
            <div className={`h-4 w-20 rounded ${shimmerClass}`}></div>
          </div>
        ))}
      </div>
    </div>
  );
}

