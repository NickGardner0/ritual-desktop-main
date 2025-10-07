"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, X, ChevronDown, Settings2 } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { isWithinInterval, parseISO } from 'date-fns';
import { HabitSelectionModal } from "@/components/habit-selection-modal";
import { DateRangePicker } from "@/components/date-range-picker";
import { Spinner } from "@/components/ui/kibo-ui/spinner";
import { AIHabitChat } from "@/components/ai-habit-chat";
import { useHabits } from '@/hooks/useHabits';
import { useAuth } from '@/contexts/AuthContext';
import { useAI } from '@/contexts/AIContext';
import * as LucideIcons from 'lucide-react';

import { Button } from "@/components/ui/button";
import type { Habit } from '@/contexts/HabitsContext';
import {
  Target, Lightning, Search, Config, Cog, Grid, List as ListIcon, Hand, Triangle, Circle, Rectangle, Hexagon, CheckSquare, XCircle, XOctagon, Dots,
  TelephoneIn, User as UserIcon, Users, Microphone, WifiCheck, WifiPlus, WifiSlash, BatteryChargingFour, HeartCircle, HeartPlus, BuildingOne, CalendarDown, ClockOne, ClockEight,
  Sunrise, Music, Wine, BookCheck, BookSnooze, BookSlash, Fire, PlayCircle, PauseCircle, RewindCircle, Like, Earth, Umbrella, Snow, LocationX, Dollar, DollarCircle, DollarDiamond, DollarOctagon, CartPlus,
  Lock, LockOpenKeyhole, LockKeyhole, LockOctagon, LockDiamond, FileMinus, FolderCheck, FolderSlash, ArrowDown, ArrowUpCircle, ArrowRightSquare, ArrowLongDownRight, ArrowLongUpRight,
  ChevronDown as ChevronDownIcon, ChevronDoubleLeft, ChevronDoubleRight, ChevronRightSquare, ChevronUpSquare, Home, CornerRightUp, CornerUpRight, Scissors, TrashTwo, CameraSlash, Incognito, Crosshair, Airplay,
  ChartLine, ChartBarOne, ChartBubble, ChartGraph, Columns, LayersTwo, GridOne, PanelRightClose, Sidebar, Zero, One, Two, Three, Four, Five, Six, Seven, Eight, Nine,
  ZeroHexagon, OneSquare, ThreeCircle, ThreeDiamond, ThreeOctagon, FiveCircle, FiveDiamond, FiveOctagon, SixWaves, SevenWaves, EightWaves, NineDiamond, NineOctagon,
  Bell, BellOn, BellHome, DangerCircle, InfoSquare, TypeBold, TypeItalic, TextJustify, TextAlignCenter, Heading, PlayWaves, PauseDiamond, PauseOctagon, RewindHexagon,
  BrandGithub, BrandGitlab, BrandCodesandbox, PlusWaves, LinkTwo, Logout, ToggleRight, Croissant, MobileSignalOne, CircleHalf, SlashWaves, Path, Hexagon as HexagonShape
} from "@mynaui/icons-react";

// MynaUI icons mapping
const MynaUIIcons: { [key: string]: React.ComponentType<any> } = {
  Target, Lightning, Search, Config, Cog, Grid, ListIcon, Hand, Triangle, Circle, Rectangle, Hexagon, CheckSquare, XCircle, XOctagon, Dots,
  TelephoneIn, UserIcon, Users, Microphone, WifiCheck, WifiPlus, WifiSlash, BatteryChargingFour, HeartCircle, HeartPlus, BuildingOne, CalendarDown, ClockOne, ClockEight,
  Sunrise, Music, Wine, BookCheck, BookSnooze, BookSlash, Fire, PlayCircle, PauseCircle, RewindCircle, Like, Earth, Umbrella, Snow, LocationX, Dollar, DollarCircle, DollarDiamond, DollarOctagon, CartPlus,
  Lock, LockOpenKeyhole, LockKeyhole, LockOctagon, LockDiamond, FileMinus, FolderCheck, FolderSlash, ArrowDown, ArrowUpCircle, ArrowRightSquare, ArrowLongDownRight, ArrowLongUpRight,
  ChevronDownIcon, ChevronDoubleLeft, ChevronDoubleRight, ChevronRightSquare, ChevronUpSquare, Home, CornerRightUp, CornerUpRight, Scissors, TrashTwo, CameraSlash, Incognito, Crosshair, Airplay,
  ChartLine, ChartBarOne, ChartBubble, ChartGraph, Columns, LayersTwo, GridOne, PanelRightClose, Sidebar, Zero, One, Two, Three, Four, Five, Six, Seven, Eight, Nine,
  ZeroHexagon, OneSquare, ThreeCircle, ThreeDiamond, ThreeOctagon, FiveCircle, FiveDiamond, FiveOctagon, SixWaves, SevenWaves, EightWaves, NineDiamond, NineOctagon,
  Bell, BellOn, BellHome, DangerCircle, InfoSquare, TypeBold, TypeItalic, TextJustify, TextAlignCenter, Heading, PlayWaves, PauseDiamond, PauseOctagon, RewindHexagon,
  BrandGithub, BrandGitlab, BrandCodesandbox, PlusWaves, LinkTwo, Logout, ToggleRight, Croissant, MobileSignalOne, CircleHalf, SlashWaves, Path, HexagonShape
};

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


