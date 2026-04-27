'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { 
  ChevronDown, 
  CheckCircle, 
  X, 
  Calendar, 
  ChartLine,
  Brain,
  Heart,
  FlaskConical,
  Plus,
  Monitor
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useHabits } from '@/contexts/HabitsContext';
import type { Habit as StoredHabit } from '@/contexts/HabitsContext';
import { useAuth, useUser } from '@clerk/nextjs';
import { habitKeys } from '@/hooks/use-habits-query';
import MiniSearch from 'minisearch';
import {
  productivityHabits,
  fitnessHealthHabits,
  educationHabits,
  experimentsHabits,
  type Habit
} from '../data/habits-data';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { isTauri } from '@/lib/tauri-utils';
import { ensureComputerTimeHabit } from '@/lib/ensure-computer-time-habit';


/** Fixed width so Connect / Manual / Connected columns align across rows */
const connectRowActionClass =
  'inline-flex h-8 w-[8.5rem] shrink-0 items-center justify-center rounded-sm border border-gray-200 bg-white px-2 text-sm font-normal text-gray-600 transition-colors hover:bg-gray-50';

const connectRowActionConnectedClass =
  'inline-flex h-8 w-[8.5rem] shrink-0 items-center justify-center rounded-sm bg-[#73bf1d] px-2 text-sm font-normal text-white transition-colors hover:bg-[#5fa018]';

interface HabitSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onHabitSelect?: (habit: any) => void;
  onHabitCreated?: (habit: any) => void;
  initialCategory?: string | null;
}

type WatcherStatus = {
  is_running?: boolean;
  device_id?: string | null;
};

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

// Map frontend categories to backend categories
const categoryMap: Record<string, string> = {
  'productivity': 'Productivity',
  'fitness': 'Health',
  'education': 'Education',
  'experiments': 'Experiments',
  'custom': 'Custom'
};

