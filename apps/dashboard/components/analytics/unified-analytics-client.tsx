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
import { Plus, Download } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { DateRange } from 'react-day-picker';
import { ViewModeToggle, ViewMode } from './view-mode-toggle';
import { AnalyticsFilterProvider, useAnalyticsFilters } from './analytics-filter-context';
import { useHabits } from '@/contexts/HabitsContext';
import { useAI } from '@/contexts/AIContext';
import { useQueryClient } from '@tanstack/react-query';
import { habitLogKeys } from '@/hooks/use-habits-query';
import { useUser } from '@clerk/nextjs';
import { useDashboardSnapshotQuery } from '@/hooks/use-dashboard-snapshot-query';
import { perfInfo } from '@/lib/perf-debug';
import { invalidateAfterComputerSync, invalidateHabitData } from '@/lib/query-invalidation';
import { markReadConsistencyRequired } from '@/lib/read-consistency';
// Import from separate file to avoid pulling in recharts (~500KB)
const COMPUTER_SYNC_THROTTLE_MS = 5 * 60 * 1000;
const COMPUTER_SYNC_LAST_KEY = 'ritual:computer-sync:last';
const COMPUTER_SYNC_STARTUP_DELAY_MS = 4_000;
const ENABLE_STARTUP_COMPUTER_SYNC = false;

// Dynamic imports with ssr:false — Turbopack skips these modules during
// server-side compilation, cutting the initial /dashboard compile from ~70s.
const DateRangePicker = dynamic(
  () => import('@/components/date-range-picker').then(m => ({ default: m.DateRangePicker })),
  { loading: () => <ControlLoadingFallback /> }
);

const OverviewView = dynamic(
  () => import('./overview-view').then(m => ({ default: m.OverviewView })),
  { loading: () => <ViewLoadingFallback /> }
);

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

