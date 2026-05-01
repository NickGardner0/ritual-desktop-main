'use client';

import { RouteErrorFallback } from '@/components/route-error-fallback';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorFallback error={error} reset={reset} source="dashboard-route-error" />;
}
