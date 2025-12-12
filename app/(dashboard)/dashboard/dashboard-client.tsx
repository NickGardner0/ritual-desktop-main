"use client"

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Plus, X, LayoutDashboard } from 'lucide-react';
import * as Lucide from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { isWithinInterval, parseISO } from 'date-fns';
import { DateRangePicker } from "@/components/date-range-picker";
import { Spinner } from "@/components/ui/kibo-ui/spinner";
import { useHabits } from '@/contexts/HabitsContext';
import { useUser, useClerk, useAuth } from '@clerk/nextjs';
import { useAI } from '@/contexts/AIContext';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { analyticsApi, type HabitStats } from '@/lib/services/analytics-api';

import { Button } from "@/components/ui/button";
import type { Habit } from '@/contexts/HabitsContext';

// Lazy load heavy components that are only shown when user clicks
const HabitSelectionModal = lazy(() => import("@/components/habit-selection-modal").then(m => ({ default: m.HabitSelectionModal })));
const AIHabitChat = lazy(() => import("@/components/ai-habit-chat").then(m => ({ default: m.AIHabitChat })));

// Helper to convert kebab-case to PascalCase for Lucide icons
const kebabToPascal = (k: string) => k.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');

const HabitIcon = ({ iconName }: { iconName: string }) => {
  // Handle Lucide icons (kebab-case names)
  const IconComponent = (Lucide as any)[kebabToPascal(iconName)];

  if (IconComponent) {
    return <IconComponent className="w-5 h-5 text-black" />;
  }

  // Fallback to default icon
  return <LayoutDashboard className="w-5 h-5 text-black" />;
};

// Note: Old MUI dynamic loading code was removed to improve bundle size

// Habit icons mapping
const getHabitIcon = (name: string, category: string) => {
  const iconMap: { [key: string]: string } = {
    'deep work': '🧠',
    'lightning deep work': '⚡',
    'meditation': '🧘',
    'exercise': '💪',
    'reading': '📚',
    'journaling': '📝',
    'sleep': '😴',
    'water': '💧',
    'learning': '🎓',
    'coding': '💻',
    'writing': '✍️',
    'music': '🎵',
    'research': '🔍',
    'skill practice': '🎯',
    'cold showers': '🚿',
    'standup check-in': '📞'
  };

  const key = name.toLowerCase().replace(/\s+/g, ' ');
  return iconMap[key] || '📈';
};


