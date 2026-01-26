'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  ChevronDown, 
  CheckCircle, 
  X, 
  Calendar, 
  Brain,
  BookOpen, 
  Activity,
  FlaskConical, 
  Plus,
  Monitor
} from 'lucide-react';
import { useHabits } from '@/contexts/HabitsContext';
import { useAuth } from '@clerk/nextjs';
import MiniSearch from 'minisearch';
import {
  productivityHabits,
  fitnessHealthHabits,
  educationHabits,
  experimentsHabits,
  type Habit
} from '../data/habits-data';
import IconPicker from './IconPicker';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { isTauri } from '@/lib/tauri-utils';

interface HabitSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onHabitSelect?: (habit: any) => void;
  onHabitCreated?: (habit: any) => void;
  initialCategory?: string | null;
}

// Map frontend categories to backend categories
const categoryMap: Record<string, string> = {
  'productivity': 'Productivity',
  'fitness': 'Fitness & Health', 
  'education': 'Education',
  'experiments': 'Experiments',
  'custom': 'Custom'
};

export function HabitSelectionModal({ isOpen, onClose, onHabitSelect, onHabitCreated, initialCategory = null }: HabitSelectionModalProps): React.ReactElement | null {
  const { createHabit } = useHabits(); // Add useHabits hook
  const { getToken, userId } = useAuth(); // Add Clerk auth hook
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(initialCategory);
  const [showComputerTracking, setShowComputerTracking] = useState(false);
  const [computerTrackingConnected, setComputerTrackingConnected] = useState(false);
  
  // Update category when initialCategory prop changes and modal opens
  React.useEffect(() => {
    if (initialCategory && isOpen) {
      setSelectedCategory(initialCategory);
    }
  }, [initialCategory, isOpen]);
  const [selectedHabit, setSelectedHabit] = React.useState<any | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showCustomization, setShowCustomization] = useState(false);
  // We store icon names in kebab-case to match lucide's `icons` map keys
  const [selectedIcon, setSelectedIcon] = useState('');
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
          { value: 'steps', label: 'Steps', metric_type: 'steps', unit: 'Steps' },
          { value: 'active-energy', label: 'Active Calories', metric_type: 'active_energy', unit: 'Calories' },
          { value: 'basal-energy', label: 'Resting Calories', metric_type: 'basal_energy', unit: 'Calories' },
          { value: 'distance', label: 'Distance', metric_type: 'distance', unit: 'Miles' },
          { value: 'flights-climbed', label: 'Flights Climbed', metric_type: 'flights_climbed', unit: 'Count' },
          { value: 'exercise-time', label: 'Exercise Minutes', metric_type: 'exercise_time', unit: 'Minutes' },
          { value: 'stand-time', label: 'Stand Time', metric_type: 'stand_time', unit: 'Minutes' },
          // Heart
          { value: 'heart-rate', label: 'Heart Rate', metric_type: 'hr', unit: 'BPM' },
          { value: 'hrv', label: 'Heart Rate Variability (HRV)', metric_type: 'hrv', unit: 'HRV' },
          { value: 'resting-hr', label: 'Resting Heart Rate', metric_type: 'resting_hr', unit: 'BPM' },
          { value: 'walking-hr', label: 'Walking Heart Rate', metric_type: 'walking_hr', unit: 'BPM' },
          // Sleep & Recovery
          { value: 'sleep', label: 'Sleep Duration', metric_type: 'sleep_session', unit: 'Hours Slept' },
          { value: 'sleep-rem', label: 'REM Sleep', metric_type: 'sleep_rem', unit: 'Minutes' },
          { value: 'sleep-deep', label: 'Deep Sleep', metric_type: 'sleep_deep', unit: 'Minutes' },
          { value: 'sleep-core', label: 'Core Sleep', metric_type: 'sleep_core', unit: 'Minutes' },
          // Respiratory & Blood
          { value: 'blood-oxygen', label: 'Blood Oxygen (SpO2)', metric_type: 'oxygen_saturation', unit: 'Percentage' },
          { value: 'respiratory-rate', label: 'Respiratory Rate', metric_type: 'respiratory_rate', unit: 'Count' },
          // Workouts & Mindfulness
          { value: 'workouts', label: 'Workouts', metric_type: 'workout', unit: 'Count' },
          { value: 'mindful-minutes', label: 'Mindful Minutes', metric_type: 'mindful_minutes', unit: 'Minutes' }
        ];
      case 'oura':
        return [
          { value: 'sleep-score', label: 'Sleep Score' },
          { value: 'readiness', label: 'Readiness Score' },
          { value: 'activity', label: 'Activity Score' }
        ];
      case 'whoop':
        return [
          { value: 'recovery', label: 'Recovery Score' },
          { value: 'sleep-duration', label: 'Sleep Duration' },
          { value: 'sleep-performance', label: 'Sleep Performance' },
          { value: 'bedtime', label: 'Bedtime' },
          { value: 'wake-time', label: 'Wake Time' },
          { value: 'strain', label: 'Daily Strain' },
          { value: 'resting-hr', label: 'Resting Heart Rate' },
          { value: 'hrv', label: 'Heart Rate Variability (HRV)' },
          { value: 'steps', label: 'Daily Steps' }
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
      return categoryHabits.filter(habit => 
        habit.label.toLowerCase().includes(query) ||
        habit.value.toLowerCase().includes(query)
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
  
  // Floating positioning hook
  function useFloatingWithinCard(
    open: boolean,
    anchorRef: React.RefObject<HTMLElement>,
    cardRef: React.RefObject<HTMLElement>,
    desiredWidth = 320,
    minHeight = 200
  ) {
    const [style, setStyle] = React.useState<React.CSSProperties>({});

    React.useLayoutEffect(() => {
      if (!open || !anchorRef.current || !cardRef.current) return;

      const a = anchorRef.current.getBoundingClientRect();
      const c = cardRef.current.getBoundingClientRect();

      const margin = 8;
      const width = Math.max(desiredWidth, a.width);
      const spaceBelow = c.bottom - a.bottom - margin;
      const spaceAbove = a.top - c.top - margin;
      // Always open downward for metric dropdown
      const maxHeight = Math.max(
        minHeight,
        Math.floor(spaceBelow)
      );

      const left = Math.min(
        Math.max(a.left - c.left, margin),
        c.width - width - margin
      );

      const top = a.bottom - c.top + 4; // always open downward

      setStyle({
        position: 'absolute',
        left,
        top,
        width,
        maxHeight: Math.min(maxHeight, 280), // cap for exactly 7 rows (~40px each, no header)
        overflowY: 'auto',
        pointerEvents: 'auto',               // re-enable interactions
        borderRadius: 0, // square borders as requested
        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
        background: 'white',
        border: '1px solid #e5e7eb',
      });
    }, [open, anchorRef, cardRef, desiredWidth, minHeight]);

    React.useEffect(() => {
      if (!open) return;
      const recalc = () => {
        setStyle((s) => ({ ...s }));
      };
      window.addEventListener('resize', recalc);
      window.addEventListener('scroll', recalc, true);
      return () => {
        window.removeEventListener('resize', recalc);
        window.removeEventListener('scroll', recalc, true);
      };
    }, [open]);

    return style;
  }

  const metricStyle = useFloatingWithinCard(
    isMetricDropdownOpen,
    metricBtnRef,
    cardRef,
    384,   // desired menu width
    260    // minimum height we try to keep before flipping up
  );

  // Add ESC key handler and click outside handler
    React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      // Close metric dropdown if clicking outside
      if (isMetricDropdownOpen && metricDropdownRef.current && !metricDropdownRef.current.contains(event.target as Node)) {
        setIsMetricDropdownOpen(false);
      }
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

  // Check if Whoop, Apple Watch, and Computer Tracking are connected on mount and when modal opens
  useEffect(() => {
    if (isOpen) {
      checkWhoopConnection();
      checkAppleWatchConnection();
      checkComputerTrackingConnection();
    }
  }, [isOpen]);

  async function checkComputerTrackingConnection() {
    try {
      const response = await fetch('/api/watcher/devices');
      if (response.ok) {
        const data = await response.json();
        const devices = data.devices || [];
        const hasEnabledDevice = devices.some((d: any) => d.is_enabled);
        setComputerTrackingConnected(hasEnabledDevice);
      }
    } catch (error) {
      console.error('Error checking Computer Tracking connection:', error);
      setComputerTrackingConnected(false);
    }
  }

  async function checkWhoopConnection() {
    try {
      const token = await getToken();
      if (!token) {
        setWhoopConnected(false);
        return;
      }
      
      const response = await fetch('http://127.0.0.1:8000/api/integrations/whoop/status', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
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
      
      const response = await fetch('http://127.0.0.1:8000/api/wearables/apple/devices', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
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
      setCustomHabitName(''); // Clear custom habit name
    } else {
      setSelectedCategory(null);
      setSearchQuery(''); // Clear search when going back
    }
  };



  // Helpers for naming formats
  const kebabToPascal = (kebab: string) => kebab
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  const humanize = (kebab: string) => kebab.replace(/-/g, ' ');


  // Emoji functionality removed - now using enhanced IconPicker with Material UI icons

  // Metric type options
  const metricOptions = [
    // General
    'Count', 'Sessions', 'Times', 'Percentage', 'Points', 'Score',
    // Time
    'Minutes', 'Hours', 'Days', 'Weeks',
    // Distance
    'Miles', 'Kilometers', 'Meters', 'Steps', 'Laps',
    // Weight & Mass
    'Pounds', 'Kilograms', 'Grams', 'Ounces', 'Milligrams',
    // Volume & Hydration
    'Liters', 'Milliliters', 'Cups', 'Glasses', 'Ounces (fl)',
    // Fitness
    'Reps', 'Sets', 'Calories', 'BPM', 'Watts',
    // Reading & Learning
    'Pages', 'Chapters', 'Books', 'Articles', 'Lessons', 'Courses',
    // Productivity
    'Tasks', 'Projects', 'Emails', 'Calls', 'Meetings', 'Pomodoros',
    // Writing & Coding
    'Words', 'Lines', 'Characters', 'Commits', 'Pull Requests',
    // Sleep & Wellness
    'Hours Slept', 'Sleep Score', 'HRV', 'Recovery Score',
    // Finance
    'Dollars', 'Transactions', 'Savings',
    // Social
    'Connections', 'Messages', 'Posts',
    // Misc
    'Items', 'Units', 'Servings', 'Doses', 'Breaks'
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
                   : 'Manual',
        icon: selectedIcon || 'DashboardSharp', // Material UI icons are already in PascalCase
        unit_type: habitUnit,
        integration_source: selectedCategory === 'whoop' ? 'whoop' 
                          : selectedCategory === 'applewatch' ? 'apple_health'
                          : selectedCategory === 'oura' ? 'oura'
                          : selectedCategory === 'fitbit' ? 'fitbit'
                          : selectedCategory === 'garmin' ? 'garmin'
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
      setSelectedIcon('');
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
        className="relative bg-white w-[90vw] max-w-xl h-[560px] flex flex-col shadow-xl border border-gray-300 z-10 transition-all duration-300 rounded-none"
      >
        {/* floating layer that confines dropdowns to the card */}
        <div
          ref={floatingLayerRef}
          className="pointer-events-none absolute inset-0 z-50 overflow-hidden"
        />
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
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
              <h2 className="text-lg font-medium text-gray-900">Computer Tracking</h2>
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
                  : selectedCategory === 'fitness' ? 'Fitness & Health'
                  : selectedCategory === 'education' ? 'Learning'
                  : selectedCategory === 'experiments' ? 'Experiments'
                  : selectedCategory === 'productivity' ? 'Productivity'
                  : selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)
                  : 'Start tracking anything'}
              </h2>
            </div>
          )}
            <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            >
            <X className="w-5 h-5" />
            </button>
        </div>

        {/* Description */}
        {!selectedCategory && !showComputerTracking && (
          <div className="px-5 pb-4 flex-shrink-0">
            <p className="text-sm text-gray-500">
              Ritual works best when you connect and integrate your wearable devices with manual self tracking tools.
            </p>
        </div>
        )}

        {/* Search Bar - Only show when viewing habits within a category (not on main page, customization, or computer tracking) */}
        {!showCustomization && !showComputerTracking && selectedCategory && (
          <div className="px-5 pb-2 flex-shrink-0">
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-none focus:outline-none focus:border-gray-400 text-sm"
            />
          </div>
        )}

        {/* Content Area - Scrollable */}
        <div className="flex-1 overflow-y-auto px-5 pb-3">
          {showComputerTracking ? (
            // Computer Tracking Settings View
            <div className="py-2">
              {userId && (
                <ComputerTrackingSettings 
                  userId={userId} 
                  onClose={() => {
                    setShowComputerTracking(false);
                    checkComputerTrackingConnection();
                  }} 
                />
              )}
            </div>
          ) : showCustomization ? (
            // Habit Customization View - Redesigned per ChatGPT recommendations
            <div className="flex flex-col h-full">
              {/* Title */}
              <h3 className="text-lg font-medium text-gray-900 mb-5">Configure</h3>
              
              {/* Form Fields - Tighter spacing */}
              <div className="space-y-4">
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
                    className={`flex-1 px-3 py-2 border border-gray-300 rounded-none text-sm font-normal text-gray-900 h-10 focus:outline-none focus:border-gray-400 ${
                      selectedCategory === 'custom' ? 'bg-white' : 'bg-gray-50'
                    }`}
                  />
                </div>

                {/* Icon Selection */}
                <div className="flex items-center gap-4">
                  <label className="text-sm font-normal text-gray-600 w-24 flex-shrink-0">Icon</label>
                  <div className="flex-1">
                    <IconPicker
                      value={selectedIcon}
                      onChange={(name) => setSelectedIcon(name)}
                      anchorClassName="flex items-center justify-between w-full px-3 py-2 border border-gray-200 bg-white text-sm font-normal text-gray-700 hover:bg-gray-50 focus:outline-none h-10"
                      portalRef={floatingLayerRef}
                      withinCardRef={cardRef}
                      minMenuHeight={260}
                      desiredMenuWidth={384}
                    />
                  </div>
                </div>

                {/* Metric Type Selection */}
                <div className="flex items-center gap-4">
                  <label className="text-sm font-normal text-gray-600 w-24 flex-shrink-0">Metric</label>
                  <div className="flex-1">
                    <div className="relative" ref={metricDropdownRef}>
                      <button
                        ref={metricBtnRef}
                        onClick={() => setIsMetricDropdownOpen((v) => !v)}
                        className="flex items-center justify-between w-full px-3 py-2 border border-gray-200 rounded-none bg-white text-sm font-normal text-gray-700 hover:bg-gray-50 focus:outline-none h-10"
                      >
                        <span>{selectedMetric}</span>
                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isMetricDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {isMetricDropdownOpen &&
                        floatingLayerRef.current &&
                        createPortal(
                          <div style={metricStyle} className="dropdown">
                            <div className="py-1">
                              {metricOptions.map((metric) => (
                                <button
                                  key={metric}
                                  onClick={() => {
                                    setSelectedMetric(metric);
                                    setIsMetricDropdownOpen(false);
                                  }}
                                  className={`flex items-center w-full px-3 py-2 text-sm font-normal hover:bg-gray-50 text-left ${
                                    selectedMetric === metric ? 'bg-gray-100 text-gray-900' : 'text-gray-700'
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
                    <div className="flex items-center gap-2.5 px-3 py-2 border border-gray-200 rounded-none bg-gray-50 text-sm font-normal text-gray-700 h-10">
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

              {/* Footer Buttons - Better placement */}
              <div className="flex justify-end items-center gap-3 mt-auto pt-6">
                <button
                  onClick={handleBack}
                  className="px-4 py-2 text-sm font-normal text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateHabit}
                  disabled={isCreating || (selectedCategory === 'custom' && !customHabitName.trim())}
                  className="px-5 py-2 bg-black text-white text-sm font-normal hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isCreating ? 'Starting...' : 'Start Tracking'}
                </button>
              </div>
            </div>
          ) : !selectedCategory ? (
            // Category Selection
            <div>
                {/* Custom - Manual */}
                <div className="flex justify-between items-center h-11">
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <Plus className="w-6 h-6 text-gray-900" />
                    </div>
                    <p className="text-sm font-normal text-gray-900 ml-2.5">Custom</p>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('custom')}
                    className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                  >
                    Manual
                  </button>
                </div>

                {/* Computer Tracking - Only show on desktop (Tauri) */}
                {isTauri() && (
                  <div className="flex justify-between items-center h-11">
                    <div className="flex items-center">
                      <div className="flex h-11 w-11 items-center justify-center">
                        <Monitor className="w-6 h-6 text-gray-900" />
                      </div>
                      <p className="text-sm font-normal text-gray-900 ml-2.5">Computer Tracking</p>
                    </div>
                    {computerTrackingConnected ? (
                      <button 
                        onClick={() => setShowComputerTracking(true)}
                        className="px-4 py-1.5 text-sm font-normal text-white bg-lime-500 rounded-none hover:bg-lime-600 transition-colors mr-1"
                      >
                        Connected
                      </button>
                    ) : (
                      <button 
                        onClick={() => setShowComputerTracking(true)}
                        className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                )}

                {/* Wearables & Devices - Connect */}
                <div className="flex justify-between items-center h-11">
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <img src="/images/Screen_Time.svg" alt="Screen Time" className="w-7 h-7" onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const nextSibling = e.currentTarget.nextElementSibling as HTMLElement;
                        if (nextSibling) nextSibling.style.display = 'block';
                      }} />
                      <svg className="w-6 h-6 text-gray-700" style={{display: 'none'}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-normal text-gray-900 ml-2.5">Screen Time</p>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('screentime')}
                    className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                  >
                    Connect
                  </button>
                </div>

                <div className="flex justify-between items-center h-11">
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <svg className="h-6 w-6" viewBox="0 0 814 1000" fill="currentColor">
                        <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
                      </svg>
                    </div>
                    <p className="text-sm font-normal text-gray-900 ml-2.5">Apple Watch</p>
                  </div>
                  {appleWatchConnected ? (
                    <button 
                      onClick={() => handleCategorySelect('applewatch')}
                      className="px-4 py-1.5 text-sm font-normal text-white bg-lime-500 rounded-none hover:bg-lime-600 transition-colors mr-1"
                    >
                      Connected
                    </button>
                  ) : (
                    <button 
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
                      className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                    >
                      Connect
                    </button>
                  )}
                </div>

                <div className="flex justify-between items-center h-11">
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <img src="/images/oura.svg" alt="Oura Ring" className="h-14" />
                    </div>
                    <p className="text-sm font-normal text-gray-900 ml-2.5">Oura Ring</p>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('oura')}
                    className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                  >
                    Connect
                  </button>
                </div>

                <div className="flex justify-between items-center h-11">
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <img src="/images/whoop.svg" alt="Whoop" className="h-6" />
                    </div>
                    <p className="text-sm font-normal text-gray-900 ml-2.5">Whoop</p>
                  </div>
                  {whoopConnected ? (
                    <button 
                      onClick={() => handleCategorySelect('whoop')}
                      className="px-4 py-1.5 text-sm font-normal text-white bg-lime-500 rounded-none hover:bg-lime-600 transition-colors mr-1"
                    >
                      Connected
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleCategorySelect('whoop')}
                      disabled={whoopConnecting}
                      className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors disabled:opacity-50 mr-1"
                    >
                      {whoopConnecting ? 'Connecting...' : 'Connect'}
                    </button>
                  )}
                </div>

                <div className="flex justify-between items-center h-11">
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <img src="/images/fitbit.svg" alt="Fitbit" className="h-6" />
                    </div>
                    <p className="text-sm font-normal text-gray-900 ml-2.5">Fitbit</p>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('fitbit')}
                    className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                  >
                    Connect
                  </button>
                </div>

                <div className="flex justify-between items-center h-11">
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <img src="/images/garmin.svg" alt="Garmin" className="h-6" />
                    </div>
                    <p className="text-sm font-normal text-gray-900 ml-2.5">Garmin</p>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('garmin')}
                    className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                  >
                    Connect
                  </button>
                </div>

                {/* Manual Tracking Categories */}
                <div className="flex justify-between items-center h-11">
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <Brain className="w-5 h-5 text-gray-900" />
                    </div>
                    <p className="text-sm font-normal text-gray-900 ml-2.5">Productivity</p>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('productivity')}
                    className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                  >
                    Manual
                  </button>
                </div>

                <div className="flex justify-between items-center h-11">
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <BookOpen className="w-5 h-5 text-gray-900" />
                    </div>
                    <p className="text-sm font-normal text-gray-900 ml-2.5">Learning</p>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('education')}
                    className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                  >
                    Manual
                  </button>
                </div>

                <div className="flex justify-between items-center h-11">
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <Activity className="w-5 h-5 text-gray-900" />
                    </div>
                    <p className="text-sm font-normal text-gray-900 ml-2.5">Fitness & Health</p>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('fitness')}
                    className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                  >
                    Manual
                  </button>
                </div>

                <div className="flex justify-between items-center h-11">
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <FlaskConical className="w-5 h-5 text-gray-900" />
                    </div>
                    <p className="text-sm font-normal text-gray-900 ml-2.5">Experiments</p>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('experiments')}
                    className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                  >
                    Manual
                  </button>
                </div>
            </div>
          ) : (
            // Habit Selection for Category
            <div>
                {displayedHabits.length > 0 ? (
                  displayedHabits.map((habit, index) => (
                    <div key={habit.value} className="flex justify-between items-center h-12 px-3">
                      <p className="text-sm font-normal text-gray-900">{habit.label}</p>
                      <button
                        onClick={() => handleHabitClick(habit)}
                        disabled={isCreating}
                        className="px-3 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors disabled:opacity-50"
                      >
                        {isCreating ? 'Creating...' : 'Track'}
                      </button>
                    </div>
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