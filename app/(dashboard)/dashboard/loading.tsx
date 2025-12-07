const shimmerClass = "animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200";

export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mt-1">
        <div className={`h-4 w-20 rounded ${shimmerClass}`}></div>
        <div className="flex items-center space-x-1">
          <div className={`h-9 w-24 rounded ${shimmerClass}`}></div>
          <div className={`h-9 w-32 rounded ${shimmerClass}`}></div>
        </div>
      </div>

      {/* Habits list skeleton */}
      <div className="mt-6">
        <div className="max-w-4xl mx-auto px-2 w-full">
          <div className="space-y-1">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="w-full flex items-center py-1 bg-white"
              >
                <div className="flex items-center flex-1 min-w-0 space-x-1">
                  <div className={`w-6 h-6 rounded-full ${shimmerClass}`}></div>
                  <div className={`h-4 w-32 rounded ${shimmerClass}`}></div>
                </div>
                <div className="flex items-center space-x-1 ml-4">
                  <div className={`h-4 w-24 rounded ${shimmerClass}`}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

