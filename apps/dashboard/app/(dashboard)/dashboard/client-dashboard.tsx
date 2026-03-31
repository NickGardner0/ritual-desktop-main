'use client';

import { useEffect, useRef } from 'react';
import { UnifiedAnalyticsClient } from '@/components/analytics/unified-analytics-client';
import type { ViewMode } from '@/components/analytics/view-mode-toggle';
import type { DashboardDerivedInitialData } from './dashboard-initial-data';
import { perfInfo } from '@/lib/perf-debug';

export function ClientDashboard({
  initialViewMode,
  initialDerivedData,
}: {
  initialViewMode: ViewMode;
  initialDerivedData: DashboardDerivedInitialData;
}) {
  const mountTimeRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());

  useEffect(() => {
    perfInfo('client-dashboard', 'mount', {
      initial_view_mode: initialViewMode,
      has_overview_stats: Boolean(initialDerivedData?.overviewStats && Object.keys(initialDerivedData.overviewStats).length > 0),
      has_metrics_data: Boolean(initialDerivedData?.metricsAnalyticsData && Object.keys(initialDerivedData.metricsAnalyticsData).length > 0),
    });

    let frame1 = 0;
    let frame2 = 0;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
          perfInfo('client-dashboard', 'first-shell-frame', {
            duration_ms: Number((end - mountTimeRef.current).toFixed(2)),
            initial_view_mode: initialViewMode,
          });
        });
      });
    }

    return () => {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        if (frame1) window.cancelAnimationFrame(frame1);
        if (frame2) window.cancelAnimationFrame(frame2);
      }
    };
  }, [initialDerivedData, initialViewMode]);

  return (
    <UnifiedAnalyticsClient
      initialViewMode={initialViewMode}
      initialDerivedData={initialDerivedData}
    />
  );
}