export function HabitSelectionModal({ isOpen, onClose, onHabitSelect, onHabitCreated, initialCategory = null }: HabitSelectionModalProps): React.ReactElement | null {
  const queryClient = useQueryClient();
  const { createHabit, habits, fetchHabits } = useHabits();
  const { getToken, userId } = useAuth();
  const { user } = useUser();
  /** `useAuth().userId` can be undefined briefly; settings need a real id */
  const resolvedUserId = userId ?? user?.id ?? null;
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(initialCategory);
  const [showComputerTracking, setShowComputerTracking] = useState(false);
  const [computerTrackingConnected, setComputerTrackingConnected] = useState(false);
  const [isAddingComputerHabit, setIsAddingComputerHabit] = useState(false);
  
  // Update category when initialCategory prop changes and modal opens
  React.useEffect(() => {
    if (initialCategory && isOpen) {
      setSelectedCategory(initialCategory);
    }
  }, [initialCategory, isOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      setIsAddingComputerHabit(false);
      setShowComputerTracking(false);
    }
  }, [isOpen]);

  const [selectedHabit, setSelectedHabit] = React.useState<any | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showCustomization, setShowCustomization] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState('Count');
  const [isMetricDropdownOpen, setIsMetricDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(''); // Search state
  const [customHabitName, setCustomHabitName] = useState(''); // For custom habit input
  const metricDropdownRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const floatingLayerRef = useRef<HTMLDivElement>(null);
  const metricBtnRef = useRef<HTMLButtonElement>(null);
  
  // Function to get habits for a category - MUST be defined before useMemo hooks
  const getHabitsForCategory = (category: string) => {
    switch (category) {
      case 'applewatch':
        return [
          // Activity
          { value: '_section_activity', label: 'Activity', section: true },
          { value: 'steps', label: 'Steps', metric_type: 'steps', unit: 'Steps' },
          { value: 'active-energy', label: 'Active Calories', metric_type: 'active_energy', unit: 'Calories' },
          { value: 'basal-energy', label: 'Resting Calories', metric_type: 'basal_energy', unit: 'Calories' },
          { value: 'distance', label: 'Distance', metric_type: 'distance', unit: 'Miles' },
          { value: 'flights-climbed', label: 'Flights Climbed', metric_type: 'flights_climbed', unit: 'Count' },
          { value: 'exercise-time', label: 'Exercise Minutes', metric_type: 'exercise_time', unit: 'Minutes' },
          { value: 'stand-time', label: 'Stand Time', metric_type: 'stand_time', unit: 'Minutes' },
          // Heart
          { value: '_section_heart', label: 'Heart', section: true },
          { value: 'heart-rate', label: 'Heart Rate', metric_type: 'hr', unit: 'BPM' },
          { value: 'hrv', label: 'Heart Rate Variability (HRV)', metric_type: 'hrv', unit: 'HRV' },
          { value: 'resting-hr', label: 'Resting Heart Rate', metric_type: 'resting_hr', unit: 'BPM' },
          { value: 'walking-hr', label: 'Walking Heart Rate', metric_type: 'walking_hr', unit: 'BPM' },
          // Sleep & Recovery
          { value: '_section_sleep', label: 'Sleep & Recovery', section: true },
          { value: 'sleep', label: 'Sleep Duration', metric_type: 'sleep_session', unit: 'Hours Slept' },
          { value: 'sleep-rem', label: 'REM Sleep', metric_type: 'sleep_rem', unit: 'Minutes' },
          { value: 'sleep-deep', label: 'Deep Sleep', metric_type: 'sleep_deep', unit: 'Minutes' },
          { value: 'sleep-core', label: 'Core Sleep', metric_type: 'sleep_core', unit: 'Minutes' },
          // Respiratory & Blood
          { value: '_section_respiratory', label: 'Respiratory & Blood', section: true },
          { value: 'blood-oxygen', label: 'Blood Oxygen (SpO2)', metric_type: 'oxygen_saturation', unit: 'Percentage' },
          { value: 'respiratory-rate', label: 'Respiratory Rate', metric_type: 'respiratory_rate', unit: 'Count' },
          // Mobility
          { value: '_section_mobility', label: 'Mobility', section: true },
          { value: 'walking-speed', label: 'Walking Speed', metric_type: 'walking_speed', unit: 'm/s' },
          { value: 'step-length', label: 'Step Length', metric_type: 'walking_step_length', unit: 'cm' },
          { value: 'walking-asymmetry', label: 'Walking Asymmetry', metric_type: 'walking_asymmetry', unit: 'Percentage' },
          // Workouts & Mindfulness
          { value: '_section_workouts', label: 'Workouts & Mindfulness', section: true },
          { value: 'workouts', label: 'Workouts', metric_type: 'workout', unit: 'Count' },
          { value: 'mindful-minutes', label: 'Mindful Minutes', metric_type: 'mindful_minutes', unit: 'Minutes' },
        ];
      case 'oura':
        return [
          { value: 'sleep-score', label: 'Sleep Score' },
          { value: 'readiness', label: 'Readiness Score' },
          { value: 'activity', label: 'Activity Score' }
        ];
      case 'whoop':
        return [
          { value: 'recovery', label: 'Recovery Score', metric_type: 'recovery_score', unit: 'Count' },
          { value: 'sleep-duration', label: 'Sleep Duration', metric_type: 'sleep_total', unit: 'Hours' },
          { value: 'sleep-performance', label: 'Sleep Performance' },
          { value: 'bedtime', label: 'Bedtime' },
          { value: 'wake-time', label: 'Wake Time' },
          { value: 'heart-rate', label: 'Heart Rate', metric_type: 'heart_rate', unit: 'BPM' },
          { value: 'strain', label: 'Daily Strain', metric_type: 'strain_score', unit: 'Count' },
          { value: 'resting-hr', label: 'Resting Heart Rate', metric_type: 'resting_heart_rate', unit: 'BPM' },
          { value: 'hrv', label: 'Heart Rate Variability (HRV)', metric_type: 'hrv', unit: 'HRV' },
          { value: 'steps', label: 'Daily Steps', metric_type: 'steps', unit: 'Steps' }
        ];
      case 'fitbit':
        return [
          { value: 'steps', label: 'Daily Steps' },
          { value: 'heart-rate', label: 'Heart Rate' },
          { value: 'sleep', label: 'Sleep Duration' },
          { value: 'active-minutes', label: 'Active Minutes' },
          { value: 'calories', label: 'Calories Burned' },
          { value: 'distance', label: 'Distance' }
        ];
      case 'garmin':
        return [
          { value: 'vo2-max', label: 'VO2 Max' },
          { value: 'training-load', label: 'Training Load' },
          { value: 'body-battery', label: 'Body Battery' }
        ];
      case 'plaid':
        return [
          { value: 'spending', label: 'Daily Spending', metric_type: 'spending', unit: 'Dollars' },
          { value: 'income', label: 'Income', metric_type: 'income', unit: 'Dollars' },
          { value: 'savings', label: 'Savings Rate', metric_type: 'savings_rate', unit: 'Percentage' },
        ];
      case 'productivity':
        return productivityHabits || [];
      case 'fitness':
        return fitnessHealthHabits || [];
      case 'education':
        return educationHabits || [];
      case 'experiments':
        return experimentsHabits || [];
      default:
        return [];
    }
  };
  
  // Initialize MiniSearch for fuzzy search - memoized to only create once
  const miniSearch = useMemo(() => {
    try {
      const instance = new MiniSearch<Habit & { id: number }>({
        fields: ['label', 'category'],
        storeFields: ['value', 'label', 'category'],
        searchOptions: {
          boost: { label: 2 },
          fuzzy: 0.2,
          prefix: true
        }
      });

      // Index all habits
      const allHabitsForSearch = [
        ...(productivityHabits || []),
        ...(fitnessHealthHabits || []),
        ...(educationHabits || []),
        ...(experimentsHabits || [])
      ];

      const indexedHabits = allHabitsForSearch.map((habit, index) => ({
        id: index,
        ...habit
      }));

      if (indexedHabits.length > 0) {
        instance.addAll(indexedHabits);
      }
      
      return instance;
    } catch (error) {
      console.error('Error initializing MiniSearch:', error);
      // Return a minimal instance that won't crash
      return new MiniSearch<Habit & { id: number }>({
        fields: ['label', 'category'],
        storeFields: ['value', 'label', 'category']
      });
    }
  }, []); // Only initialize once
  
  // MiniSearch fuzzy search with fallback
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !selectedCategory) return [];
    
    try {
      const results = miniSearch.search(searchQuery, {
        filter: (result) => {
          const categoryMatch: { [key: string]: string } = {
            'productivity': 'productivity',
            'fitness': 'fitness',
            'education': 'education',
            'experiments': 'experiments'
          };
          return result.category === categoryMatch[selectedCategory];
        }
      });
      
      return results.map(result => ({
        value: result.value,
        label: result.label
      }));
    } catch (error) {
      console.error('Error searching with MiniSearch:', error);
      // Fallback to simple search if MiniSearch fails
      const categoryHabits = getHabitsForCategory(selectedCategory);
      const query = searchQuery.toLowerCase().trim();
      return categoryHabits.filter((habit: any) =>
        !habit.section && (
          habit.label.toLowerCase().includes(query) ||
          habit.value.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, selectedCategory, miniSearch]);
  
  // Get habits for display (search results or all category habits)
  const displayedHabits = useMemo(() => {
    if (searchQuery.trim() && searchResults.length > 0) {
      return searchResults;
    }
    if (searchQuery.trim() && searchResults.length === 0) {
      return []; // Show "no results"
    }
    return getHabitsForCategory(selectedCategory || '');
  }, [searchQuery, searchResults, selectedCategory]);
  
  // Constrain metric dropdown to card bounds
  function useFloatingWithinCard(
    open: boolean,
    anchorRef: React.RefObject<HTMLElement | null>,
    cardRef: React.RefObject<HTMLElement | null>,
    desiredWidth = 320,
    minHeight = 200,
    maxDropdownHeight = 320
  ) {
    const [style, setStyle] = React.useState<React.CSSProperties>({});

    React.useLayoutEffect(() => {
      if (!open || !anchorRef.current || !cardRef.current) return;

      const anchorRect = anchorRef.current.getBoundingClientRect();
      const cardRect = cardRef.current.getBoundingClientRect();

      const margin = 8;
      const width = Math.max(desiredWidth, anchorRect.width);

      const spaceBelow = cardRect.bottom - anchorRect.bottom - margin;
      const spaceAbove = anchorRect.top - cardRect.top - margin;
      const openUp = spaceBelow < minHeight && spaceAbove > spaceBelow;

      const maxHeight = Math.min(
        maxDropdownHeight,
        Math.floor(openUp ? spaceAbove - 8 : spaceBelow - 8)
      );

      const left = Math.min(
        Math.max(anchorRect.left - cardRect.left, margin),
        cardRect.width - width - margin
      );

      const top = openUp
        ? anchorRect.top - cardRect.top - maxHeight - 4
        : anchorRect.bottom - cardRect.top + 4;

      setStyle({
        position: 'absolute',
        left,
        top,
        width,
        maxHeight,
        overflowY: 'auto',
        pointerEvents: 'auto',
        borderRadius: 2,
        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
        background: 'white',
        border: '1px solid #e5e7eb',
      });
    }, [open, anchorRef, cardRef, desiredWidth, minHeight, maxDropdownHeight]);

    return style;
  }

  const metricStyle = useFloatingWithinCard(
    isMetricDropdownOpen,
    metricBtnRef,
    cardRef,
    384,
    160,
    280
  );

  // Add ESC key handler and click outside handler
    React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (!isMetricDropdownOpen) return;
      const target = event.target as Node;
      if (metricDropdownRef.current?.contains(target)) return;
      if ((event.target as Element).closest?.('[data-metric-dropdown]')) return;
      setIsMetricDropdownOpen(false);
    };

      if (isOpen) {
        document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
          document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen, isMetricDropdownOpen, onClose]);


  const handleHabitClick = async (habit: { value: string; label: string }) => {
    setSelectedHabit(habit);
    setShowCustomization(true);
  };

  // State for Whoop connection
  const [whoopConnected, setWhoopConnected] = useState(false);
  const [whoopConnecting, setWhoopConnecting] = useState(false);
  
  // State for Apple Watch connection
  const [appleWatchConnected, setAppleWatchConnected] = useState(false);
  const [appleWatchDeviceName, setAppleWatchDeviceName] = useState<string | null>(null);
  const [ouraConnected, setOuraConnected] = useState(false);
  const [garminConnected, setGarminConnected] = useState(false);
  const [plaidConnected, setPlaidConnected] = useState(false);

  const checkComputerTrackingConnection = useCallback(async () => {
    try {
      const response = await fetchWithTimeout('/api/watcher/devices', {}, 5000);
      if (response.ok) {
        const data = await response.json();
        const devices = data.devices || [];
        const hasEnabledDevice = devices.some((d: any) => d.is_enabled);
        if (hasEnabledDevice || devices.length > 0) {
          setComputerTrackingConnected(true);
          return;
        }
      }

      if (isTauri()) {
        const watcherStatus = await withTimeout(
          invoke<WatcherStatus>('get_watcher_status').catch(() => null),
          2500,
          null,
        );
        const localWatcherConnected = Boolean(watcherStatus?.is_running || watcherStatus?.device_id);
        setComputerTrackingConnected(localWatcherConnected);
        return;
      }

      setComputerTrackingConnected(false);
    } catch (error) {
      console.error('Error checking Computer Use connection:', error);
      setComputerTrackingConnected(false);
    }
  }, []);

  const refreshProviderConnectionStatuses = useCallback(async () => {
    try {
      const token = await getToken();
      const authHeaders: HeadersInit = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const fetchJson = async (path: string, fallback: any) => {
        try {
          const response = await fetchWithTimeout(path, { headers: authHeaders }, 5000);
          if (!response.ok) return fallback;
          return await response.json();
        } catch {
          return fallback;
        }
      };

      const [
        whoopData,
        appleDevicesData,
        wearablesData,
        financialData,
      ] = await Promise.all([
        fetchJson('/api/integrations/whoop/status', { connected: false }),
        fetchJson('/api/wearables/apple/devices', { devices: [] }),
        fetchJson('/api/wearables/connections', { connections: [] }),
        fetchJson('/api/financial/connections', { connections: [] }),
      ]);

      setWhoopConnected(Boolean(whoopData?.connected));

      const activeAppleDevices = (appleDevicesData?.devices || []).filter((device: any) => device.is_active && device.platform === 'ios');
      setAppleWatchConnected(activeAppleDevices.length > 0);
      setAppleWatchDeviceName(activeAppleDevices[0]?.device_name || null);

      const wearableConnections = wearablesData?.connections || [];
      const ouraConnection = wearableConnections.find((item: any) => item.provider === 'oura');
      const garminConnection = wearableConnections.find((item: any) => item.provider === 'garmin');
      setOuraConnected(Boolean(ouraConnection && ouraConnection.status === 'active'));
      setGarminConnected(Boolean(garminConnection && garminConnection.status === 'active'));

      const financialConnections = financialData?.connections || [];
      const plaidConnection = financialConnections.find((item: any) => item.provider === 'plaid');
      setPlaidConnected(Boolean(plaidConnection && plaidConnection.status === 'active'));
    } finally {
      await checkComputerTrackingConnection();
      queryClient.invalidateQueries({ queryKey: ['integrations-overview'] });
    }
  }, [checkComputerTrackingConnection, getToken, queryClient]);

  // Check provider connection state when the modal opens so already-connected
  // integrations render as Connected immediately instead of defaulting to Connect.
  useEffect(() => {
    if (isOpen) {
      void refreshProviderConnectionStatuses();
    }
  }, [isOpen, refreshProviderConnectionStatuses]);

  /** Add Computer Time habit and stay on the list (no settings sheet). */
  const handleComputerUseConnect = useCallback(async () => {
    setIsAddingComputerHabit(true);
    try {
      const result = await ensureComputerTimeHabit(habits, createHabit);
      if (result.created && result.habit && user?.id) {
        const created = result.habit as StoredHabit;
        queryClient.setQueryData<StoredHabit[]>(habitKeys.list(user.id), (old = []) => {
          if (created.id && old.some((h) => h.id === created.id)) return old;
          if (!created.id && old.some((h) => h.name === created.name)) return old;
          return [...old, created];
        });
      }
      if (result.created && result.habit && onHabitCreated) {
        onHabitCreated(result.habit);
      }
      // Do not await refetch or watcher status — either can hang (slow Python / proxy) and
      // leaves the button stuck on "Adding…". Mutation already invalidates; this is a safety refetch.
      void fetchHabits().catch(() => {});
      void checkComputerTrackingConnection();
    } catch (e) {
      console.warn('Could not add Computer Time habit:', e);
    } finally {
      setIsAddingComputerHabit(false);
    }
  }, [
    habits,
    createHabit,
    fetchHabits,
    onHabitCreated,
    checkComputerTrackingConnection,
    queryClient,
    user?.id,
  ]);

  /** Open watcher settings (after ensuring habit exists). */
  const openComputerUseSettings = useCallback(async () => {
    try {
      await ensureComputerTimeHabit(habits, createHabit);
      await fetchHabits();
    } catch (e) {
      console.warn('Could not ensure Computer Time habit:', e);
    }
    setShowComputerTracking(true);
  }, [habits, createHabit, fetchHabits]);

  async function checkWhoopConnection() {
    try {
      const token = await getToken();
      if (!token) {
        setWhoopConnected(false);
        return;
      }
      
      const response = await fetchWithTimeout('/api/integrations/whoop/status', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }, 5000);
      
      if (response.ok) {
        const data = await response.json();
        setWhoopConnected(data.connected || false);
        console.log('✅ Whoop connection status:', data.connected);
      }
    } catch (error) {
      console.error('Error checking Whoop connection:', error);
      setWhoopConnected(false);
    }
  }
  
  async function checkAppleWatchConnection() {
    try {
      const token = await getToken();
      if (!token) {
        setAppleWatchConnected(false);
        return;
      }
      
      const response = await fetchWithTimeout('/api/wearables/apple/devices', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }, 5000);
      
      if (response.ok) {
        const data = await response.json();
        // Check if there's at least one active iOS device
        const activeDevices = (data.devices || []).filter((d: any) => d.is_active && d.platform === 'ios');
        setAppleWatchConnected(activeDevices.length > 0);
        if (activeDevices.length > 0) {
          setAppleWatchDeviceName(activeDevices[0].device_name);
        }
        console.log('✅ Apple Watch connection status:', activeDevices.length > 0);
      }
    } catch (error) {
      console.error('Error checking Apple Watch connection:', error);
      setAppleWatchConnected(false);
    }
  }

  async function handleWhoopConnect() {
    try {
      setWhoopConnecting(true);
      
      // TODO: Implement Whoop connection with new backend
      console.log('🔍 Whoop connect - using new backend (not implemented yet)');
      setWhoopConnecting(false);
      return;
    } catch (error) {
      console.error('Error connecting to Whoop:', error);
      setWhoopConnecting(false);
    }
  }

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setSearchQuery(''); // Clear search when changing categories
    
    // For custom habits, skip the habit list and go directly to customization
    if (category === 'custom') {
      setShowCustomization(true);
      setSelectedHabit({ label: '', value: '' }); // Placeholder for custom habit
    }
  };

  const handleBack = () => {
    if (showCustomization) {
      setShowCustomization(false);
      setSelectedHabit(null);
      setCustomHabitName('');
      // When coming from Custom (no habit list), go back to first screen; otherwise stay in category to show habit list
      if (selectedCategory === 'custom') {
        setSelectedCategory(null);
        setSearchQuery('');
      }
    } else {
      setSelectedCategory(null);
      setSearchQuery('');
    }
  };

  // Metric type options - units of measurement only (not activities/habits)
  const metricOptions = [
    // General
    'Count', 'Sessions', 'Times', 'Percentage', 'Points', 'Score',
    // Time
    'Minutes', 'Hours', 'Days', 'Weeks', 'Fasting Hours',
    // Distance
    'Miles', 'Kilometers', 'Meters', 'Steps', 'Laps', 'Floors', 'Yards',
    // Weight & Mass
    'Pounds', 'Kilograms', 'Grams', 'Ounces', 'Milligrams', 'Micrograms',
    // Volume & Hydration
    'Liters', 'Milliliters', 'Cups', 'Glasses', 'Ounces (fl)', 'Bottles',
    // Fitness
    'Reps', 'Sets', 'Calories', 'BPM', 'Watts', 'Rounds',
    // Reading & Learning
    'Pages', 'Chapters', 'Books', 'Articles', 'Lessons', 'Courses', 'Videos', 'Episodes',
    // Productivity
    'Tasks', 'Projects', 'Emails', 'Calls', 'Meetings', 'Pomodoros',
    // Writing & Coding
    'Words', 'Lines', 'Characters', 'Commits', 'Pull Requests',
    // Media (countable units)
    'Songs', 'Films', 'Podcasts', 'Games',
    // Sleep & Wellness
    'Hours Slept', 'Sleep Score', 'HRV', 'Recovery Score',
    // Health (measurement units)
    'Blood Pressure', 'Blood Sugar', 'Temperature', 'mmHg',
    // Nutrition & Supplements
    'Servings', 'Doses', 'Pills', 'Capsules',
    // Finance
    'Dollars', 'Transactions', 'Savings', 'Investments',
    // Social (countable)
    'Connections', 'Messages', 'Posts',
    // Misc
    'Items', 'Units', 'Breaks'
  ];

  const handleCreateHabit = async () => {
    // For custom habits, use customHabitName; for preset habits, use selectedHabit.label
    const habitName = selectedCategory === 'custom' ? customHabitName : selectedHabit?.label;
    
    if (!habitName || habitName.trim() === '') {
      console.error('❌ No habit name provided');
      return;
    }
    
    setIsCreating(true);
    
    try {
      // For wearable integrations, use the metric-specific unit if available
      const habitUnit = selectedHabit?.unit || selectedMetric;
      const metricType = selectedHabit?.metric_type || null;
      
      const newHabit = {
        name: habitName,
        category: categoryMap[selectedCategory || 'productivity'] || 'manual',
        is_custom: selectedCategory === 'custom',
        sensor_type: selectedCategory === 'applewatch' ? 'Apple Watch'
                   : selectedCategory === 'whoop' ? 'Whoop'
                   : selectedCategory === 'oura' ? 'Oura'
                   : selectedCategory === 'fitbit' ? 'Fitbit'
                   : selectedCategory === 'garmin' ? 'Garmin'
                   : selectedCategory === 'plaid' ? 'Plaid'
                   : 'Manual',
        icon: 'lucide:layout-dashboard',
        unit_type: habitUnit,
        integration_source: selectedCategory === 'whoop' ? 'whoop'
                          : selectedCategory === 'applewatch' ? 'apple_health'
                          : selectedCategory === 'oura' ? 'oura'
                          : selectedCategory === 'fitbit' ? 'fitbit'
                          : selectedCategory === 'garmin' ? 'garmin'
                          : selectedCategory === 'plaid' ? 'plaid'
                          : null,
        // Store the metric type so iOS app knows which HealthKit data to sync
        metric_type: metricType
      };
      
      // Create habit using the useHabits hook
      const backendHabit = await createHabit(newHabit);

      console.log('✅ Habit created successfully in backend:', backendHabit);

      // If this is a Whoop habit, trigger automatic sync
      // Skip Whoop sync for now - will implement with new backend later
      if (selectedCategory === 'whoop') {
        console.log('🔍 Whoop sync - using new backend (not implemented yet)');
      }

      // Update habits context if callback provided
      if (onHabitCreated) {
        const frontendHabit = {
          id: backendHabit.id,
          backendData: backendHabit,
          name: selectedHabit.label,
          is_custom: false,
          created_at: backendHabit.created_at || new Date().toISOString(),
          user_id: backendHabit.user_id || ''
        };
        
        console.log('🔄 Calling onHabitCreated with:', frontendHabit);
        onHabitCreated(frontendHabit);
      } else {
        console.warn('⚠️ No onHabitCreated callback provided');
      }
      
      // Reset state and close
      setSelectedHabit(null);
      setSelectedCategory(null);
      setShowCustomization(false);
      setSelectedMetric('Count');
      setCustomHabitName('');
      onClose();
      
      console.log('✅ Habit creation process completed successfully');
    } catch (error) {
      console.error('❌ Failed to create habit:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      
      // For now, still proceed with frontend-only behavior
      if (onHabitSelect) {
        console.log('🔄 Falling back to onHabitSelect');
        onHabitSelect(selectedHabit);
      }
      setSelectedHabit(null);
      setShowCustomization(false);
      onClose();
    } finally {
      setIsCreating(false);
    }
  };
  if (!isOpen) return null;

  const modalContent = (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4" 
      style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'fixed' }}
      data-tauri-drag-region="false"
    >
      {/* Backdrop - Midday exact style */}
      <div 
        className="absolute inset-0 bg-[#f6f6f3]/60 dark:bg-[#121212]/80" 
        onClick={(e) => {
          // Only close if the click target is the backdrop itself
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
        data-tauri-drag-region="false"
        style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'absolute' }}
      ></div>
      
      <div 
        ref={cardRef}
        className={`relative bg-white w-[90vw] max-w-lg flex flex-col shadow-xl border border-gray-300 z-10 transition-all duration-300 rounded-sm ${showCustomization ? 'min-h-[480px]' : ''}`}
      >
        {/* floating layer that confines dropdowns to the card */}
        <div
          ref={floatingLayerRef}
          className="pointer-events-none absolute inset-0 z-50 overflow-visible"
        />
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-1 flex-shrink-0">
          {showComputerTracking ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowComputerTracking(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <h2 className="text-lg font-medium text-gray-900">Computer Use</h2>
            </div>
          ) : showCustomization ? (
            <button
              onClick={handleBack}
              className="p-1 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
          ) : (
            <div className="flex items-center gap-3">
              {selectedCategory && (
                <button
                  onClick={handleBack}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>
              )}
              <h2 className="text-lg font-medium text-gray-900">
                {selectedCategory
                  ? selectedCategory === 'whoop' ? 'Whoop'
                  : selectedCategory === 'fitness' ? 'Health'
                  : selectedCategory === 'education' ? 'Learning'
                  : selectedCategory === 'experiments' ? 'Experiments'
                  : selectedCategory === 'productivity' ? 'Productivity'
                  : selectedCategory === 'applewatch' ? 'Apple Watch'
                  : selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)
                  : 'Connect devices'}
              </h2>
            </div>
          )}
            <button
              onClick={onClose}
              className="rounded-sm p-1 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
        </div>

        {/* Description */}
        {!selectedCategory && !showComputerTracking && (
          <div className="px-5 pb-4 flex-shrink-0">
            <p className="text-sm text-gray-500">
              Automate tracking by connecting to these providers. New integrations and data sources are being added weekly.
            </p>
        </div>
        )}

        {/* Search Bar - Only show when viewing habits within a category (not on main page, customization, or computer tracking) */}
        {!showCustomization && !showComputerTracking && selectedCategory && (
          <div className="px-4 pb-1.5 flex-shrink-0">
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-sm focus:outline-none focus:border-gray-400 text-sm"
            />
          </div>
        )}

        {/* Content Area - Scrollable */}
        <div className={`overflow-y-auto px-5 pb-5 min-h-0 ${showCustomization ? 'max-h-[440px]' : 'max-h-[380px]'}`}>
          {showComputerTracking ? (
            // Computer Use Settings View
            <div className="py-2">
              {resolvedUserId ? (
                <ComputerTrackingSettings 
                  userId={resolvedUserId} 
                  onClose={() => {
                    setShowComputerTracking(false);
                    checkComputerTrackingConnection();
                  }} 
                />
              ) : (
                <p className="text-sm text-gray-500 py-2">Sign in to configure desktop tracking.</p>
              )}
            </div>
          ) : showCustomization ? (
            // Habit Customization View - matches main modal polish
            <div className="flex flex-col h-full py-2">
              {/* Title */}
              <h3 className="text-lg font-medium text-gray-900 mb-5">Configure</h3>
              
              {/* Form Fields */}
              <div className="space-y-5">
                {/* Title Input */}
                <div className="flex items-center gap-4">
                  <label className="text-sm font-normal text-gray-600 w-24 flex-shrink-0">Title</label>
                  <input
                    type="text"
                    placeholder="Name"
                    value={selectedCategory === 'custom' ? customHabitName : (selectedHabit?.label || '')}
                    onChange={(e) => {
                      if (selectedCategory === 'custom') {
                        setCustomHabitName(e.target.value);
                      }
                    }}
                    readOnly={selectedCategory !== 'custom'}
                    className={`flex-1 px-3 py-2 border border-gray-300 rounded-sm text-sm font-normal text-gray-900 h-10 focus:outline-none focus:border-gray-400 ${
                      selectedCategory === 'custom' ? 'bg-white' : 'bg-[#F3F3F3]'
                    }`}
                  />
                </div>


                {/* Metric Type Selection */}
                <div className="flex items-center gap-4">
                  <label className="text-sm font-normal text-gray-600 w-24 flex-shrink-0">Metric</label>
                  <div className="flex-1">
                    <div className="relative" ref={metricDropdownRef}>
                      <button
                        ref={metricBtnRef}
                        onClick={() => setIsMetricDropdownOpen((v) => !v)}
                        className="flex items-center justify-between w-full px-3 py-2 border border-gray-200 rounded-sm bg-white text-sm font-normal text-gray-700 hover:bg-[#F3F3F3] focus:outline-none h-10"
                      >
                        <span>{selectedMetric}</span>
                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isMetricDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {isMetricDropdownOpen &&
                        typeof window !== 'undefined' &&
                        floatingLayerRef.current &&
                        createPortal(
                          <div style={metricStyle} data-metric-dropdown className="dropdown z-[10000] rounded-sm">
                            <div className="py-1">
                              {metricOptions.map((metric) => (
                                <button
                                  key={metric}
                                  onClick={() => {
                                    setSelectedMetric(metric);
                                    setIsMetricDropdownOpen(false);
                                  }}
                                  className={`flex items-center w-full px-3 py-2 text-sm font-normal hover:bg-[#F3F3F3] text-left rounded-sm ${
                                    selectedMetric === metric ? 'bg-[#F3F3F3] text-gray-900' : 'text-gray-700'
                                  }`}
                                >
                                  {metric}
                                </button>
                              ))}
                            </div>
                          </div>,
                          floatingLayerRef.current
                        )}
                    </div>
                  </div>
                </div>

                {/* Start Date Selection */}
                <div className="flex items-center gap-4">
                  <label className="text-sm font-normal text-gray-600 w-24 flex-shrink-0">Start Date</label>
                  <div className="flex-1">
                    <div className="flex items-center gap-2.5 px-3 py-2 border border-gray-200 rounded-sm bg-[#F3F3F3] text-sm font-normal text-gray-700 h-10 focus-within:ring-1 focus-within:ring-gray-300">
                      <Calendar className="w-4 h-4 text-gray-500" />
                      <span>Today, {new Date().toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric',
                        year: 'numeric' 
                      })}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="flex justify-end items-center gap-3 mt-auto pt-6 border-t border-gray-100">
                <button
                  onClick={handleBack}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateHabit}
                  disabled={isCreating || (selectedCategory === 'custom' && !customHabitName.trim())}
                  className="px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isCreating ? 'Starting...' : 'Start Tracking'}
                </button>
              </div>
            </div>
          ) : !selectedCategory ? (
            // Category Selection
            <div className="pb-2">
                {/* Custom - Manual */}
                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <Plus className="h-5 w-5 text-gray-900" strokeWidth={1.75} />
                    </div>
                    <p className="text-sm font-normal text-gray-900">Custom</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('custom')}
                    className={connectRowActionClass}
                  >
                    Manual
                  </button>
                </div>

                {/* Computer Use - Only show on desktop (Tauri) */}
                {isTauri() && (
                  <div className="flex items-center gap-3 py-1.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <div className="flex w-9 shrink-0 items-center justify-center">
                        <Monitor className="h-5 w-5 text-gray-900" strokeWidth={1.75} />
                      </div>
                      <p className="text-sm font-normal text-gray-900">Computer Use</p>
                    </div>
                    {computerTrackingConnected ? (
                      <button 
                        type="button"
                        onClick={() => void openComputerUseSettings()}
                        className={connectRowActionConnectedClass}
                      >
                        Connected
                      </button>
                    ) : (
                      <button 
                        type="button"
                        onClick={() => void handleComputerUseConnect()}
                        disabled={isAddingComputerHabit}
                        className={`${connectRowActionClass} disabled:opacity-50`}
                      >
                        {isAddingComputerHabit ? 'Adding…' : 'Connect'}
                      </button>
                    )}
                  </div>
                )}

                {/* Wearables & Devices - Connect */}
                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <img src="/images/Screen_Time.svg" alt="Screen Time" className="h-5 w-5 object-contain" onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const nextSibling = e.currentTarget.nextElementSibling as HTMLElement;
                        if (nextSibling) nextSibling.style.display = 'block';
                      }} />
                      <svg className="h-5 w-5 text-gray-700" style={{display: 'none'}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-normal text-gray-900">Screen Time</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('screentime')}
                    className={connectRowActionClass}
                  >
                    Connect
                  </button>
                </div>

                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <svg className="h-5 w-5" viewBox="0 0 814 1000" fill="currentColor">
                        <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
                      </svg>
                    </div>
                    <p className="text-sm font-normal text-gray-900">Apple Watch</p>
                  </div>
                  {appleWatchConnected ? (
                    <button 
                      type="button"
                      onClick={() => handleCategorySelect('applewatch')}
                      className={connectRowActionConnectedClass}
                    >
                      Connected
                    </button>
                  ) : (
                    <button 
                      type="button"
                      onClick={() => {
                        alert(
                          '📱 To connect your Apple Watch:\n\n' +
                          '1. Download the Ritual Companion app on your iPhone\n' +
                          '2. Sign in with your Ritual account\n' +
                          '3. Tap "Connect" to register your device\n' +
                          '4. Grant HealthKit permissions\n\n' +
                          'Your Apple Watch data syncs through your iPhone.'
                        );
                      }}
                      className={connectRowActionClass}
                    >
                      Connect
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <img src="/images/oura.svg" alt="Oura Ring" className="h-8 w-8 object-contain" />
                    </div>
                    <p className="text-sm font-normal text-gray-900">Oura Ring</p>
                  </div>
                  {ouraConnected ? (
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('oura')}
                      className={connectRowActionConnectedClass}
                    >
                      Connected
                    </button>
                  ) : (
                    <button 
                      type="button"
                      onClick={() => handleCategorySelect('oura')}
                      className={connectRowActionClass}
                    >
                      Connect
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <img src="/images/whoop.svg" alt="Whoop" className="h-5 object-contain" />
                    </div>
                    <p className="text-sm font-normal text-gray-900">Whoop</p>
                  </div>
                  {whoopConnected ? (
                    <button 
                      type="button"
                      onClick={() => handleCategorySelect('whoop')}
                      className={connectRowActionConnectedClass}
                    >
                      Connected
                    </button>
                  ) : (
                    <button 
                      type="button"
                      onClick={() => handleCategorySelect('whoop')}
                      disabled={whoopConnecting}
                      className={`${connectRowActionClass} disabled:opacity-50`}
                    >
                      <span className="truncate">{whoopConnecting ? 'Connecting...' : 'Connect'}</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <img src="/images/fitbit.svg" alt="Fitbit" className="h-5 object-contain" />
                    </div>
                    <p className="text-sm font-normal text-gray-900">Fitbit</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('fitbit')}
                    className={connectRowActionClass}
                  >
                    Connect
                  </button>
                </div>

                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <img src="/images/garmin.svg" alt="Garmin" className="h-5 object-contain" />
                    </div>
                    <p className="text-sm font-normal text-gray-900">Garmin</p>
                  </div>
                  {garminConnected ? (
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('garmin')}
                      className={connectRowActionConnectedClass}
                    >
                      Connected
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('garmin')}
                      className={connectRowActionClass}
                    >
                      Connect
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <img src="/images/plaid-mark.svg" alt="Plaid" className="h-5 object-contain" />
                    </div>
                    <p className="text-sm font-normal text-gray-900">Plaid</p>
                  </div>
                  {plaidConnected ? (
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('plaid')}
                      className={connectRowActionConnectedClass}
                    >
                      Connected
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('plaid')}
                      className={connectRowActionClass}
                    >
                      Connect
                    </button>
                  )}
                </div>

                {/* Manual Tracking Categories */}
                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <ChartLine className="h-5 w-5 text-gray-900" strokeWidth={2} />
                    </div>
                    <p className="text-sm font-normal text-gray-900">Productivity</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('productivity')}
                    className={connectRowActionClass}
                  >
                    Manual
                  </button>
                </div>

                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <Brain className="h-5 w-5 text-gray-900" strokeWidth={2} />
                    </div>
                    <p className="text-sm font-normal text-gray-900">Learning</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('education')}
                    className={connectRowActionClass}
                  >
                    Manual
                  </button>
                </div>

                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <Heart className="h-5 w-5 text-gray-900" strokeWidth={2} />
                    </div>
                    <p className="text-sm font-normal text-gray-900">Health</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('fitness')}
                    className={connectRowActionClass}
                  >
                    Manual
                  </button>
                </div>

                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex w-9 shrink-0 items-center justify-center">
                      <FlaskConical className="h-5 w-5 text-gray-900" strokeWidth={2} />
                    </div>
                    <p className="text-sm font-normal text-gray-900">Experiments</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('experiments')}
                    className={connectRowActionClass}
                  >
                    Manual
                  </button>
                </div>
            </div>
          ) : (
            // Habit Selection for Category
            <div>
                {displayedHabits.length > 0 ? (
                  displayedHabits.map((habit: any, index: number) => (
                    habit.section ? (
                      <div key={habit.value} className={`px-3 pt-4 pb-1 ${index === 0 ? 'pt-1' : ''}`}>
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{habit.label}</p>
                      </div>
                    ) : (
                      <div key={habit.value} className="flex justify-between items-center h-12 px-3">
                        <p className="text-sm font-normal text-gray-900">{habit.label}</p>
                        <button
                          onClick={() => handleHabitClick(habit)}
                          disabled={isCreating}
                          className="px-3 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-sm hover:bg-[#F3F3F3] transition-colors disabled:opacity-50"
                        >
                          {isCreating ? 'Creating...' : 'Track'}
                        </button>
                      </div>
                    )
                  ))
                ) : searchQuery.trim() ? (
                  // No search results message
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="text-gray-400 mb-3">
                      <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <p className="text-sm font-normal text-gray-900 mb-1">No habits found</p>
                    <p className="text-xs text-gray-500">Try a different search term</p>
                  </div>
                ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Use portal to render at document body level for full coverage
  return typeof window !== 'undefined' ? createPortal(modalContent, document.body) : null;
} 
