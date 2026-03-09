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
import { Plus, Download, ChevronDown } from 'lucide-react';
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
import { useUser, useAuth } from '@clerk/nextjs';
import { getLocationPermissionStatus, requestCurrentLocation } from '@/lib/location-utils';
// Import from separate file to avoid pulling in recharts (~500KB)
import { AnalyticsViewToggle } from './analytics-view-toggle';

const COMPUTER_SYNC_THROTTLE_MS = 5 * 60 * 1000;
const COMPUTER_SYNC_LAST_KEY = 'ritual:computer-sync:last';
const WEATHER_AUTO_SYNC_INTERVAL_MS = 45 * 60 * 1000;
const WEATHER_AUTO_SYNC_LAST_KEY = 'ritual:weather-auto-sync:last';
const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// Dynamic imports with ssr:false — Turbopack skips these modules during
// server-side compilation, cutting the initial /dashboard compile from ~70s.
const DateRangePicker = dynamic(
  () => import('@/components/date-range-picker').then(m => ({ default: m.DateRangePicker })),
  { ssr: false, loading: () => <ControlLoadingFallback /> }
);

const OverviewView = dynamic(
  () => import('./overview-view').then(m => ({ default: m.OverviewView })),
  { ssr: false, loading: () => <ViewLoadingFallback /> }
);

