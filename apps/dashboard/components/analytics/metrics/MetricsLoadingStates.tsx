'use client';

export function MetricsInitialLoadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[920px] space-y-5">
      <div className="flex items-center gap-2 border-b border-[rgba(39,37,30,0.06)] pb-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-7 w-20 rounded-md animate-pulse bg-gray-100" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-[6px] sm:grid-cols-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[100px] rounded-lg border border-gray-100 animate-pulse bg-gray-50/80" />
        ))}
      </div>
    </div>
  );
}

export function MetricsGridLoadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[920px] grid grid-cols-2 gap-[6px] sm:grid-cols-3 lg:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-[100px] rounded-lg border border-gray-100 animate-pulse bg-gray-50/80">
          <div className="px-3 pt-3">
            <div className="h-3 w-20 rounded bg-gray-100/80" />
            <div className="mt-2 h-3 w-12 rounded bg-gray-100/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MetricsEmptyState() {
  return (
    <div className="mx-auto w-full max-w-[920px] px-6 py-16 text-center">
      <div className="max-w-sm mx-auto">
        <div className="text-xl mb-2 text-center" style={{ fontWeight: 500 }}>
          No metrics yet
        </div>
        <div
          className="text-sm font-normal leading-tight text-center"
          style={{ fontWeight: 400, color: '#9C9C9D' }}
        >
          Start tracking anything from the Overview tab
          <br />
          to see your analytics and trends here.
        </div>
      </div>
    </div>
  );
}
