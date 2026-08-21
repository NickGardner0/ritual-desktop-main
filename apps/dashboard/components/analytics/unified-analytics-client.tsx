/**
 * UnifiedAnalyticsClient - Midday-style unified page with Overview/Metrics toggle
 * 
 * Combines the Dashboard (Overview) and Analytics (Metrics) experiences
 * into a single page with a segmented control toggle.
 * 
 * Overview mode includes: Add habit, Import, AI Chat (original Dashboard features)
 * Metrics mode includes: Spark cards, charts, computer activity
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Plus, Download, List, LayoutGrid } from 'lucide-react';
import { useUIPreferences } from '@/hooks/use-ui-preferences';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@ritual/ui/dropdown-menu';
import type { DateRange } from 'react-day-picker';
import type { ViewMode } from './view-mode-toggle';
import { AnalyticsFilterProvider, useAnalyticsFilters } from './analytics-filter-context';
import { useHabits } from '@/contexts/HabitsContext';
import { useAI } from '@/contexts/AIContext';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/nextjs';
import { useDashboardSnapshotQuery } from '@/hooks/use-dashboard-snapshot-query';
import { useMetricsSnapshotQuery } from '@/hooks/use-metrics-snapshot-query';
import { resolveDashboardViewMode } from '@/lib/dashboard/view-mode-route.mjs';
import { perfInfo } from '@/lib/perf-debug';
import { DateRangePicker } from '@/components/date-range-picker';
import { OverviewView } from './overview-view';
import { invalidateAfterComputerSync, invalidateHabitData } from '@/lib/query-invalidation';
import { markReadConsistencyRequired } from '@/lib/read-consistency';
// Import from separate file to avoid pulling in recharts (~500KB)
const COMPUTER_SYNC_THROTTLE_MS = 5 * 60 * 1000;
const COMPUTER_SYNC_LAST_KEY = 'ritual:computer-sync:last';
const COMPUTER_SYNC_STARTUP_DELAY_MS = 4_000;
const ENABLE_STARTUP_COMPUTER_SYNC = false;
const DATE_FILTERED_LOG_REFRESH_THROTTLE_MS = 20_000;

async function playHabitSuccessSound() {
  try {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const oscillator1 = audioContext.createOscillator();
    const oscillator2 = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator1.connect(gainNode);
    oscillator2.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator1.frequency.setValueAtTime(523.25, audioContext.currentTime);
    oscillator2.frequency.setValueAtTime(659.25, audioContext.currentTime);

    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioContext.currentTime + 0.1);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.6);

    oscillator1.type = 'sine';
    oscillator2.type = 'sine';

    oscillator1.start(audioContext.currentTime);
    oscillator2.start(audioContext.currentTime);
    oscillator1.stop(audioContext.currentTime + 0.6);
    oscillator2.stop(audioContext.currentTime + 0.6);
  } catch (e) {
    console.log('Sound playback failed:', e);
  }
}

// Keep heavy views lazy. Overview and the titlebar date picker load with the page
// so the default dashboard does not hit a post-navigation Loading... boundary.
const MetricsView = dynamic(
  () => import('./metrics-view').then(m => ({ default: m.MetricsView })),
  { loading: () => <ViewLoadingFallback /> }
);

const HabitSelectionModal = dynamic(
  () => import("@/components/habit-selection-modal").then(m => ({ default: m.HabitSelectionModal })),
  { ssr: false }
);

const DataImportModal = dynamic(
  () => import("@/components/data-import-modal").then(m => ({ default: m.DataImportModal })),
  { ssr: false }
);

const AIHabitChat = dynamic(
  () => import("@/components/ai-habit-chat").then(m => ({ default: m.AIHabitChat })),
  { ssr: false }
);

// Loading fallback for lazy-loaded views
function ViewLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <div className="animate-pulse text-gray-400">Loading...</div>
    </div>
  );
}

// Inner component that uses the filter context
function UnifiedAnalyticsContent({
  initialUserId,
}: {
  initialUserId?: string | null;
}) {
  const { viewMode, setViewMode, dateRange, setDateRange, selectedHabits, setSelectedHabits, toggleHabit, selectAllHabits, clearHabitSelection } = useAnalyticsFilters();
  const { overviewViewMode, setOverviewViewMode } = useUIPreferences();
  const isSummaryView = overviewViewMode === 'summary';
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  // Modal states
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  
  // Overflow menu is handled by Radix DropdownMenu (no manual state needed)
  
  
  // Get habits context for refresh after creating/importing
  const { habits, habitLogs, fetchHabits, fetchHabitLogs } = useHabits();
  
  // Get AI context for chat
  const { showAIChat, isFullScreenChat } = useAI();
  
  // For optimistic updates via React Query
  const queryClient = useQueryClient();
  const { user, isLoaded: userLoaded, isSignedIn } = useUser();
  const {
    snapshot: dashboardSnapshot,
    isFetching: isDashboardSnapshotFetching,
  } = useDashboardSnapshotQuery({ initialUserId, dateRange });
  const {
    snapshot: metricsSnapshot,
  } = useMetricsSnapshotQuery({
    initialUserId,
    dateRange,
    enabled: viewMode === 'metrics',
  });
  const metricsReadModel = metricsSnapshot ?? dashboardSnapshot;
  const [shellMountTime] = useState(() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const shellMountTimeRef = useRef(shellMountTime);
  const firstViewReadyLoggedRef = useRef(false);
  const lastDateFilteredLogRefreshKeyRef = useRef<string | null>(null);
  const lastDateFilteredLogRefreshAtRef = useRef(0);

  // Keep "Computer Use" habit in sync after initial paint so startup is not
  // blocked by a write + read-after-write cycle.
  const syncAbortRef = useRef<AbortController | null>(null);
  const syncTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ENABLE_STARTUP_COMPUTER_SYNC) {
      return;
    }

    const syncComputerUseHabit = async (signal: AbortSignal) => {
      if (typeof window !== 'undefined') {
        const lastSyncedAt = Number(sessionStorage.getItem(COMPUTER_SYNC_LAST_KEY) || '0');
        const tooSoon = Date.now() - lastSyncedAt < COMPUTER_SYNC_THROTTLE_MS;
        if (tooSoon) {
          return;
        }
      }

      try {
        // Use lightweight single-day sync on page load. Backfills/reconcile should be manual.
        const response = await fetch('/api/watcher/sync-to-habit', { method: 'POST', signal });
        if (!response.ok) {
          return;
        }
        const result = await response.json();
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(COMPUTER_SYNC_LAST_KEY, String(Date.now()));
        }
        if (signal.aborted) {
          return;
        }
        if (result?.success && result?.synced) {
          markReadConsistencyRequired(user?.id);
          await invalidateAfterComputerSync(queryClient, user?.id);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.debug('Computer use sync failed:', error);
      }
    };

    if (userLoaded && isSignedIn) {
      syncAbortRef.current?.abort();
      if (syncTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(syncTimerRef.current);
      }
      if (typeof window !== 'undefined') {
        syncTimerRef.current = window.setTimeout(() => {
          const controller = new AbortController();
          syncAbortRef.current = controller;
          void syncComputerUseHabit(controller.signal);
        }, COMPUTER_SYNC_STARTUP_DELAY_MS);
      }
    }

    return () => {
      syncAbortRef.current?.abort();
      if (syncTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [queryClient, user?.id, userLoaded, isSignedIn]);

  useEffect(() => {
    const rangeKey = dateRange?.from
      ? `${dateRange.from.toISOString()}:${(dateRange.to ?? dateRange.from).toISOString()}`
      : null;

    if (!user?.id || !rangeKey) {
      lastDateFilteredLogRefreshKeyRef.current = null;
      return;
    }

    let cancelled = false;

    const refreshDateFilteredLogs = async (reason: 'range-change' | 'window-focus') => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      const now = Date.now();
      const sameRange = lastDateFilteredLogRefreshKeyRef.current === rangeKey;
      const withinThrottle = now - lastDateFilteredLogRefreshAtRef.current < DATE_FILTERED_LOG_REFRESH_THROTTLE_MS;

      if (reason !== 'range-change' && sameRange && withinThrottle) {
        return;
      }

      lastDateFilteredLogRefreshKeyRef.current = rangeKey;
      lastDateFilteredLogRefreshAtRef.current = now;
      markReadConsistencyRequired(user.id);
      await fetchHabitLogs();
    };

    void refreshDateFilteredLogs('range-change');

    const handleVisibilityRefresh = () => {
      void refreshDateFilteredLogs('window-focus');
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityRefresh);
    }
    window.addEventListener('focus', handleVisibilityRefresh);

    return () => {
      cancelled = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      }
      window.removeEventListener('focus', handleVisibilityRefresh);
    };
  }, [
    dateRange?.from?.toISOString(),
    dateRange?.to?.toISOString(),
    fetchHabitLogs,
    user?.id,
  ]);

  // Auto-select all habits when habits load and none selected
  useEffect(() => {
    if (habits.length > 0 && selectedHabits.length === 0) {
      const allHabitIds = habits.map(h => h.id).filter((id): id is string => !!id);
      if (allHabitIds.length > 0) {
        selectAllHabits(allHabitIds);
      }
    }
  }, [habits, selectedHabits.length, selectAllHabits]);
  
  // Sync view mode with URL
  useEffect(() => {
    setViewMode(resolveDashboardViewMode(searchParams));
  }, [searchParams, setViewMode]);

  useEffect(() => {
    const shouldOpenImport = searchParams.get('openImport') === '1';
    if (!shouldOpenImport) return;

    queueMicrotask(() => {
      setViewMode('overview');
      setShowImportModal(true);
    });

    const params = new URLSearchParams(searchParams.toString());
    params.delete('openImport');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams, setViewMode]);

  useEffect(() => {
    const habitId = searchParams.get('habit');
    if (!habitId || habits.length === 0) return;
    if (!habits.some((habit) => habit.id === habitId)) return;

    setViewMode('metrics');
    setSelectedHabits([habitId]);
  }, [habits, searchParams, setSelectedHabits, setViewMode]);

  useEffect(() => {
    if (firstViewReadyLoggedRef.current) return;
    if (viewMode === 'overview') {
      const hasOverviewPayload = Boolean(dashboardSnapshot.overviewStats && Object.keys(dashboardSnapshot.overviewStats).length > 0);
      if (!hasOverviewPayload && habits.length === 0) return;
    }
    if (viewMode === 'metrics') {
      const hasMetricsPayload = Boolean(metricsReadModel.metricsAnalyticsData && Object.keys(metricsReadModel.metricsAnalyticsData).length > 0);
      if (!hasMetricsPayload && habits.length === 0) return;
    }

    firstViewReadyLoggedRef.current = true;
    let frame1 = 0;
    let frame2 = 0;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
          perfInfo('unified-analytics', 'first-view-ready', {
            view_mode: viewMode,
            duration_ms: Number((end - shellMountTimeRef.current).toFixed(2)),
            habit_count: habits.length,
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
  }, [dashboardSnapshot.overviewStats, habits.length, metricsReadModel.metricsAnalyticsData, viewMode]);
  
  // Handle habit creation
  const handleHabitCreated = useCallback(async () => {
    try {
      await fetchHabits();
    } catch (error) {
      console.error('Error refreshing habits:', error);
    }
  }, [fetchHabits]);

  // Portal controls into the header (aligned with Search/Tracker)
  // Use state + effect so portals re-resolve after the header DOM appears.
  // When isFullScreenChat transitions from true→false the header re-mounts,
  // but during that same render the DOM nodes don't exist yet.  The effect
  // fires *after* paint, finds the freshly-mounted nodes, and triggers a
  // re-render that wires up the portals.
  const [headerRightSlot, setHeaderRightSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const right = document.getElementById('header-right-slot');
    queueMicrotask(() => {
      setHeaderRightSlot(right);
    });
  }, [isFullScreenChat]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      {/* + button (overview) + Date picker — portalled into header right slot, hidden in chat mode */}
      {!isFullScreenChat && viewMode !== 'chat' && headerRightSlot && createPortal(
        <>
          {viewMode === 'overview' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="app-toolbar-icon-button"
                  aria-label="Add habit"
                  title="Add habit"
                >
                  <Plus strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={6}
                className="w-44 rounded-md border-[rgba(31,35,40,0.1)]"
              >
                <DropdownMenuLabel className="text-[11px] font-normal uppercase tracking-wide text-gray-500">
                  View
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => { void setOverviewViewMode('list'); }}>
                  <List className="w-3.5 h-3.5 mr-2" />
                  <span>List</span>
                  {!isSummaryView && <span className="ml-auto text-[11px] text-gray-500">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { void setOverviewViewMode('summary'); }}>
                  <LayoutGrid className="w-3.5 h-3.5 mr-2" />
                  <span>Card</span>
                  {isSummaryView && <span className="ml-auto text-[11px] text-gray-500">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowSelectionModal(true)}>
                  <Plus className="w-3.5 h-3.5 mr-2" />
                  Add habit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowImportModal(true)}>
                  <Download className="w-3.5 h-3.5 mr-2" />
                  Import data
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <DateRangePicker
            className="w-auto"
            variant="titlebar"
            onDateRangeChange={setDateRange}
            initialDateRange={dateRange}
          />
        </>,
        headerRightSlot
      )}

      {/* Content Area with smooth view switching */}
      <div className="relative h-full min-h-0 pt-1">
        {/* Overview View */}
        <div 
          role="tabpanel"
          id="overview-panel"
          aria-labelledby="overview-tab"
          className={`transition-all duration-200 ease-out ${
            viewMode === 'overview' 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-2 absolute inset-0 pointer-events-none'
          }`}
        >
          {viewMode === 'overview' && (
            <OverviewView
              hideControls={true}
              initialOverviewStats={dashboardSnapshot.overviewStats}
              isOverviewSnapshotFetching={isDashboardSnapshotFetching}
            />
          )}
        </div>
        
        {/* Metrics View - Lazy loaded */}
        <div 
          role="tabpanel"
          id="metrics-panel"
          aria-labelledby="metrics-tab"
          className={`transition-all duration-200 ease-out ${
            viewMode === 'metrics' 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-2 absolute inset-0 pointer-events-none'
          }`}
        >
          {viewMode === 'metrics' && (
            <MetricsView
              hideControls={true}
              initialAnalyticsData={metricsReadModel.metricsAnalyticsData}
              initialSummaryMetrics={metricsReadModel.metricsSummaryMetrics}
              initialBarListAnalyticsData={metricsReadModel.metricsBarListAnalyticsData}
              initialBarListSummaryMetrics={metricsReadModel.metricsBarListSummaryMetrics}
            />
          )}
        </div>

        {/* Chat navigates to /chat — no inline panel needed */}
      </div>
      
      {/* Modals */}
      {showSelectionModal && (
        <HabitSelectionModal
          isOpen={showSelectionModal}
          onClose={() => setShowSelectionModal(false)}
          onHabitCreated={handleHabitCreated}
        />
      )}

      {showImportModal && (
        <DataImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImportComplete={() => {
            fetchHabits();
            fetchHabitLogs();
          }}
        />
      )}
      
      {/* AI Habit Chat - Fixed near bottom, only visible in Overview mode */}
      {showAIChat && viewMode === 'overview' && (
        <div
          className="pointer-events-none fixed bottom-[24px] right-0 flex justify-center px-4 pb-2 pt-2 sm:px-6 lg:px-8"
          style={{ left: 'var(--ritual-sidebar-current-width, 76px)' }}
        >
          <div className="pointer-events-auto w-full max-w-[660px]">
                <AIHabitChat
                onHabitUpdate={async (habitData) => {
                  console.log('🎯 Habit update from AI:', habitData);
                  
                  if (habitData.optimisticUpdate) {
                    // Keep optimistic feedback local to the composer. Aggregate
                    // screen data is refreshed from canonical read models after
                    // the backend writes logs and metric facts.
                    console.log('🚀 Habit log accepted locally; waiting for canonical backend snapshot...');
                    
                    if (habitData.playSound) {
                      void playHabitSuccessSound();
                    }
                    
                    console.log('✅ Local feedback complete, waiting for backend confirmation...');
                  } else if (habitData.refreshNeeded) {
                    console.log('🔄 Backend confirmed success');
                    if (habitData.playSound) {
                      void playHabitSuccessSound();
                    }

                    if (habitData.canonicalRefreshHandled) {
                      console.log('✅ Canonical snapshot applied; read-model refresh is running in the background');
                      return;
                    }

                    // Legacy/screenshot flows do not return the canonical snapshot,
                    // so refresh read models without blocking UI feedback.
                    try {
                      markReadConsistencyRequired(user?.id);
                      void invalidateHabitData(queryClient, user?.id).catch((error) => {
                        console.error('❌ Error refreshing dashboard data:', error);
                      });
                    } catch (error) {
                      console.error('❌ Error refreshing dashboard data:', error);
                    }
                  }
                }}
              />
          </div>
        </div>
      )}

    </div>
  );
}

// Determine initial view mode from URL
function getInitialViewMode(searchParams: URLSearchParams): ViewMode {
  return resolveDashboardViewMode(searchParams);
}

// Main component with provider wrapper
export function UnifiedAnalyticsClient({
  initialViewMode,
  initialUserId,
}: {
  initialViewMode?: ViewMode;
  initialUserId?: string | null;
}) {
  const searchParams = useSearchParams();
  const resolvedInitialViewMode = initialViewMode ?? getInitialViewMode(searchParams);

  return (
    <AnalyticsFilterProvider initialViewMode={resolvedInitialViewMode}>
      <UnifiedAnalyticsContent initialUserId={initialUserId} />
    </AnalyticsFilterProvider>
  );
}
