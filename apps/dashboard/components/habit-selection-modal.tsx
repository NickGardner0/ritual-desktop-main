'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
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
  type Habit,
} from '../data/habits-data';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { ensureComputerTimeHabit } from '@/lib/ensure-computer-time-habit';
import { categoryMap } from './habit-selection/constants';
import { fetchWithTimeout, withTimeout } from './habit-selection/helpers';
import { getHabitsForCategory } from './habit-selection/habit-catalog';
import { useFloatingWithinCard } from './habit-selection/use-floating-within-card';
import { CategoryList } from './habit-selection/category-list';
import { CustomizationPanel } from './habit-selection/customization-panel';
import { HabitList } from './habit-selection/habit-list';
import { metricOptions } from './habit-selection/metric-options';
import { useHabitSelectionSearch } from './habit-selection/use-habit-search';

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

export function HabitSelectionModal({ isOpen, onClose, onHabitSelect, onHabitCreated, initialCategory = null }: HabitSelectionModalProps): React.ReactElement | null {
  const { isDesktop } = useDesktopCapabilities();
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
  
  const { searchResults, displayedHabits } = useHabitSelectionSearch(selectedCategory, searchQuery);

  

  const metricStyle = useFloatingWithinCard(
    isMetricDropdownOpen,
    metricBtnRef,
    cardRef,
    384,
    160,
    280,
  );

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

      if (isDesktop) {
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
      <div 
        className="absolute inset-0 bg-[#f6f6f3]/60 dark:bg-[#121212]/80" 
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        data-tauri-drag-region="false"
        style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'absolute' }}
      />
      <div 
        ref={cardRef}
        className={`relative z-10 flex w-[90vw] max-w-lg flex-col rounded-sm border border-[#d8d8d3] bg-white text-[#1f1e1a] shadow-[0_18px_50px_-35px_rgba(15,23,42,0.55)] transition-all duration-300 ${showCustomization ? 'min-h-[480px]' : ''}`}
      >
        <div ref={floatingLayerRef} className="pointer-events-none absolute inset-0 z-50 overflow-visible" />
        <div className="flex flex-shrink-0 items-center justify-between px-5 pb-2 pt-5">
          {showComputerTracking ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowComputerTracking(false)}
                className="rounded-sm p-1 text-[#878787] transition-colors hover:bg-[#f5f5f2] hover:text-[#1f1e1a]"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <h2 className="text-lg font-semibold leading-none tracking-tight text-[#1f1e1a]">Computer Use</h2>
            </div>
          ) : showCustomization ? (
            <button
              onClick={handleBack}
              className="rounded-sm p-1 text-[#878787] transition-colors hover:bg-[#f5f5f2] hover:text-[#1f1e1a]"
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
                  className="rounded-sm p-1 text-[#878787] transition-colors hover:bg-[#f5f5f2] hover:text-[#1f1e1a]"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>
              )}
              <h2 className="text-lg font-semibold leading-none tracking-tight text-[#1f1e1a]">
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
              className="rounded-sm p-1 text-[#878787] transition-colors hover:bg-[#f5f5f2] hover:text-[#1f1e1a]"
            >
              <X className="w-4 h-4" />
            </button>
        </div>

        {/* Description */}
        {!selectedCategory && !showComputerTracking && (
          <div className="flex-shrink-0 px-5 pb-4">
            <p className="text-sm leading-6 text-[#878787]">
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
              className="w-full rounded-sm border border-[#d8d8d3] px-4 py-2.5 text-sm text-[#1f1e1a] placeholder:text-[#878787] focus:border-[#b8b6af] focus:outline-none"
            />
          </div>
        )}

        {/* Content Area - Scrollable */}

        <div className={`min-h-0 overflow-y-auto px-5 pb-5 ${showCustomization ? 'max-h-[440px]' : 'max-h-[380px]'}`}>
          {showComputerTracking ? (
            <div className="py-2">
              {resolvedUserId ? (
                <ComputerTrackingSettings userId={resolvedUserId} onClose={() => { setShowComputerTracking(false); checkComputerTrackingConnection(); }} />
              ) : (
                <p className="text-sm text-gray-500 py-2">Sign in to configure desktop tracking.</p>
              )}
            </div>
          ) : showCustomization ? (
            <CustomizationPanel
              selectedCategory={selectedCategory}
              selectedHabit={selectedHabit}
              customHabitName={customHabitName}
              setCustomHabitName={setCustomHabitName}
              selectedMetric={selectedMetric}
              setSelectedMetric={setSelectedMetric}
              isMetricDropdownOpen={isMetricDropdownOpen}
              setIsMetricDropdownOpen={setIsMetricDropdownOpen}
              metricDropdownRef={metricDropdownRef}
              metricBtnRef={metricBtnRef}
              metricStyle={metricStyle}
              metricOptions={metricOptions}
              isCreating={isCreating}
              handleBack={handleBack}
              handleCreateHabit={handleCreateHabit}
            />
          ) : !selectedCategory ? (
            <CategoryList
              computerTrackingConnected={computerTrackingConnected}
              isAddingComputerHabit={isAddingComputerHabit}
              appleWatchConnected={appleWatchConnected}
              ouraConnected={ouraConnected}
              whoopConnected={whoopConnected}
              whoopConnecting={whoopConnecting}
              garminConnected={garminConnected}
              plaidConnected={plaidConnected}
              handleCategorySelect={handleCategorySelect}
              handleComputerUseConnect={() => void handleComputerUseConnect()}
              openComputerUseSettings={() => void openComputerUseSettings()}
            />
          ) : (
            <HabitList
              displayedHabits={displayedHabits}
              searchQuery={searchQuery}
              isCreating={isCreating}
              handleHabitClick={handleHabitClick}
            />
          )}
        </div>
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