export function DashboardClient() {
  const { user, isLoaded: userLoaded, isSignedIn } = useUser();
  const { isLoaded, signOut, getToken } = useAuth();
  const clerk = useClerk();
  const { showAIChat, chatMode, setChatMode, isFullScreenChat } = useAI();
  const {
    habits,
    habitLogs,
    isLoading,
    error,
    fetchHabits,
    fetchHabitLogs,
    deleteHabit
  } = useHabits();

  // Local UI state only
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [habitToDelete, setHabitToDelete] = useState<string | null>(null);
  const [deletingHabit, setDeletingHabit] = useState<string | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [optimisticLogs, setOptimisticLogs] = useState<any[]>([]); // Temporary logs for instant UI updates
  const [orderedHabits, setOrderedHabits] = useState<Habit[]>([]);

  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);

  // Cached stats from Python analytics API (single source of truth)
  const [cachedStats, setCachedStats] = useState<Record<string, HabitStats>>({});
  const [statsLoading, setStatsLoading] = useState(false);

  // Merge optimistic logs with real logs for display
  const displayLogs = React.useMemo(() => {
    return [...habitLogs, ...optimisticLogs];
  }, [habitLogs, optimisticLogs]);

  // Fetch stats from Python analytics API (single source of truth)
  useEffect(() => {
    const fetchStats = async () => {
      if (!habits.length) return;

      try {
        setStatsLoading(true);
        const token = await getToken();
        if (!token) return;

        // Build date params
        const params: { startDate?: string; endDate?: string; daysBack?: number } = {};
        if (dateRange?.from) {
          params.startDate = dateRange.from.toISOString().split('T')[0];
          if (dateRange.to) {
            params.endDate = dateRange.to.toISOString().split('T')[0];
          } else {
            params.endDate = params.startDate;
          }
        } else {
          // If no date range is selected (All Time), fetch all history
          // Using a large number (100 years) effectively gets all data
          params.daysBack = 36500;
        }

        const result = await analyticsApi.getHabitStats(token, params);

        if (result.success && result.habits) {
          // Index by habit ID for quick lookup
          const statsMap: Record<string, HabitStats> = {};
          result.habits.forEach(stat => {
            statsMap[stat.id] = stat;
          });
          setCachedStats(statsMap);
          console.log('📊 Stats fetched from Python API:', Object.keys(statsMap).length, 'habits');
        }
      } catch (error) {
        console.error('❌ Failed to fetch stats from Python API:', error);
      } finally {
        setStatsLoading(false);
      }
    };

    fetchStats();
  }, [habits, habitLogs.length, dateRange, getToken]);

  // Initialize ordered habits from localStorage or use habits from context
  useEffect(() => {
    if (habits.length > 0) {
      // Try to load saved order from localStorage
      const savedOrder = localStorage.getItem(`habit-order-${user?.id}`);
      if (savedOrder) {
        try {
          const orderArray: string[] = JSON.parse(savedOrder);
          // Sort habits according to saved order
          const sorted = [...habits].sort((a, b) => {
            const aIndex = orderArray.indexOf(a.id || '');
            const bIndex = orderArray.indexOf(b.id || '');
            // If habit not in saved order, put it at the end
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
          });
          setOrderedHabits(sorted);
        } catch (e) {
          // If parsing fails, just use habits as is
          setOrderedHabits(habits);
        }
      } else {
        // No saved order, use habits as is
        setOrderedHabits(habits);
      }
    }
  }, [habits, user?.id]);

  // Handle drag end
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const items = Array.from(orderedHabits);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setOrderedHabits(items);

    // Save order to localStorage
    const orderIds = items.map(h => h.id || '');
    localStorage.setItem(`habit-order-${user?.id}`, JSON.stringify(orderIds));
  };

  // Close tooltip when clicking outside or pressing escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (activeTooltip) {
        const target = event.target as Element;
        if (!target.closest('.tooltip-container')) {
          setActiveTooltip(null);
        }
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeTooltip) {
        setActiveTooltip(null);
      }
    };

    if (activeTooltip) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [activeTooltip]);

  // Load habit logs when component mounts (only once per user)
  const hasLoadedLogs = useRef(false);
  useEffect(() => {
    console.log('🔍 Checking if we should fetch habit logs:', {
      user: !!user,
      isLoading,
      habitLogsLength: habitLogs.length,
      hasLoadedLogs: hasLoadedLogs.current
    });

    if (user && !isLoading && habitLogs.length === 0 && !hasLoadedLogs.current) {
      console.log('🔄 Fetching habit logs on component mount...');
      hasLoadedLogs.current = true;
      fetchHabitLogs();
    }
  }, [user, isLoading, fetchHabitLogs]); // Add fetchHabitLogs dependency back

  // Debug effect to monitor habit logs
  useEffect(() => {
    console.log('📊 Habit logs updated:', {
      count: habitLogs.length,
      sample: habitLogs.slice(0, 3),
      habits: habits.length
    });
  }, [habitLogs, habits]);

  // Force fetch logs when habits are loaded (for debugging)
  useEffect(() => {
    if (habits.length > 0 && habitLogs.length === 0 && user) {
      console.log('🔧 Force fetching habit logs since we have habits but no logs...');
      fetchHabitLogs();
    }
  }, [habits.length, habitLogs.length, user, fetchHabitLogs]);

  // Monitor for timer widget updates
  useEffect(() => {
    if (typeof window === 'undefined' || !user) return;

    let intervalId: NodeJS.Timeout;
    let lastTimestamp = '';

    const checkForTimerUpdates = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const result = await invoke('check_dashboard_refresh_trigger') as string;

        if (result && result !== lastTimestamp) {
          console.log('🔄 Timer widget update detected, refreshing dashboard...');
          lastTimestamp = result;

          // Refresh both habits and logs
          await Promise.all([
            fetchHabits(),
            fetchHabitLogs()
          ]);

          console.log('✅ Dashboard refreshed after timer widget update');
        }
      } catch (error) {
        // Silently ignore errors (likely not in Tauri environment)
      }
    };

    // Check every 30 seconds for updates (reduced from 2 seconds to prevent excessive requests)
    intervalId = setInterval(checkForTimerUpdates, 30000);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [user]); // Remove function dependencies to prevent loops


  // Check onboarding status and prevent redirect if user has habits
  useEffect(() => {
    const checkOnboardingStatus = async () => {
      if (!user || onboardingChecked) return;

      try {
        // If user has habits, they've clearly completed onboarding
        if (habits.length > 0) {
          console.log('🎯 User has habits, skipping onboarding check');
          setOnboardingChecked(true);
          return;
        }

        console.log('🔍 Dashboard onboarding check - using new backend (skipping for now)');

        // For now, skip onboarding check since we're using Clerk + FastAPI backend
        // if (profile?.onboarding_completed === false) {
        //   router.push('/onboarding');
        //   return;
        // }
        // if (profile?.onboarding_completed === false) {
        //   console.log('🔄 Redirecting to onboarding from dashboard...');
        //   window.location.href = '/onboarding';
        // } else {
        //   setOnboardingChecked(true);
        // }
      } catch (error) {
        console.error('Error checking onboarding status in dashboard:', error);
        setOnboardingChecked(true);
      }
    };

    checkOnboardingStatus();
  }, [user, habits.length, onboardingChecked]);

  // Redirect to home page if user is not authenticated
  useEffect(() => {
    if (!!isLoaded && !user) {
      console.log('🔐 No user found, redirecting to home page...');
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
    }
  }, [!isLoaded, user]);


  // Get display text for habit metrics
  const getHabitMetricDisplay = React.useCallback((habit: Habit): string => {
    const unitType = habit.unit_type || 'sessions';

    // Debug logging disabled to reduce console noise
    // Uncomment if you need to debug habit metrics calculations

    // Filter logs based on date range - be more flexible with status
    let filteredLogs = displayLogs.filter(log => {
      const matchesHabit = log.habit_id === habit.id;
      const isCompleted = log.status === 'completed' || (log.status as any) === 'success' || !log.status; // Handle different status values

      // Removed excessive debug logging

      return matchesHabit && isCompleted;
    });


    // Apply date range filter if set
    if (dateRange?.from) {
      filteredLogs = filteredLogs.filter(log => {
        // Parse the log date (format: "2025-09-26")
        const logDate = parseISO(log.date);
        let isInRange = false;

        if (dateRange.to) {
          // For date ranges, use isWithinInterval
          isInRange = isWithinInterval(logDate, { start: dateRange.from!, end: dateRange.to });
        } else {
          // For single date, compare just the date part using string formatting to avoid timezone issues
          // dateRange.from is a Date object (local time)
          const filterDateStr = dateRange.from!.toLocaleDateString('en-CA'); // YYYY-MM-DD
          const logDateStr = typeof log.date === 'string' ? log.date.split('T')[0] : '';

          isInRange = logDateStr === filterDateStr;
        }


        return isInRange;
      });

    }

    if (filteredLogs.length === 0) {
      return `0 ${unitType}`;
    }

    // For time-based habits (Hours, Minutes), show total duration
    if (unitType.toLowerCase().includes('hour') || unitType.toLowerCase().includes('minute')) {
      // Always prioritize duration field (stored in seconds) over amount
      const totalDurationSeconds = filteredLogs.reduce((sum, log) => {
        // Duration is stored in seconds, amount might be in different units
        if (log.duration && log.duration > 0) {
          return sum + log.duration;
        } else if (log.amount && log.amount > 0) {
          // If no duration but has amount, convert based on the HABIT's unit_type (not log.unit which doesn't exist)
          // Screen Time and similar habits store amount directly in hours/minutes
          if (unitType.toLowerCase().includes('hour')) {
            return sum + (log.amount * 3600); // Convert hours to seconds
          } else if (unitType.toLowerCase().includes('minute')) {
            return sum + (log.amount * 60); // Convert minutes to seconds
          } else {
            return sum + log.amount; // Use amount directly for other units
          }
        }
        return sum;
      }, 0);

      // Convert to appropriate display unit based on habit's unit_type
      if (unitType.toLowerCase().includes('hour')) {
        const totalHours = Math.round((totalDurationSeconds / 3600) * 100) / 100;
        return `${totalHours} Hours`;
      } else {
        // Show total minutes (rounded)
        const totalMinutes = Math.round(totalDurationSeconds / 60);
        return `${totalMinutes} Minutes`;
      }
    }

    // For other units, show total sessions or amount
    const totalAmount = filteredLogs.reduce((sum, log) => sum + (log.amount || 1), 0);
    return `${totalAmount} ${unitType}`;
  }, [displayLogs, dateRange]);

  // Detailed stats for tooltip - uses cached stats from Python API (single source of truth)
  const getHabitMetricStats = React.useCallback((habit: Habit) => {
    const formatNum = (n: number) => {
      const rounded = Math.round(n * 100) / 100;
      return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
    };

    // Use cached stats from Python API
    const stats = cachedStats[habit.id || ''];

    if (stats) {
      // Stats from Python API (single source of truth)
      const unitLabel = stats.unit || habit.unit_type || 'sessions';
      return {
        unitLabel,
        sumFormatted: `${formatNum(stats.total)} ${unitLabel}`,
        avgFormatted: `${formatNum(stats.average)} ${unitLabel}`,
        minFormatted: `${formatNum(stats.min)} ${unitLabel}`,
        maxFormatted: `${formatNum(stats.max)} ${unitLabel}`,
        stdDevFormatted: `${formatNum(stats.std_dev || Math.sqrt(stats.variance || 0))} ${unitLabel}`,
        daysWithData: stats.days_with_data,
      };
    }

    // Fallback while loading or if API fails - show loading state
    const unitLabel = habit.unit_type || 'sessions';
    if (statsLoading) {
      return {
        unitLabel,
        sumFormatted: `Loading...`,
        avgFormatted: `Loading...`,
        minFormatted: `Loading...`,
        maxFormatted: `Loading...`,
        stdDevFormatted: `Loading...`,
      };
    }

    // No data available
    return {
      unitLabel,
      sumFormatted: `0 ${unitLabel}`,
      avgFormatted: `0 ${unitLabel}`,
      minFormatted: `0 ${unitLabel}`,
      maxFormatted: `0 ${unitLabel}`,
      stdDevFormatted: `0 ${unitLabel}`,
    };
  }, [cachedStats, statsLoading]);

  // Handle habit creation
  const handleHabitCreated = useCallback(async (newHabit: Habit) => {
    console.log('New habit created:', newHabit);
    // Refresh the habits list to show the new habit
    try {
      await fetchHabits();
      console.log('✅ Habits list refreshed after creating new habit');
    } catch (error) {
      console.error('❌ Error refreshing habits list:', error);
    }
  }, [fetchHabits]);

  // Handle habit deletion
  const confirmDelete = (habitId: string | undefined) => {
    if (!habitId) {
      console.error('❌ Cannot delete habit: No habit ID');
      return;
    }
    setHabitToDelete(habitId);
  };

  const cancelDelete = () => {
    setHabitToDelete(null);
  };

  const handleDeleteHabit = async (habitId: string | null) => {
    if (!habitId) {
      console.error('❌ Cannot delete habit: No habit ID provided');
      setHabitToDelete(null);
      return;
    }
    setDeletingHabit(habitId);
    try {
      console.log('🗑️ Deleting habit:', habitId);
      await deleteHabit(habitId);
      console.log('✅ Habit deleted successfully');
      setHabitToDelete(null);
    } catch (error) {
      console.error('❌ Failed to delete habit:', error);
    } finally {
      setDeletingHabit(null);
    }
  };

  // Handle logout using AuthContext
  const handleLogout = async () => {
    try {
      await signOut();
      console.log('✅ Logged out successfully');
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Show spinner while loading
  if (isLoading || !isLoaded || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="px-6 pt-3 pb-6 space-y-4">
      {/* Header with view controls - Hidden in Chat Mode */}
      {!isFullScreenChat && (
        <div className="flex items-center justify-end">
          <div className="flex items-center space-x-1">
            {/* Add Habit button */}
            <button
              onClick={() => setShowSelectionModal(true)}
              className="h-9 px-3 py-2 border border-gray-300 bg-white text-black hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] transition-colors rounded-none flex items-center justify-center"
            >
              <Plus className="w-4 h-4" />
            </button>

            {/* Date Range Picker - compact version */}
            <DateRangePicker
              className="w-auto"
              onDateRangeChange={setDateRange}
              initialDateRange={dateRange}
            />
          </div>
        </div>
      )}

      {/* Spacer between header and habits */}
      {!isFullScreenChat && <div className="h-4" />}

      {/* Habits List - Hidden in Chat Mode */}
      {!isFullScreenChat && (
        <div>
          <div className="max-w-[620px] mx-auto w-full">
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="habits">
                {(provided) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                  >
                    {orderedHabits.map((habit, index) => (
                      <Draggable key={habit.id} draggableId={habit.id || ''} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`w-full flex justify-between items-center h-8 px-1 group hover:bg-[#F7F7F7] bg-white cursor-grab active:cursor-grabbing ${snapshot.isDragging ? 'shadow-lg bg-[#F3F3F3] cursor-grabbing' : ''
                              }`}
                          >
                            <div className="flex items-center min-w-0 space-x-2">
                              <span
                                className="flex items-center justify-center w-6 h-6 flex-shrink-0"
                              >
                                {habit.icon ? (
                                  // Check if it's an emoji (contains emoji characters)
                                  /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(habit.icon) ? (
                                    <span className="text-xl">{habit.icon}</span>
                                  ) : (
                                    <HabitIcon iconName={habit.icon} />
                                  )
                                ) : (
                                  <span className="text-xl">{getHabitIcon(habit.name, habit.category)}</span>
                                )}
                              </span>
                              <span className="text-[17px] font-normal text-gray-900 truncate">{habit.name}</span>
                            </div>
                            <div
                              className="flex items-center space-x-2 cursor-default relative tooltip-container flex-shrink-0"
                              onClick={() => setActiveTooltip(activeTooltip === habit.id ? null : habit.id || '')}
                            >
                              <span className="text-[17px] font-normal text-gray-900 select-none tabular-nums">
                                {getHabitMetricDisplay(habit)}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); confirmDelete(habit.id); }}
                                disabled={deletingHabit === habit.id}
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-600 transition-all disabled:opacity-50"
                                title="Delete habit"
                              >
                                {deletingHabit === habit.id ? (
                                  <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                                ) : (
                                  <X className="w-3 h-3" />
                                )}
                              </button>
                              {activeTooltip === habit.id && (
                                <div className="absolute top-full right-0 mt-2 p-4 bg-white border border-gray-300 shadow-lg z-[999] min-w-[240px]">
                                  {(() => {
                                    const s = getHabitMetricStats(habit);
                                    return (
                                      <div className="space-y-1.5 text-sm">
                                        <div className="flex items-center justify-between">
                                          <span className="text-gray-900">Sum</span>
                                          <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.sumFormatted}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span className="text-gray-900">Average</span>
                                          <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.avgFormatted}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span className="text-gray-900">Min</span>
                                          <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.minFormatted}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span className="text-gray-900">Max</span>
                                          <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.maxFormatted}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span className="text-gray-900">Std Dev</span>
                                          <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.stdDevFormatted}</span>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>
        </div>
      )}

      {/* Empty state when no habits - Hidden in Chat Mode */}
      {chatMode === 'log' && habits.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] mt-8">
          <div className="text-xl mb-2 text-center" style={{ fontWeight: 500 }}>
            Connect your devices
          </div>
          <div className="text-sm font-normal mb-2 text-center max-w-xl leading-tight" style={{ fontWeight: 400, color: '#9C9C9D' }}>
            Connect your wearable devices to unlock personal insights.<br />Start tracking anything you want to get started.
          </div>
          <button
            onClick={() => setShowSelectionModal(true)}
            className="mt-2 px-3 py-2 bg-black text-white rounded-none text-sm font-normal hover:bg-gray-900 transition-colors shadow"
            style={{ fontWeight: 400 }}
          >
            Start Tracking
          </button>
        </div>
      )}

      {/* Habit Selection Modal */}
      {showSelectionModal && (
        <Suspense fallback={null}>
          <HabitSelectionModal
            isOpen={showSelectionModal}
            onClose={() => setShowSelectionModal(false)}
            onHabitCreated={handleHabitCreated}
          />
        </Suspense>
      )}

      {/* Delete Confirmation Modal */}
      {habitToDelete && (
        <div className="fixed inset-0 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-none max-w-md w-full mx-4 shadow-lg border border-gray-300">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Delete Habit</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this habit? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={cancelDelete}
                className="rounded-none px-3 py-1.5 text-sm hover:bg-[#F3F3F3] focus:bg-[#F3F3F3]"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleDeleteHabit(habitToDelete)}
                disabled={deletingHabit === habitToDelete}
                className="rounded-none bg-black hover:bg-gray-800 text-white px-3 py-1.5 text-sm"
              >
                {deletingHabit === habitToDelete ? (
                  <Spinner className="w-4 h-4" />
                ) : (
                  'Delete'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* AI Habit Chat - Conditionally rendered */}
      {showAIChat && (
        <div className="fixed bottom-0 left-16 right-0 flex justify-center px-4 sm:px-6 lg:px-8 pb-5 pt-3 bg-gradient-to-t from-white via-white/95 to-transparent">
          <div className="w-full max-w-2xl">
            <Suspense fallback={<div className="text-center py-4">Loading AI Chat...</div>}>
              <AIHabitChat
                onHabitUpdate={async (habitData) => {
                  console.log('🎯 Habit update from AI:', habitData);

                  if (habitData.optimisticUpdate) {
                    // Optimistic update: instantly add a temporary log to the UI
                    console.log('🚀 Optimistic update received, updating UI immediately...');

                    // Create a temporary log entry for instant feedback
                    if (habitData.habitId && (habitData.duration !== undefined || habitData.amount !== undefined)) {
                      const tempLog = {
                        id: `temp-${Date.now()}`, // Temporary ID
                        habit_id: habitData.habitId,
                        duration: habitData.duration ? habitData.duration * 60 : 0, // Convert minutes to seconds
                        amount: habitData.amount || null,
                        date: new Date().toISOString().split('T')[0],
                        completed_at: new Date().toISOString(),
                        status: 'completed' as const,
                        notes: habitData.notes || '',
                        unit: habitData.unit || ''
                      };

                      // Add temporary log to local state for instant UI update
                      setOptimisticLogs(prev => [...prev, tempLog]);
                      console.log('✅ Added temporary log to UI:', tempLog);
                    }

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
                    // Backend confirmed - now refresh from database and clear optimistic logs
                    console.log('🔄 Backend confirmed success, refreshing from database...');
                    try {
                      await Promise.all([
                        fetchHabits(),
                        fetchHabitLogs()
                      ]);
                      // Clear optimistic logs since we now have real data
                      setOptimisticLogs([]);
                      console.log('✅ Dashboard data refreshed after habit log, optimistic logs cleared');
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