const MetricsView = dynamic(
  () => import('./metrics-view').then(m => ({ default: m.MetricsView })),
  { ssr: false, loading: () => <ViewLoadingFallback /> }
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

// Compact loading fallback for controls
function ControlLoadingFallback() {
  return <div className="h-8 w-28 bg-gray-100 animate-pulse" />;
}

// Inner component that uses the filter context
function UnifiedAnalyticsContent() {
  const { viewMode, setViewMode, dateRange, setDateRange, selectedHabits, setSelectedHabits, toggleHabit, selectAllHabits, clearHabitSelection } = useAnalyticsFilters();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  // Modal states
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  
  // Overflow menu is handled by Radix DropdownMenu (no manual state needed)
  
  // Metrics view controls
  const [chartViewMode, setChartViewMode] = useState<'chart' | 'ticker'>('ticker');
  const [summaryPanelOpen, setSummaryPanelOpen] = useState(false);
  const [habitDropdownOpen, setHabitDropdownOpen] = useState(false);
  const habitDropdownButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  
  // Get habits context for refresh after creating/importing
  const { habits, habitLogs, fetchHabits, fetchHabitLogs } = useHabits();
  
  // Get AI context for chat
  const { showAIChat, isFullScreenChat } = useAI();
  
  // For optimistic updates via React Query
  const queryClient = useQueryClient();
  const { user, isLoaded: userLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();

  // Keep "Computer Use" habit in sync on dashboard load.
  // Guarded to avoid duplicate calls from StrictMode/remounts.
  useEffect(() => {
    let cancelled = false;

    const syncComputerUseHabit = async () => {
      if (typeof window !== 'undefined') {
        const inFlight = Boolean((window as any).__ritualComputerSyncInFlight);
        const lastSyncedAt = Number(sessionStorage.getItem(COMPUTER_SYNC_LAST_KEY) || '0');
        const tooSoon = Date.now() - lastSyncedAt < COMPUTER_SYNC_THROTTLE_MS;
        if (inFlight || tooSoon) {
          return;
        }
        (window as any).__ritualComputerSyncInFlight = true;
      }

      try {
        // Use lightweight single-day sync on page load. Backfills/reconcile should be manual.
        const response = await fetch('/api/watcher/sync-to-habit', { method: 'POST' });
        if (!response.ok) {
          return;
        }
        const result = await response.json();
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(COMPUTER_SYNC_LAST_KEY, String(Date.now()));
        }
        if (cancelled) {
          return;
        }
        if (result?.success && result?.synced) {
          await Promise.all([fetchHabits(), fetchHabitLogs()]);
        }
      } catch (error) {
        console.debug('Computer use sync failed:', error);
      } finally {
        if (typeof window !== 'undefined') {
          (window as any).__ritualComputerSyncInFlight = false;
        }
      }
    };

    if (userLoaded && isSignedIn) {
      syncComputerUseHabit();
    }

    return () => {
      cancelled = true;
    };
  }, [userLoaded, isSignedIn]);

  // Optional Weather background sync while app is active.
  // This never prompts for location; it runs only if permission is already granted.
  useEffect(() => {
    if (!userLoaded || !isSignedIn) {
      return;
    }

    let cancelled = false;

    const runWeatherAutoSync = async () => {
      if (cancelled) return;

      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      if (typeof window !== 'undefined') {
        const inFlight = Boolean((window as any).__ritualWeatherSyncInFlight);
        if (inFlight) return;
        (window as any).__ritualWeatherSyncInFlight = true;
      }

      try {
        const token = await getToken();
        if (!token) return;

        const now = Date.now();
        const lastLocalSync = typeof window !== 'undefined'
          ? Number(sessionStorage.getItem(WEATHER_AUTO_SYNC_LAST_KEY) || '0')
          : 0;
        if (now - lastLocalSync < WEATHER_AUTO_SYNC_INTERVAL_MS) {
          return;
        }

        const statusResponse = await fetch(`${PYTHON_API_BASE}/api/integrations/weather/status`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        if (!statusResponse.ok) return;

        const statusPayload = await statusResponse.json();
        if (!statusPayload?.enabled) return;

        if (statusPayload?.last_sync_at) {
          const lastServerSync = new Date(statusPayload.last_sync_at).getTime();
          if (Number.isFinite(lastServerSync) && now - lastServerSync < 30 * 60 * 1000) {
            return;
          }
        }

        const permission = await getLocationPermissionStatus();
        if (permission !== 'granted') {
          return;
        }

        const location = await requestCurrentLocation({
          timeoutMs: 10000,
          maximumAgeMs: 5 * 60 * 1000,
          enableHighAccuracy: false,
        });

        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const syncResponse = await fetch(`${PYTHON_API_BASE}/api/integrations/weather/sync`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lat: location.lat,
            lon: location.lon,
            tz,
            locationLabel: 'Near you',
            storePreciseLocation: false,
          }),
        });

        if (syncResponse.ok && typeof window !== 'undefined') {
          sessionStorage.setItem(WEATHER_AUTO_SYNC_LAST_KEY, String(now));
        }
      } catch (error) {
        console.debug('Weather background sync skipped:', error);
      } finally {
        if (typeof window !== 'undefined') {
          (window as any).__ritualWeatherSyncInFlight = false;
        }
      }
    };

    runWeatherAutoSync();
    const intervalId = setInterval(runWeatherAutoSync, WEATHER_AUTO_SYNC_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runWeatherAutoSync();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [userLoaded, isSignedIn, getToken]);
  
  // Load chart view mode from localStorage
  useEffect(() => {
    const savedViewMode = localStorage.getItem('analytics-view-mode');
    if (savedViewMode === 'chart' || savedViewMode === 'ticker') {
      setChartViewMode(savedViewMode);
    }
  }, []);
  
  // Persist chart view mode
  useEffect(() => {
    localStorage.setItem('analytics-view-mode', chartViewMode);
  }, [chartViewMode]);
  
  // Update dropdown position when opening
  useEffect(() => {
    if (habitDropdownOpen && habitDropdownButtonRef.current) {
      const rect = habitDropdownButtonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left
      });
    }
  }, [habitDropdownOpen]);
  
  
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
    if (viewParam === 'overview' || viewParam === 'metrics') {
      setViewMode(viewParam);
    }
  }, [searchParams, setViewMode]);
  
  // Update URL when view mode changes
  const handleViewChange = useCallback((newView: ViewMode) => {
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
  // Resolve portal targets on every render (after mount) so we never hold stale
  // DOM references. This is critical because router.replace() during view switching
  // can cause the Suspense boundary to re-suspend and remount the component,
  // which would leave the old cached references pointing at detached nodes.
  const headerRightSlot =
    typeof document !== 'undefined'
      ? document.getElementById('header-right-slot')
      : null;

  return (
    <div className="space-y-3">
      {/* + button (overview) + Date picker + View toggle — portalled into header right slot */}
      {!isFullScreenChat && headerRightSlot && createPortal(
        <>
          {viewMode === 'overview' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-8 w-8 border border-gray-300 shadow-sm bg-white text-gray-500 hover:text-gray-900 hover:bg-[#F5F5F5] transition-colors flex items-center justify-center rounded-none focus:outline-none"
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
          <ViewModeToggle
            currentView={viewMode}
            onViewChange={handleViewChange}
          />
        </>,
        headerRightSlot
      )}

      {/* Inline content-area controls (Spark/Bar, All) — metrics only */}
      {!isFullScreenChat && viewMode === 'metrics' && (
        <div className="flex items-center gap-2">
          <AnalyticsViewToggle
            currentView={chartViewMode}
            onViewChange={setChartViewMode}
            darkMode={false}
          />
          <div className="relative">
            <button
              ref={habitDropdownButtonRef}
              onClick={() => setHabitDropdownOpen(!habitDropdownOpen)}
              className="flex items-center gap-2 px-3 h-8 bg-white border border-gray-200 text-[13px] text-gray-600 hover:bg-[#F7F7F7] transition-colors"
            >
              <span>
                {selectedHabits.length === habits.length
                  ? 'All'
                  : `${selectedHabits.length} of ${habits.length}`
                }
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${habitDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
          <button
            onClick={() => setSummaryPanelOpen(prev => !prev)}
            className={`flex items-center justify-center w-8 h-8 border text-sm transition-colors ${
              summaryPanelOpen
                ? 'bg-gray-900 border-gray-900 text-white'
                : 'bg-white border-gray-200 text-gray-500 hover:bg-[#F7F7F7]'
            }`}
            title="Habit summary"
          >
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 3.5h11M2 7.5h11M2 11.5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}
      
      
      {/* Habit Filter Dropdown Portal */}
      {habitDropdownOpen && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setHabitDropdownOpen(false)}
          />
          <div
            className="fixed bg-white border border-gray-200 shadow-xl max-h-[400px] overflow-y-auto"
            style={{
              zIndex: 9999,
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              width: '220px'
            }}
          >
            <div className="p-1">
              <button
                onClick={() => {
                  if (selectedHabits.length === habits.length) {
                    clearHabitSelection();
                  } else {
                    selectAllHabits(habits.map(h => h.id).filter((id): id is string => !!id));
                  }
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-[#F7F7F7] border-b border-gray-200"
              >
                {selectedHabits.length === habits.length ? 'Deselect all' : 'Select all'}
              </button>
              {habits.filter(h => h.id).map((habit) => (
                <label
                  key={habit.id}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#F7F7F7] cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedHabits.includes(habit.id!)}
                    onChange={() => toggleHabit(habit.id!)}
                    className="analytics-checkbox"
                  />
                  <span className="text-sm text-gray-900">{habit.name}</span>
                </label>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
      
      {/* Content Area with smooth view switching */}
      <div className="relative min-h-[400px]">
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
            <OverviewView hideControls={true} />
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
              externalChartViewMode={chartViewMode}
              onChartViewModeChange={setChartViewMode}
              summaryPanelOpen={summaryPanelOpen}
              onSummaryPanelChange={setSummaryPanelOpen}
            />
          )}
        </div>
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
      
      {/* AI Habit Chat - Fixed at bottom, only visible in Overview mode */}
      {showAIChat && viewMode === 'overview' && (
        <div className="fixed bottom-0 left-[70px] right-0 flex justify-center px-4 sm:px-6 lg:px-8 pb-5 pt-3 bg-gradient-to-t from-white/90 via-white/60 to-transparent">
          <div className="w-full max-w-2xl">
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
                      await Promise.all([
                        fetchHabits(),
                        fetchHabitLogs()
                      ]);
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
export function UnifiedAnalyticsClient() {
  const searchParams = useSearchParams();
  const initialViewMode = getInitialViewMode(searchParams);
  
  return (
    <AnalyticsFilterProvider initialViewMode={initialViewMode}>
      <UnifiedAnalyticsContent />
    </AnalyticsFilterProvider>
  );
}
