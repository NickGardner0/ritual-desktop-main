/**
 * Integrations Loading Shell
 * 
 * This provides an instant loading state that's shown immediately
 * while the Integrations page data is being fetched. Following NextFaster's
 * approach of showing instant UI shells.
 */

export default function IntegrationsLoading() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto py-8 px-8">
        {/* Header Skeleton */}
        <div className="flex items-center mb-8 animate-pulse">
          <div className="w-5 h-5 bg-gray-200 rounded mr-2"></div>
          <div className="h-6 w-32 bg-gray-200 rounded"></div>
        </div>

        {/* Integration Cards Grid Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div 
              key={i} 
              className="bg-white border border-gray-200 p-5 h-[280px] animate-pulse"
            >
              {/* Logo */}
              <div className="h-14 mb-4">
                <div className="w-24 h-12 bg-gray-200 rounded"></div>
              </div>
              
              {/* Title */}
              <div className="mb-2">
                <div className="h-5 w-32 bg-gray-200 rounded"></div>
              </div>
              
              {/* Description */}
              <div className="space-y-2 mb-5">
                <div className="h-4 w-full bg-gray-100 rounded"></div>
                <div className="h-4 w-full bg-gray-100 rounded"></div>
                <div className="h-4 w-3/4 bg-gray-100 rounded"></div>
              </div>
              
              {/* Buttons */}
              <div className="flex items-center gap-3 mt-auto">
                <div className="h-9 w-20 bg-gray-200 rounded"></div>
                <div className="h-9 w-24 bg-gray-200 rounded"></div>
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

