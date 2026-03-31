const shimmerClass = "animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col h-[calc(100vh-60px)] overflow-hidden">
      {/* Top bar skeleton: tab switcher + controls */}
      <div className="flex items-center justify-between px-6 pt-4 pb-2">
        <div className={`h-4 w-20 rounded ${shimmerClass}`}></div>
        <div className="flex items-center gap-2">
          <div className={`h-8 w-20 rounded-md ${shimmerClass}`}></div>
          <div className={`h-8 w-28 rounded-md ${shimmerClass}`}></div>
        </div>
      </div>

      {/* Centered habits list skeleton */}
      <div className="flex-1 flex flex-col items-center pt-8">
        <div className="max-w-[500px] w-full space-y-2 px-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2"
            >
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full ${shimmerClass}`}></div>
                <div className={`h-4 rounded ${shimmerClass}`} style={{ width: `${100 + i * 15}px` }}></div>
              </div>
              <div className={`h-4 w-24 rounded ${shimmerClass}`}></div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat bar skeleton at bottom */}
      <div className="flex justify-center px-4 pb-6 pt-4">
        <div className={`w-full max-w-2xl h-[88px] rounded-xl ${shimmerClass}`}></div>
      </div>
    </div>
  );
}
