'use client';

export function ActivityLoading() {
  return (
    <div className="flex flex-col h-full">
      {/* Header skeleton */}
      <div className="flex justify-between py-6 px-6">
        <div className="h-10 w-[350px] rounded-none animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
        <div className="flex gap-2">
          <div className="h-10 w-24 rounded-none animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
          <div className="h-10 w-24 rounded-none animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
        </div>
      </div>

      {/* Table skeleton */}
      <div className="flex-1 overflow-hidden px-6">
        <div className="border border-gray-300 bg-white">
          {/* Header row */}
          <div className="h-[45px] border-b border-gray-300 flex items-center px-4 gap-4">
            {[50, 100, 200, 120, 150, 100, 100, 80].map((width, i) => (
              <div 
                key={i}
                className="h-4 rounded-none animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200"
                style={{ width: `${width}px` }}
              />
            ))}
          </div>
          
          {/* Data rows */}
          {Array.from({ length: 12 }).map((_, i) => (
            <div 
              key={i} 
              className="h-[45px] border-b border-gray-300 last:border-b-0 flex items-center px-4 gap-4"
            >
              {[50, 100, 200, 120, 150, 100, 100, 80].map((width, j) => (
                <div 
                  key={j}
                  className="h-4 rounded-none animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200"
                  style={{ width: `${width}px`, animationDelay: `${(i * 8 + j) * 50}ms` }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ActivityLoading;

