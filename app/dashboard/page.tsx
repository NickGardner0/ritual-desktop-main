"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, X, List, Grid3X3, ChevronDown, Settings2 } from 'lucide-react';
import { HabitSelectionModal } from "@/components/habit-selection-modal";
import { Spinner } from "@/components/ui/kibo-ui/spinner";
import * as LucideIcons from 'lucide-react';

import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { User, Session } from '@supabase/supabase-js';
import {
  Target, Lightning, Search, Config, Cog, Grid, List as ListIcon, Hand, Triangle, Circle, Rectangle, Hexagon, CheckSquare, XCircle, XOctagon, Dots,
  MessageDots, TelephoneIn, User as UserIcon, Users, Microphone, WifiCheck, WifiPlus, WifiSlash, BatteryChargingFour, HeartCircle, HeartPlus, BuildingOne, CalendarDown, ClockOne, ClockEight,
  Sunrise, Music, Wine, BookCheck, BookSnooze, BookSlash, Fire, PlayCircle, PauseCircle, RewindCircle, Like, Earth, Umbrella, Snow, LocationX, Dollar, DollarCircle, DollarDiamond, DollarOctagon, CartPlus,
  Lock, LockOpenKeyhole, LockKeyhole, LockOctagon, LockDiamond, FileMinus, FolderCheck, FolderSlash, ArrowDown, ArrowUpCircle, ArrowRightSquare, ArrowLongDownRight, ArrowLongUpRight,
  ChevronDown as ChevronDownIcon, ChevronDoubleLeft, ChevronDoubleRight, ChevronRightSquare, ChevronUpSquare, Home, CornerRightUp, CornerUpRight, Scissors, TrashTwo, CameraSlash, Incognito, Crosshair, Airplay,
  ChartLine, ChartBarOne, ChartBubble, ChartGraph, Columns, LayersTwo, GridOne, PanelRightClose, Sidebar, Zero, One, Two, Three, Four, Five, Six, Seven, Eight, Nine,
  ZeroHexagon, OneSquare, ThreeCircle, ThreeDiamond, ThreeOctagon, FiveCircle, FiveDiamond, FiveOctagon, SixWaves, SevenWaves, EightWaves, NineDiamond, NineOctagon,
  Bell, BellOn, BellHome, DangerCircle, InfoSquare, TypeBold, TypeItalic, TextJustify, TextAlignCenter, Heading, PlayWaves, PauseDiamond, PauseOctagon, RewindHexagon,
  BrandGithub, BrandGitlab, BrandCodesandbox, PlusWaves, LinkTwo, Logout, ToggleRight, Croissant, MobileSignalOne, CircleHalf, SlashWaves, Path, Hexagon as HexagonShape
} from "@mynaui/icons-react";

// API configuration for desktop app
const API_BASE_URL = 'http://localhost:8000';

// Define types for our habits and logs
interface TrackedHabit {
  id: string;
  name: string;
  category: string;
  is_custom: boolean;
  unit_type?: string;
  created_at: string;
  user_id: string;
  icon?: string; // emoji or Lucide icon name
}

interface HabitLog {
  id: string;
  habit_id: string;
  date: string;
  duration?: number;
  amount?: number;
  status: 'completed' | 'skipped' | 'missed';
  notes?: string;
}

interface HabitMetrics {
  totalSessions: number;
  totalDuration: number; // in seconds
  currentStreak: number;
  completionRate: number;
  lastCompleted?: string;
}

// MynaUI icons mapping
const MynaUIIcons: { [key: string]: React.ComponentType<any> } = {
  Target, Lightning, Search, Config, Cog, Grid, ListIcon, Hand, Triangle, Circle, Rectangle, Hexagon, CheckSquare, XCircle, XOctagon, Dots,
  MessageDots, TelephoneIn, UserIcon, Users, Microphone, WifiCheck, WifiPlus, WifiSlash, BatteryChargingFour, HeartCircle, HeartPlus, BuildingOne, CalendarDown, ClockOne, ClockEight,
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
    'art': '🎨',
    'cooking': '👨‍🍳',
    'walking': '🚶',
    'stretching': '🤸',
    'mindfulness': '🧘‍♀️',
    'gratitude': '🙏',
    'planning': '📋',
    'creativity': '💡',
    'socializing': '👥',
    'workout': '🏋️',
    'running': '🏃',
    'productivity': '⚡',
    'focus': '🎯',
    'research': '🔍',
    'skill practice': '🎯',
    'cold showers': '🚿',
    'standup check-in': '📞'
  };
  
  const key = name.toLowerCase().replace(/\s+/g, ' ');
  return iconMap[key] || '📈';
};

