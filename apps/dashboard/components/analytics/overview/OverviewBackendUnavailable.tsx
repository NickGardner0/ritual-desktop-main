'use client';

interface OverviewBackendUnavailableProps {
  onRetry: () => void;
}

export function OverviewBackendUnavailable({ onRetry }: OverviewBackendUnavailableProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] mt-8 text-center">
      <div className="text-xl text-black" style={{ fontWeight: 500 }}>
        Backend unavailable
      </div>
      <div className="mt-2 max-w-xl text-sm leading-tight text-black" style={{ fontWeight: 400 }}>
        We couldn&apos;t load your data right now.
        <br />
        Retrying in the background.
      </div>
      <button
        onClick={onRetry}
        className="mt-4 text-sm text-black underline underline-offset-4"
        style={{ fontWeight: 400 }}
      >
        Retry now
      </button>
    </div>
  );
}
