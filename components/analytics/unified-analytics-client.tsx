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

import React, { useState, useEffect, useCallback, lazy, Suspense, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Plus, Download, ChevronDown } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { DateRangePicker } from '@/components/date-range-picker';
import { ViewModeToggle, ViewMode } from './view-mode-toggle';
import { OverviewView } from './overview-view';
import { MetricsView } from './metrics-view';
import { AnalyticsFilterProvider, useAnalyticsFilters } from './analytics-filter-context';
import { useHabits } from '@/contexts/HabitsContext';
import { useAI } from '@/contexts/AIContext';
import { AnalyticsViewToggle } from './habit-ticker-view';

// Lazy load modals and AI chat
const HabitSelectionModal = lazy(() => import("@/components/habit-selection-modal").then(m => ({ default: m.HabitSelectionModal })));
const DataImportModal = lazy(() => import("@/components/data-import-modal").then(m => ({ default: m.DataImportModal })));
const AIHabitChat = lazy(() => import("@/components/ai-habit-chat").then(m => ({ default: m.AIHabitChat })));

// Inner component that uses the filter context
function UnifiedAnalyticsContent() {
  const { viewMode, setViewMode, dateRange, setDateRange, selectedHabits, setSelectedHabits, toggleHabit, selectAllHabits, clearHabitSelection } = useAnalyticsFilters();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  // Modal states
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  
  // Overflow menu state
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  const [overflowPosition, setOverflowPosition] = useState({ top: 0, right: 0 });
  
  // Metrics view controls
  const [chartViewMode, setChartViewMode] = useState<'chart' | 'ticker'>('ticker');
  const [habitDropdownOpen, setHabitDropdownOpen] = useState(false);
  const habitDropdownButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  
  // Get habits context for refresh after creating/importing
  const { habits, fetchHabits, fetchHabitLogs } = useHabits();
  
  // Get AI context for chat
  const { showAIChat, isFullScreenChat } = useAI();
  
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
  
  // Update overflow menu position
  useEffect(() => {
    if (showOverflowMenu && overflowButtonRef.current) {
      const rect = overflowButtonRef.current.getBoundingClientRect();
      setOverflowPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right
      });
    }
  }, [showOverflowMenu]);
  
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

  return (
    <div className="space-y-3">
      {/* Header Row */}
      {!isFullScreenChat && (
        <div className="flex items-center justify-between gap-4 -mt-2">
          {/* Left side - Metrics-specific controls */}
          <div className="flex items-center gap-3">
            {viewMode === 'metrics' && (
              <>
                {/* Spark/Bar Toggle */}
                <AnalyticsViewToggle
                  currentView={chartViewMode}
                  onViewChange={setChartViewMode}
                  darkMode={false}
                />
                
                {/* Habit Filter Dropdown */}
                <div className="relative">
                  <button
                    ref={habitDropdownButtonRef}
                    onClick={() => setHabitDropdownOpen(!habitDropdownOpen)}
                    className="flex items-center gap-2 px-3 h-9 bg-white border border-gray-200 text-sm text-gray-600 hover:bg-[#F7F7F7] transition-colors"
                  >
                    <span>
                      {selectedHabits.length === habits.length
                        ? 'All habits'
                        : `${selectedHabits.length} of ${habits.length}`
                      }
                    </span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${habitDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </>
            )}
          </div>
          
          {/* Right side controls - Add (overview only) + Date picker + View toggle */}
          <div className="flex items-center gap-2">
            {/* Add menu button - Only in Overview mode */}
            {viewMode === 'overview' && (
              <div className="relative">
                <button
                  ref={overflowButtonRef}
                  onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                  className="h-9 w-9 border border-gray-200 bg-white text-gray-500 hover:text-gray-900 hover:bg-[#F7F7F7] transition-colors flex items-center justify-center"
                  aria-label="Add"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            )}
            
            {/* Date Range Picker */}
            <DateRangePicker
              className="w-auto"
              onDateRangeChange={setDateRange}
              initialDateRange={dateRange}
            />
            
            {/* View Toggle - Primary control, furthest right */}
            <ViewModeToggle
              currentView={viewMode}
              onViewChange={handleViewChange}
            />
          </div>
        </div>
      )}
      
      {/* Overflow Menu Portal */}
      {showOverflowMenu && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setShowOverflowMenu(false)}
          />
          <div
            className="fixed bg-white border border-gray-200 shadow-xl py-1 min-w-[160px]"
            style={{
              zIndex: 9999,
              top: overflowPosition.top,
              right: overflowPosition.right
            }}
          >
            <button
              onClick={() => {
                setShowSelectionModal(true);
                setShowOverflowMenu(false);
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-[#F7F7F7] flex items-center gap-3"
            >
              <Plus className="w-4 h-4" />
              Add habit
            </button>
            <button
              onClick={() => {
                setShowImportModal(true);
                setShowOverflowMenu(false);
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-[#F7F7F7] flex items-center gap-3"
            >
              <Download className="w-4 h-4" />
              Import data
            </button>
          </div>
        </>,
        document.body
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
            <OverviewView hideControls={true} />
          )}
        </div>
        
        {/* Metrics View */}
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
            />
          )}
        </div>
      </div>
      
      {/* Modals */}
      {showSelectionModal && (
        <Suspense fallback={null}>
          <HabitSelectionModal
            isOpen={showSelectionModal}
            onClose={() => setShowSelectionModal(false)}
            onHabitCreated={handleHabitCreated}
          />
        </Suspense>
      )}

      {showImportModal && (
        <Suspense fallback={null}>
          <DataImportModal
            isOpen={showImportModal}
            onClose={() => setShowImportModal(false)}
            onImportComplete={() => {
              fetchHabits();
              fetchHabitLogs();
            }}
          />
        </Suspense>
      )}
      
      {/* AI Habit Chat - Fixed at bottom, only visible in Overview mode */}
      {showAIChat && viewMode === 'overview' && (
        <div className="fixed bottom-0 left-16 right-0 flex justify-center px-4 sm:px-6 lg:px-8 pb-5 pt-3 bg-gradient-to-t from-white via-white/95 to-transparent">
          <div className="w-full max-w-2xl">
            <Suspense fallback={<div className="text-center py-4">Loading AI Chat...</div>}>
              <AIHabitChat
                onHabitUpdate={async (habitData) => {
                  console.log('🎯 Habit update from AI:', habitData);
                  if (habitData.refreshNeeded) {
                    try {
                      await Promise.all([
                        fetchHabits(),
                        fetchHabitLogs()
                      ]);
                      console.log('✅ Dashboard data refreshed after habit log');
                    } catch (error) {
                      console.error('❌ Error refreshing dashboard data:', error);
                    }
                  }
                }}
              />
            </Suspense>
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