// Define columns for the table - moved outside component to prevent recreation
const columns: ColumnDef<TrackedHabit>[] = [
  {
    id: "date",
    accessorFn: (row, index) => {
      // Mock date data - create a sortable date value using row index
      const mockDates = ["Jul 8", "Jul 7", "Jul 2", "Jul 2", "Jul 1", "Jun 30"];
      return mockDates[index % mockDates.length] || "Jul 8";
    },
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="cursor-pointer flex items-center hover:bg-gray-50 p-1 group"
        >
          Date
        </div>
      )
    },
    cell: ({ getValue }) => {
      return <div className="font-medium">{getValue() as string}</div>;
    },
  },
  {
    id: "time",
    accessorFn: (row, index) => {
      // Mock time data - create a sortable time value using row index
      const mockTimes = ["9:30 AM", "7:15 PM", "8:00 AM", "6:45 AM", "10:00 PM", "11:30 PM"];
      return mockTimes[index % mockTimes.length] || "9:30 AM";
    },
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="cursor-pointer flex items-center hover:bg-gray-50 p-1 group"
        >
          Time
        </div>
      )
    },
    cell: ({ getValue }) => {
      return <div className="font-medium">{getValue() as string}</div>;
    },
  },
  {
    accessorKey: "name",
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="cursor-pointer flex items-center hover:bg-gray-50 p-1 group"
        >
          Name
        </div>
      )
    },
    cell: ({ row }) => <div>{row.getValue("name")}</div>,
  },
  {
    accessorKey: "category",
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="cursor-pointer flex items-center hover:bg-gray-50 p-1 group"
        >
          Category
        </div>
      )
    },
    cell: ({ row }) => {
      const category = row.getValue("category") as string;
      return (
        <Badge variant="secondary" className="text-xs rounded-none">
          {category}
        </Badge>
      );
    },
  },
  {
    accessorKey: "actions",
    header: "Actions",
    cell: ({ row }) => {
      return (
        <div className="flex items-center space-x-2">
          <button
            onClick={() => console.log('Edit habit:', row.original.id)}
            className="text-blue-600 hover:text-blue-800"
          >
            Edit
          </button>
          <button
            onClick={() => console.log('Delete habit:', row.original.id)}
            className="text-red-600 hover:text-red-800"
          >
            Delete
          </button>
        </div>
      );
    },
  },
];

