/**
 * Analytics Loading Shell
 * 
 * This provides an instant loading state that's shown immediately
 * while the Analytics page data is being fetched. Following NextFaster's
 * approach of showing instant UI shells.
 */

import { BrailleSpinner } from "@/components/ui/braille-spinner";

const shimmerClass = "animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200";

export default function AnalyticsLoading() {
  return (
    <div className="flex-1 overflow-auto bg-white">
      <div className="max-w-7xl mx-auto p-6 lg:p-8">
        {/* Header Skeleton */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className={`h-8 w-32 rounded mb-2 ${shimmerClass}`}></div>
            <div className={`h-4 w-64 rounded ${shimmerClass}`}></div>
          </div>
          <div className={`h-10 w-64 rounded ${shimmerClass}`}></div>
        </div>

        {/* Summary Metrics Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white border border-gray-300 p-5">
              <div className={`h-3 w-24 rounded mb-3 ${shimmerClass}`}></div>
              <div className={`h-9 w-20 rounded mb-2 ${shimmerClass}`}></div>
              <div className={`h-3 w-32 rounded ${shimmerClass}`}></div>
            </div>
          ))}
        </div>

        {/* Habit Selector Skeleton */}
        <div className="mb-6">
          <div className={`h-3 w-24 rounded mb-2 ${shimmerClass}`}></div>
          <div className={`h-10 w-80 rounded ${shimmerClass}`}></div>
        </div>

        {/* Chart Cards Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div 
              key={i} 
              className="bg-white border border-gray-300 p-4 h-[280px]"
            >
              {/* Header */}
              <div className="flex items-center gap-2 mb-3">
                <div className={`h-4 w-32 rounded ${shimmerClass}`}></div>
              </div>
              
              {/* Value */}
              <div className={`h-8 w-24 rounded mb-3 ${shimmerClass}`}></div>
              
              {/* Chart */}
              <div className={`h-[140px] rounded ${shimmerClass}`}></div>
            </div>
          ))}
        </div>

        {/* Loading indicator */}
        <div className="fixed bottom-4 right-4 bg-white border border-gray-300 px-4 py-2 rounded-none shadow-lg">
          <div className="flex items-center gap-2">
            <BrailleSpinner className="text-sm text-gray-600" />
            <span className="text-sm text-gray-600">Loading analytics...</span>
          </div>
        </div>
      </div>
    </div>
  );
}