const ConnectedDevicesBar = dynamic(
  () => import("@/components/connected-devices-modal").then(m => ({ default: m.ConnectedDevicesBar })),
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

// Compact loading fallback for controls
function ControlLoadingFallback() {
  return <div className="h-8 w-28 bg-gray-100 animate-pulse" />;
}

// Inner component that uses the filter context
function UnifiedAnalyticsContent({
  initialUserId,
}: {
  initialUserId?: string | null;
}) {
  const { viewMode, setViewMode, dateRange, setDateRange, selectedHabits, setSelectedHabits, toggleHabit, selectAllHabits, clearHabitSelection } = useAnalyticsFilters();
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
  const { snapshot: dashboardSnapshot } = useDashboardSnapshotQuery({ initialUserId, dateRange });
  const shellMountTimeRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const firstViewReadyLoggedRef = useRef(false);

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
    const viewParam = searchParams.get('view');
    if (viewParam === 'chat' || viewParam === 'overview' || viewParam === 'metrics') {
      setViewMode(viewParam);
    }
  }, [searchParams, setViewMode]);

  useEffect(() => {
    const shouldOpenImport = searchParams.get('openImport') === '1';
    if (!shouldOpenImport) return;

    setViewMode('overview');
    setShowImportModal(true);

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
      const hasMetricsPayload = Boolean(dashboardSnapshot.metricsAnalyticsData && Object.keys(dashboardSnapshot.metricsAnalyticsData).length > 0);
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
  }, [dashboardSnapshot.metricsAnalyticsData, dashboardSnapshot.overviewStats, habits.length, viewMode]);
  
  // Update URL when view mode changes
  const handleViewChange = useCallback((newView: ViewMode) => {
    if (newView === 'chat') {
      // Navigate to the dedicated full chat page
      router.push('/chat');
      return;
    }
    setViewMode(newView);

    // Update URL without triggering navigation
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', newView);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [setViewMode, router, pathname, searchParams]);

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
  const [headerCenterSlot, setHeaderCenterSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const right = document.getElementById('header-right-slot');
    const center = document.getElementById('header-center-slot');
    setHeaderRightSlot(right);
    setHeaderCenterSlot(center);
  }, [isFullScreenChat]);

  return (
    <div className="space-y-3">
      {/* Tab bar — portalled into header center slot */}
      {!isFullScreenChat && headerCenterSlot && createPortal(
        <ViewModeToggle
          currentView={viewMode}
          onViewChange={handleViewChange}
        />,
        headerCenterSlot
      )}

      {/* + button (overview) + Date picker — portalled into header right slot, hidden in chat mode */}
      {!isFullScreenChat && viewMode !== 'chat' && headerRightSlot && createPortal(
        <>
          {viewMode === 'overview' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-8 w-8 border border-gray-300 shadow-sm bg-white text-gray-500 hover:text-gray-900 hover:bg-[#F5F5F5] transition-colors flex items-center justify-center rounded-sm focus:outline-none"
                  aria-label="Add"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6}>
                <DropdownMenuItem onClick={() => setShowSelectionModal(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add habit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowImportModal(true)}>
                  <Download className="w-4 h-4 mr-2" />
                  Import data
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <DateRangePicker
            className="w-auto"
            onDateRangeChange={setDateRange}
            initialDateRange={dateRange}
          />
        </>,
        headerRightSlot
      )}

      {/* Content Area with smooth view switching */}
      <div className="relative min-h-[400px] pt-1">
        {/* Overview View - Lazy loaded */}
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
              initialAnalyticsData={dashboardSnapshot.metricsAnalyticsData}
              initialSummaryMetrics={dashboardSnapshot.metricsSummaryMetrics}
              initialBarListAnalyticsData={dashboardSnapshot.metricsBarListAnalyticsData}
              initialBarListSummaryMetrics={dashboardSnapshot.metricsBarListSummaryMetrics}
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
        <div className="fixed bottom-[32px] left-[76px] right-0 flex justify-center px-4 sm:px-6 lg:px-8 pb-3 pt-3 bg-gradient-to-t from-white/95 via-white/70 to-transparent pointer-events-none">
          <div className="w-full max-w-2xl pointer-events-auto">
              <AIHabitChat
                onHabitUpdate={async (habitData) => {
                  console.log('🎯 Habit update from AI:', habitData);
                  
                  if (habitData.optimisticUpdate) {
                    // Optimistic update: instantly add a temporary log to the UI
                    console.log('🚀 Optimistic update received, updating UI immediately...');
                    const todayLocalDate = new Date().toLocaleDateString('en-CA');
                    
                    if (habitData.habitId && (habitData.duration !== undefined || habitData.amount !== undefined)) {
                      const tempLog = {
                        id: `temp-${Date.now()}`,
                        habit_id: habitData.habitId,
                        duration: habitData.duration ? habitData.duration * 60 : 0,
                        amount: habitData.amount || null,
                        date: todayLocalDate,
                        completed_at: new Date().toISOString(),
                        status: 'completed' as const,
                        notes: habitData.notes || '',
                        unit: habitData.unit || ''
                      };
                      
                      // Add temporary log via React Query cache for instant UI update
                      if (user?.id) {
                        queryClient.setQueryData(
                          habitLogKeys.list(user.id),
                          (old: any[] | undefined) => old ? [...old, tempLog] : [tempLog]
                        );
                        console.log('✅ Added optimistic log to React Query cache:', tempLog);
                      }
                    }
                    
                    // Play the ring sound effect
                    if (habitData.playSound) {
                      try {
                        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
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
                    
                    console.log('✅ Optimistic update complete, waiting for backend confirmation...');
                  } else if (habitData.refreshNeeded) {
                    // Backend confirmed - now refresh from database
                    console.log('🔄 Backend confirmed success, refreshing from database...');
                    try {
                      markReadConsistencyRequired(user?.id);
                      await invalidateHabitData(queryClient, user?.id);
                      console.log('✅ Dashboard data refreshed after habit log');
                      
                      // Play sound on successful multi-intent log (when no optimistic update was done)
                      if (habitData.playSound) {
                        try {
                          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
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
                    } catch (error) {
                      console.error('❌ Error refreshing dashboard data:', error);
                    }
                  }
                }}
              />
          </div>
        </div>
      )}

      {/* Connected devices button below chat bar */}
      {viewMode === 'overview' && (
        <ConnectedDevicesBar />
      )}
    </div>
  );
}

// Determine initial view mode from URL
function getInitialViewMode(searchParams: URLSearchParams): ViewMode {
  const viewParam = searchParams.get('view');
  if (viewParam === 'overview' || viewParam === 'metrics') {
    return viewParam;
  }
  return 'overview'; // Default to overview
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