export default function DashboardPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { showAIChat } = useAI();
  const { 
    habits, 
    habitLogs, 
    loading, 
    error,
    fetchHabits,
    fetchHabitLogs,
    deleteHabit,
    updateHabitLogOptimistically
  } = useHabits();
  
  // Local UI state only
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [habitToDelete, setHabitToDelete] = useState<string | null>(null);
  const [deletingHabit, setDeletingHabit] = useState<string | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);

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
    if (user && !loading && habitLogs.length === 0 && !hasLoadedLogs.current) {
      console.log('🔄 Fetching habit logs on component mount...');
      hasLoadedLogs.current = true;
      fetchHabitLogs();
    }
  }, [user, loading]); // Remove fetchHabitLogs dependency to prevent loops

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

        const { supabase } = await import('@/lib/supabase');
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('onboarding_completed')
          .eq('id', user.id)
          .single();
        
        console.log('🔍 Dashboard onboarding check - Profile:', profile);
        console.log('🔍 Dashboard onboarding check - Error:', error);
        
        if (profile?.onboarding_completed === false) {
          console.log('🔄 Redirecting to onboarding from dashboard...');
          window.location.href = '/onboarding';
        } else {
          setOnboardingChecked(true);
        }
      } catch (error) {
        console.error('Error checking onboarding status in dashboard:', error);
        setOnboardingChecked(true);
      }
    };

    checkOnboardingStatus();
  }, [user, habits.length, onboardingChecked]);

  // Redirect to home page if user is not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      console.log('🔐 No user found, redirecting to home page...');
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
    }
  }, [authLoading, user]);


  // Get display text for habit metrics
  const getHabitMetricDisplay = React.useCallback((habit: Habit): string => {
    const unitType = habit.unit_type || 'sessions';
    
    // Debug logging for Morning Workout
    if (habit.name === 'Morning Workout') {
      const allLogs = habitLogs.filter(log => log.habit_id === habit.id);
      const completedLogs = habitLogs.filter(log => log.habit_id === habit.id && log.status === 'completed');
      
      console.log('🔍 Morning Workout debug:');
      console.log('  - Habit ID:', habit.id);
      console.log('  - Unit Type:', unitType);
      console.log('  - All logs count:', allLogs.length);
      console.log('  - Completed logs count:', completedLogs.length);
      console.log('  - All logs:', allLogs);
      console.log('  - Completed logs:', completedLogs);
      
      // Show individual log details
      completedLogs.forEach((log, index) => {
        console.log(`  - Log ${index + 1}:`, {
          id: log.id,
          date: log.date,
          duration: log.duration,
          amount: log.amount,
          unit: log.unit,
          notes: log.notes
        });
      });
    }
    
    // Filter logs based on date range
    let filteredLogs = habitLogs.filter(log => 
      log.habit_id === habit.id && 
      log.status === 'completed'
    );
    
    
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
          // For single date, compare just the date part (ignore time)
          const logDateOnly = new Date(logDate.getFullYear(), logDate.getMonth(), logDate.getDate());
          const filterDateOnly = new Date(dateRange.from!.getFullYear(), dateRange.from!.getMonth(), dateRange.from!.getDate());
          isInRange = logDateOnly.getTime() === filterDateOnly.getTime(); // Use === for exact date match
        }
        
        
        return isInRange;
      });
      
    }
    
    if (filteredLogs.length === 0) {
      return `0 ${unitType}`;
    }
    
    // For time-based habits (Hours, Minutes), show total duration
    if (unitType.toLowerCase().includes('hour') || unitType.toLowerCase().includes('minute')) {
      // Check if we have amount (for Whoop data stored as hours) or duration (for manual logs in seconds)
      const hasAmountData = filteredLogs.some(log => log.amount !== null && log.amount !== undefined);
      
      if (hasAmountData) {
        // Sum up amount field (already in hours for Whoop data)
        const totalHours = filteredLogs.reduce((sum, log) => sum + (log.amount || 0), 0);
        const roundedHours = Math.round(totalHours * 100) / 100;
        return roundedHours >= 1 ? `${roundedHours} Hours` : `${Math.round(roundedHours * 60)} Minutes`;
      } else {
        // Sum up duration field (in seconds for manual logs)
        const totalDuration = filteredLogs.reduce((sum, log) => sum + (log.duration || 0), 0);
        const totalHours = Math.round((totalDuration / 3600) * 100) / 100;
        return totalHours >= 1 ? `${totalHours} Hours` : `${Math.round(totalDuration / 60)} Minutes`;
      }
    }
    
    // For other units, show total sessions or amount
    const totalAmount = filteredLogs.reduce((sum, log) => sum + (log.amount || 1), 0);
    return `${totalAmount} ${unitType}`;
  }, [habitLogs, dateRange]);

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
  const confirmDelete = (habitId: string) => {
    setHabitToDelete(habitId);
  };

  const cancelDelete = () => {
    setHabitToDelete(null);
  };

  const handleDeleteHabit = async (habitId: string) => {
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

  // Show loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Spinner className="w-8 h-8 mx-auto mb-4" />
          <p className="text-gray-600">Loading your habits...</p>
        </div>
      </div>
    );
  }

  // Show loading state if auth is still loading or no user
  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Spinner className="w-8 h-8 mx-auto mb-4" />
          <p className="text-gray-600">
            {authLoading ? 'Checking authentication...' : 'Redirecting to login...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header with view controls - matching web app layout */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center space-x-2">
          {/* Empty left side */}
        </div>
        
        <div className="flex items-center space-x-1">
          {/* Add Habit button */}
          <div className="relative group">
            <button
              onClick={() => setShowSelectionModal(true)}
              className="p-2 border border-gray-300 bg-white text-gray-600 hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] transition-colors rounded-none"
            >
              <Plus className="h-4 w-4" />
            </button>
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 text-xs text-black bg-white border border-gray-300 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
              Add habit
            </div>
          </div>
          
          {/* Date Range Picker - compact version */}
          <DateRangePicker 
            className="w-auto"
            onDateRangeChange={setDateRange}
            initialDateRange={dateRange}
          />
        </div>
      </div>

      {/* Habits List */}
      <div className="mt-6">
        <div className="max-w-4xl mx-auto px-2 w-full">
          <div className="space-y-1">
            {habits.map((habit, index) => (
              <div
                key={habit.id}
                className="w-full flex items-center py-1 group hover:bg-[#F3F3F3] bg-white cursor-default"
              >
                        <div className="flex items-center flex-1 min-w-0 space-x-1">
                          <span className="flex items-center justify-center" style={{ minWidth: 24 }}>
                            {habit.icon ? (
                              // Check if it's an emoji (contains emoji characters)
                              /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(habit.icon) ? (
                                <span className="text-xl">{habit.icon}</span>
                              ) : (
                                // Try to render as Lucide icon first, then MynaUI, then fallback
                                (() => {
                                  // Try Lucide icons
                                  const LucideIcon = (LucideIcons as any)[habit.icon];
                                  if (LucideIcon) {
                                    return React.createElement(LucideIcon, { className: 'w-5 h-5 text-black' });
                                  }
                                  
                                  // Try MynaUI icons
                                  const MynaIcon = MynaUIIcons[habit.icon];
                                  if (MynaIcon) {
                                    return React.createElement(MynaIcon, { className: 'w-5 h-5 text-black' });
                                  }
                                  
                                  // Fallback to default icon
                                  return React.createElement(LucideIcons.Target, { className: 'w-5 h-5 text-gray-400' });
                                })()
                              )
                            ) : (
                              <span className="text-xl">{getHabitIcon(habit.name, habit.category)}</span>
                            )}
                          </span>
                          <span className="text-base font-normal truncate">{habit.name}</span>
                        </div>
                        <div
                          className="flex items-center space-x-1 cursor-default relative ml-4 tooltip-container"
                          onClick={() => setActiveTooltip(activeTooltip === habit.id ? null : habit.id || '')}
                        >
                          <span className="text-base font-normal select-none">
                            {getHabitMetricDisplay(habit)}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); confirmDelete(habit.id || ''); }}
                            disabled={deletingHabit === habit.id}
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-600 transition-all disabled:opacity-50"
                            title="Delete habit"
                          >
                            {deletingHabit === habit.id ? (
                              <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                              <X className="h-3 w-3" />
                            )}
                          </button>
                          {activeTooltip === habit.id && (
                            <div className="absolute top-full right-0 mt-2 p-4 bg-white border border-gray-300 shadow-lg z-[999] min-w-[180px] whitespace-nowrap">
                              {/* Tooltip content here, matching table view */}
                              <div className="space-y-2 text-base">
                                <div className="flex items-center justify-between text-gray-700">
                                  <span className="text-black hover:text-gray-900 transition-colors cursor-default">Sum:</span>
                                  <span className="text-gray-500 font-mono hover:text-black transition-colors cursor-default">{getHabitMetricDisplay(habit)}</span>
                                </div>
                                <div className="flex items-center justify-between text-gray-700">
                                  <span className="text-black hover:text-gray-900 transition-colors cursor-default">Average:</span>
                                  <span className="text-gray-500 font-mono hover:text-black transition-colors cursor-default"></span>
                                </div>
                                <div className="flex items-center justify-between text-gray-700">
                                  <span className="text-black hover:text-gray-900 transition-colors cursor-default">Min:</span>
                                  <span className="text-gray-500 font-mono hover:text-black transition-colors cursor-default">0</span>
                                </div>
                                <div className="flex items-center justify-between text-gray-700">
                                  <span className="text-black hover:text-gray-900 transition-colors cursor-default">Max:</span>
                                  <span className="text-gray-500 font-mono hover:text-black transition-colors cursor-default"></span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                                    </div>
            ))}
          </div>
        </div>
      </div>

      {/* Empty state when no habits */}
      {habits.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] mt-8">
          <div className="text-xl mb-2 text-center" style={{ fontFamily: 'ppneuman, -apple-system, BlinkMacSystemFont, sans-serif', fontWeight: 500 }}>
            Connect your devices
          </div>
          <div className="text-sm font-normal mb-2 text-center max-w-xl leading-tight" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif', fontWeight: 400, color: '#9C9C9D' }}>
            Connect your wearable devices to unlock personal insights.<br />Start tracking anything you want to get started.
          </div>
          <button
            onClick={() => setShowSelectionModal(true)}
            className="mt-2 px-3 py-2 bg-black text-white rounded-none text-sm font-normal hover:bg-gray-900 transition-colors shadow"
            style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif', fontWeight: 400 }}
          >
            Start Tracking
          </button>
        </div>
      )}

      {/* Habit Selection Modal */}
      <HabitSelectionModal
        isOpen={showSelectionModal}
        onClose={() => setShowSelectionModal(false)}
        onHabitCreated={handleHabitCreated}
      />

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
                className="rounded-none px-4 py-2 text-sm hover:bg-[#F3F3F3] focus:bg-[#F3F3F3]"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleDeleteHabit(habitToDelete)}
                disabled={deletingHabit === habitToDelete}
                className="rounded-none bg-black hover:bg-gray-800 text-white px-4 py-2 text-sm"
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
        <div className="min-h-[60vh] flex items-end justify-center px-4 sm:px-6 lg:px-8 pb-12">
        <div className="w-full max-w-4xl">
          <AIHabitChat 
            onHabitUpdate={async (habitData) => {
              console.log('Habit update from AI:', habitData);
              
              if (habitData.optimisticUpdate) {
                // Instant optimistic update for immediate UI feedback
                console.log('🚀 Applying optimistic update:', habitData.optimisticUpdate);
                updateHabitLogOptimistically(habitData.optimisticUpdate);
                
                // Play success sound
                if (habitData.playSound) {
                  try {
                    // Create a pleasant success chime (like iPhone notification)
                    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                    
                    // Resume audio context if it's suspended (required by browsers)
                    if (audioContext.state === 'suspended') {
                      await audioContext.resume();
                    }
                    
                    const oscillator1 = audioContext.createOscillator();
                    const oscillator2 = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();
                    
                    // Create a chord with two frequencies
                    oscillator1.connect(gainNode);
                    oscillator2.connect(gainNode);
                    gainNode.connect(audioContext.destination);
                    
                    // Pleasant chord: C and E notes
                    oscillator1.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
                    oscillator2.frequency.setValueAtTime(659.25, audioContext.currentTime); // E5
                    
                    // Much louder volume with fade in and out
                    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
                    gainNode.gain.linearRampToValueAtTime(0.5, audioContext.currentTime + 0.1); // Much louder!
                    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.6);
                    
                    oscillator1.type = 'sine'; // Smooth sine wave
                    oscillator2.type = 'sine';
                    
                    oscillator1.start(audioContext.currentTime);
                    oscillator2.start(audioContext.currentTime);
                    oscillator1.stop(audioContext.currentTime + 0.6);
                    oscillator2.stop(audioContext.currentTime + 0.6);
                  } catch (e) {
                    // Fallback: Try using a simple beep
                    try {
                      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmEaAzGH0fPTgjMGHm7A7+OZURE');
                      audio.volume = 0.3;
                      await audio.play();
                    } catch (fallbackError) {
                      // Silent fail - sound is not critical
                    }
                  }
                }
                
                // Skip background sync for optimistic updates to prevent overwriting
                // The data is already in the database from the API call
                console.log('✅ Optimistic update applied, skipping background sync');
              } else if (habitData.success || habitData.refreshNeeded) {
                // Fallback to full refresh for older response format
                try {
                  await Promise.all([
                    fetchHabits(),
                    fetchHabitLogs()
                  ]);
                  console.log('✅ Dashboard data refreshed after AI habit update');
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