export default function DashboardPage() {
  const { user, signOut } = useAuth(); // Use AuthContext instead of local state
  const [trackedHabits, setTrackedHabits] = useState<TrackedHabit[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [habitMetrics, setHabitMetrics] = useState<Record<string, HabitMetrics>>({});
  const [loading, setLoading] = useState(true);
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [habitToDelete, setHabitToDelete] = useState<string | null>(null);
  const [deletingHabit, setDeletingHabit] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'table'>('list');
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'failed'>('checking');
  const [error, setError] = useState<string | null>(null);
  const hasFetchedHabits = useRef(false);

  // Table state for the new shadcn table
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState({});

  // Memoize table callbacks to prevent re-renders
  const onSortingChange = useCallback((updater: any) => setSorting(updater), []);
  const onColumnFiltersChange = useCallback((updater: any) => setColumnFilters(updater), []);
  const onColumnVisibilityChange = useCallback((updater: any) => setColumnVisibility(updater), []);
  const onRowSelectionChange = useCallback((updater: any) => setRowSelection(updater), []);

  const table = useReactTable({
    data: trackedHabits,
    columns,
    onSortingChange,
    onColumnFiltersChange,
    onColumnVisibilityChange,
    onRowSelectionChange,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  });

  // Test backend connection first
  const testConnection = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/habits/debug/test`);
      if (response.ok) {
        setConnectionStatus('connected');
        return true;
      } else {
        setConnectionStatus('failed');
        return false;
      }
    } catch (error) {
      setConnectionStatus('failed');
      return false;
    }
  };

  // Calculate metrics for a habit
  const calculateHabitMetrics = (habitId: string, logs: HabitLog[]): HabitMetrics => {
    const habitLogs = logs.filter(log => log.habit_id === habitId);
    const completedLogs = habitLogs.filter(log => log.status === 'completed');
    
    const totalSessions = completedLogs.length;
    const totalDuration = completedLogs.reduce((sum, log) => sum + (log.duration || 0), 0);
    
    // Calculate current streak (consecutive days with completed logs)
    let currentStreak = 0;
    if (completedLogs.length > 0) {
      const sortedLogs = completedLogs
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let currentDate = today;
      for (const log of sortedLogs) {
        const logDate = new Date(log.date);
        logDate.setHours(0, 0, 0, 0);
        
        const daysDiff = Math.floor((currentDate.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff <= 1) { // Same day or consecutive day
          currentStreak++;
          currentDate = logDate;
        } else {
          break; // Streak broken
        }
      }
    }
    
    // Calculate completion rate
    const completionRate = habitLogs.length > 0 ? (completedLogs.length / habitLogs.length) * 100 : 0;
    
    // Get last completed date
    const lastCompleted = completedLogs.length > 0 
      ? completedLogs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date 
      : undefined;
    
    return {
      totalSessions,
      totalDuration,
      currentStreak,
      completionRate,
      lastCompleted
    };
  };

  // Get display text for habit metrics
  const getHabitMetricDisplay = (habit: TrackedHabit): string => {
    const metrics = habitMetrics[habit.id];
    if (!metrics) return '0 sessions';
    
    // Check if this is a duration-based habit (meditation, deep work, etc.)
    const durationBasedHabits = ['meditation', 'deep work', 'reading', 'exercise', 'workout', 'learning', 'coding', 'writing'];
    const isDurationBased = durationBasedHabits.some(keyword => 
      habit.name.toLowerCase().includes(keyword)
    );
    
    if (isDurationBased && metrics.totalDuration > 0) {
      // Duration-based habits - show total time
      const formatDuration = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (hours > 0) {
          return `${hours}h ${minutes}m`;
        } else {
          return `${minutes}m`;
        }
      };
      
      return `${formatDuration(metrics.totalDuration)} total`;
    } else {
      // Count-based habits - show number of sessions
      return `${metrics.totalSessions} sessions`;
    }
  };

  // Fetch habits from FastAPI backend
  const fetchTrackedHabits = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Get current session for access token
      const { data: { session } } = await supabase.auth.getSession();
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
        console.log('🔐 Using Supabase token for API request');
        console.log('🔐 Token preview:', session.access_token.substring(0, 20) + '...');
      } else {
        console.log('❌ No Supabase session found for API request');
        throw new Error('No active session found. Please sign in again.');
      }
      
      // Fetch habits
      const habitsResponse = await fetch(`${API_BASE_URL}/habits`, {
        method: 'GET',
        headers,
      });
      
      if (!habitsResponse.ok) {
        const errorText = await habitsResponse.text();
        console.error('❌ API Error:', habitsResponse.status, errorText);
        throw new Error(`API Error: ${habitsResponse.status} - ${errorText}`);
      }
      
      const habitsData = await habitsResponse.json();
      console.log('✅ Habits fetched successfully:', habitsData);
      console.log('🔍 Habit details:', habitsData.map((habit: any) => ({
        name: habit.name,
        icon: habit.icon,
        category: habit.category,
        fallbackIcon: getHabitIcon(habit.name, habit.category)
      })));
      
      setTrackedHabits(habitsData);
      
      // Fetch habit logs for all habits
      const logsResponse = await fetch(`${API_BASE_URL}/habit-logs`, {
        method: 'GET',
        headers,
      });
      
      if (!logsResponse.ok) {
        const errorText = await logsResponse.text();
        console.error('❌ API Error fetching logs:', logsResponse.status, errorText);
        throw new Error(`API Error: ${logsResponse.status} - ${errorText}`);
      }
      
      const logsData = await logsResponse.json();
      console.log('✅ Habit logs fetched successfully:', logsData);
      
      // Calculate metrics for each habit using real log data
      const newMetrics: Record<string, HabitMetrics> = {};
      habitsData.forEach((habit: TrackedHabit) => {
        const metrics = calculateHabitMetrics(habit.id, logsData);
        console.log(`📊 Metrics for ${habit.name}:`, metrics);
        newMetrics[habit.id] = metrics;
      });
      setHabitMetrics(newMetrics);
      
    } catch (error) {
      console.error('❌ Error fetching habits:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch habits');
    } finally {
      setLoading(false);
    }
  }, []); // Empty dependency array since this function doesn't depend on any changing values

  // Handle habit creation from modal
  const handleHabitCreated = (newHabit: any) => {
    setTrackedHabits(prev => [...prev, newHabit]);
    setShowSelectionModal(false);
    // Refresh data to include the new habit
    fetchTrackedHabits();
  };

  // Refresh data function that can be called from other components
  const refreshData = useCallback(() => {
    fetchTrackedHabits();
  }, [fetchTrackedHabits]);

  // Refresh data when component mounts
  useEffect(() => {
    if (user) {
      fetchTrackedHabits();
    }
  }, [user, fetchTrackedHabits]);

  // Listen for timer updates and refresh data
  useEffect(() => {
    const handleTimerUpdate = () => {
      console.log('🔄 Timer session completed, refreshing dashboard data...');
      fetchTrackedHabits();
    };

    // Listen for storage events (when timer saves data)
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === 'ritual-timer-updated') {
          handleTimerUpdate();
        }
      });
    }

    // Also listen for custom events
    if (typeof window !== 'undefined') {
      window.addEventListener('ritual-timer-updated', handleTimerUpdate);
    }

    // Poll for Swift widget updates (check trigger file)
    let pollInterval: NodeJS.Timeout | null = null;
    let lastTriggerTime = 0;
    
    if (typeof window !== 'undefined') {
      pollInterval = setInterval(async () => {
        try {
          // Check if running in Tauri
          if (typeof window !== 'undefined' && (window as any).__TAURI__) {
            const { invoke } = await import('@tauri-apps/api/tauri');
            const triggerTime = await invoke('check_dashboard_refresh_trigger') as number;
            
            if (triggerTime > lastTriggerTime) {
              console.log('🔄 Swift widget triggered dashboard refresh...');
              lastTriggerTime = triggerTime;
              handleTimerUpdate();
            }
          }
        } catch (error) {
          // Silently ignore errors - polling is best effort
        }
      }, 2000); // Check every 2 seconds
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleTimerUpdate);
        window.removeEventListener('ritual-timer-updated', handleTimerUpdate);
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [fetchTrackedHabits]);

  // Handle habit deletion
  const handleDeleteHabit = async (habitId: string) => {
    try {
      setDeletingHabit(habitId);
      
      // Get current session for access token
      const { data: { session } } = await supabase.auth.getSession();
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      
      const response = await fetch(`${API_BASE_URL}/habits/${habitId}`, {
        method: 'DELETE',
        headers,
      });
      
      if (!response.ok) {
        throw new Error(`Failed to delete habit: ${response.status}`);
      }
      
      setTrackedHabits(prev => prev.filter(habit => habit.id !== habitId));
      setHabitMetrics(prev => {
        const newMetrics = { ...prev };
        delete newMetrics[habitId];
        return newMetrics;
      });
      
    } catch (error) {
      console.error('Error deleting habit:', error);
      setError(error instanceof Error ? error.message : 'Failed to delete habit');
    } finally {
      setDeletingHabit(null);
    }
  };

  const confirmDelete = (habitId: string) => {
    setHabitToDelete(habitId);
  };

  const cancelDelete = () => {
    setHabitToDelete(null);
  };



  // Fetch habits when user is available
  useEffect(() => {
    if (user && !hasFetchedHabits.current) {
      hasFetchedHabits.current = true;
      fetchTrackedHabits();
    }
  }, [user]); // Only depend on user, fetchTrackedHabits is stable with useCallback

  // Handle clicking outside to close tooltips
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (activeTooltip) {
        setActiveTooltip(null);
      }
    };

    if (activeTooltip) {
      if (typeof window !== 'undefined') {
        document.addEventListener('click', handleClickOutside);
      }
    }

    return () => {
      if (typeof window !== 'undefined') {
        document.removeEventListener('click', handleClickOutside);
      }
    };
  }, [activeTooltip]);

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
      setError('Failed to log out');
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

  // Show loading state if no user (prevent rendering dashboard without auth)
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Spinner className="w-8 h-8 mx-auto mb-4" />
          <p className="text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header with view controls - matching web app layout */}
      <div className="flex items-center justify-between mt-8">
        <div className="flex items-center space-x-2">
          {/* Empty left side for now */}
        </div>
        
        <div className="flex items-center space-x-1">

          
          {/* Add Habit button */}
          <div className="relative group">
            <button
              onClick={() => setShowSelectionModal(true)}
              className="p-2 border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors rounded-none"
            >
              <Plus className="h-4 w-4" />
            </button>
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 text-xs text-black bg-white border border-gray-300 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
              Add habit
            </div>
          </div>
          
          {/* List view button */}
          <div className="relative group">
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 border border-gray-300 transition-colors rounded-none ${
                viewMode === 'list' ? 'bg-black text-white' : 'bg-white text-black'
              }`}
            >
              <List className="h-4 w-4" />
            </button>
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 text-xs text-black bg-white border border-gray-300 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
              List
            </div>
          </div>
          
          {/* Table view button */}
          <div className="relative group">
            <button
              onClick={() => setViewMode('table')}
              className={`p-2 border border-gray-300 transition-colors rounded-none ${
                viewMode === 'table' ? 'bg-black text-white' : 'bg-white text-black'
              }`}
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 text-xs text-black bg-white border border-gray-300 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
              Table
            </div>
          </div>
        </div>
      </div>

      {/* Content based on view mode */}
      <div className="mt-6">
        {viewMode === 'list' ? (
        <div className="max-w-4xl mx-auto px-2 w-full">
          <div className="space-y-1">
            {trackedHabits.map((habit, index) => (
              <div
                key={habit.id}
                className="w-full flex items-center py-1 group hover:bg-gray-50 transition-all bg-white cursor-default"
              >
                        <div className="flex items-center flex-1 min-w-0 space-x-1">
                          <span className="flex items-center justify-center" style={{ minWidth: 24 }}>
                            {habit.icon ? (
                              // Check if it's an emoji (contains emoji characters)
                              /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(habit.icon) ? (
                                <span className="text-xl">{habit.icon}</span>
                              ) : (
                                // It's an icon name, try to render it as a MynaUI icon first, then Lucide
                                MynaUIIcons[habit.icon] ? (
                                  React.createElement(MynaUIIcons[habit.icon], { className: 'w-5 h-5 text-black' })
                                ) : (LucideIcons as any)[habit.icon] ? (
                                  React.createElement((LucideIcons as any)[habit.icon], { className: 'w-5 h-5 text-black' })
                                ) : (
                                  // Fallback to the icon name as text (for debugging)
                                  <span className="text-sm text-gray-500">{habit.icon}</span>
                                )
                              )
                            ) : (
                              <span className="text-xl">{getHabitIcon(habit.name, habit.category)}</span>
                            )}
                          </span>
                          <span className="text-base font-normal truncate">{habit.name}</span>
                        </div>
                        <div
                          className="flex items-center space-x-1 cursor-default relative ml-4"
                          onClick={() => setActiveTooltip(activeTooltip === habit.id ? null : habit.id)}
                        >
                          <span className="text-base font-normal select-none">
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
                              <X className="h-3 w-3" />
                            )}
                          </button>
                          {activeTooltip === habit.id && (
                            <div className="absolute top-full right-0 mt-2 p-4 bg-white border border-gray-300 shadow-lg z-[999] min-w-[180px] whitespace-nowrap">
                              {/* Tooltip content here, matching table view */}
                              <div className="space-y-2 text-base">
                                <div className="flex items-center justify-between text-gray-700">
                                  <span className="text-black hover:text-gray-900 transition-colors cursor-default">Sum:</span>
                                  <span className="text-gray-500 font-mono hover:text-black transition-colors cursor-default"></span>
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
      ) : (
        <div className="bg-white border border-gray-200 rounded-none">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="rounded-none">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="rounded-none">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="rounded-none">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center rounded-none">
                    No habits found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      </div>

      {/* Empty state when no habits */}
      {trackedHabits.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-none max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Delete Habit</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this habit? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={cancelDelete}
                className="rounded-none"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDeleteHabit(habitToDelete)}
                disabled={deletingHabit === habitToDelete}
                className="rounded-none"
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
    </div>
  );
} 