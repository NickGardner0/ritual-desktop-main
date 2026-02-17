/**
 * Integrations Loading Shell
 * 
 * This provides an instant loading state that's shown immediately
 * while the Integrations page data is being fetched. Following NextFaster's
 * approach of showing instant UI shells.
 */

const shimmerClass = "animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200";

export default function IntegrationsLoading() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto py-8 px-8">
        {/* Header Skeleton */}
        <div className="flex items-center mb-6">
          <div className={`w-4 h-4 rounded mr-2 ${shimmerClass}`}></div>
          <div className={`h-5 w-28 rounded ${shimmerClass}`}></div>
        </div>

        {/* Integration Cards Grid Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div 
              key={i} 
              className="bg-white border border-gray-200 p-4 h-[200px]"
            >
              {/* Logo */}
              <div className="h-10 mb-2">
                <div className={`w-16 h-7 rounded ${shimmerClass}`}></div>
              </div>
              
              {/* Title */}
              <div className="mb-1">
                <div className={`h-4 w-24 rounded ${shimmerClass}`}></div>
              </div>
              
              {/* Description */}
              <div className="space-y-1.5 mb-3">
                <div className={`h-3 w-full rounded ${shimmerClass}`}></div>
                <div className={`h-3 w-3/4 rounded ${shimmerClass}`}></div>
              </div>
              
              {/* Buttons */}
              <div className="flex items-center gap-2 mt-auto">
                <div className={`h-6 w-16 rounded ${shimmerClass}`}></div>
                <div className={`h-6 w-14 rounded ${shimmerClass}`}></div>
              </div>
            </div>
          ))}
        </div>

        {/* Loading indicator */}
        <div className="fixed bottom-4 right-4 bg-white border border-gray-300 px-4 py-2 rounded-none shadow-lg">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
            <span className="text-sm text-gray-600">Loading integrations...</span>
          </div>
        </div>
      </div>
    </div>
  );
}

