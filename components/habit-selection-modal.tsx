'use client';

import React, { useState, useRef, useEffect, lazy, Suspense, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  ChevronDown, 
  CheckCircle2, 
  X, 
  Calendar, 
  CheckSquare, 
  BookCheck, 
  Heart, 
  Zap, 
  Plus 
} from 'lucide-react';
import { HabitsService } from '../lib/habits-service';
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

// Lazy load IconPicker to reduce initial bundle size
const IconPicker = lazy(() => import('./IconPicker'));

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
  const { getToken } = useAuth(); // Add Clerk auth hook
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(initialCategory);
  
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
          { value: 'steps', label: 'Steps' },
          { value: 'workouts', label: 'Workouts' },
          { value: 'heart-rate', label: 'Heart Rate' },
          { value: 'calories', label: 'Calories Burned' }
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
          const categoryMatch = {
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

  // Check if Whoop is connected on mount and when modal opens
  useEffect(() => {
    if (isOpen) {
      checkWhoopConnection();
    }
  }, [isOpen]);

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
    'Count', 'Minutes', 'Hours', 'Miles', 'Kilometers', 'Steps', 'Calories', 'Pages',
    'Milligrams', 'Grams', 'Kilograms', 'Pounds', 'Ounces', 'Liters', 'Cups', 'Glasses',
    'Reps', 'Sets', 'Percentage', 'Points', 'Sessions', 'Chapters', 'Episodes', 'Articles',
    'Words', 'Lines', 'Tasks', 'Projects', 'Emails', 'Calls', 'Meetings', 'Breaks'
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
      const newHabit = {
        name: habitName,
        category: categoryMap[selectedCategory || 'productivity'] || 'manual',
        is_custom: selectedCategory === 'custom',
        sensor_type: 'Manual',
        icon: selectedIcon ? kebabToPascal(selectedIcon) : 'Target',
        unit_type: selectedMetric,
        integration_source: selectedCategory === 'whoop' ? 'whoop' 
                          : selectedCategory === 'applewatch' ? 'applewatch'
                          : selectedCategory === 'oura' ? 'oura'
                          : selectedCategory === 'fitbit' ? 'fitbit'
                          : selectedCategory === 'garmin' ? 'garmin'
                          : null
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'fixed' }}>
      {/* Backdrop - Midday exact style */}
      <div className="absolute inset-0 bg-[#f6f6f3]/60 dark:bg-[#121212]/80" onClick={onClose} style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'absolute' }}></div>
      
      <div 
        ref={cardRef}
        className="relative bg-white w-[90vw] max-w-xl h-[600px] flex flex-col shadow-xl border border-gray-300 z-10 transition-all duration-300 rounded-none"
      >
        {/* floating layer that confines dropdowns to the card */}
        <div
          ref={floatingLayerRef}
          className="pointer-events-none absolute inset-0 z-50 overflow-hidden"
        />
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0">
          {showCustomization ? (
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
              <h2 className="text-lg font-semibold text-gray-900">
                {selectedCategory 
                  ? selectedCategory === 'whoop' ? 'Whoop Habits' 
                  : selectedCategory === 'fitness' ? 'Fitness & Health Habits'
                  : `${selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)} Habits` 
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
        {!selectedCategory && (
          <div className="px-6 pb-3 flex-shrink-0">
            <p className="text-sm text-gray-600">
              Ritual works best when you connect and integrate your wearable devices with manual self tracking tools.
            </p>
        </div>
        )}

        {/* Search Bar */}
        <div className="px-6 pb-3 flex items-center gap-4 flex-shrink-0">
          {showCustomization ? (
            <div className="flex items-center gap-4 w-full">
              <label className="block text-sm font-medium text-gray-700 w-20 text-left">Title</label>
              <div className="flex-1 max-w-md">
                <input
                  type="text"
                  placeholder={selectedCategory === 'custom' ? 'Enter habit name...' : selectedHabit?.label}
                  value={selectedCategory === 'custom' ? customHabitName : (selectedHabit?.label || '')}
                  onChange={(e) => {
                    if (selectedCategory === 'custom') {
                      setCustomHabitName(e.target.value);
                    }
                  }}
                  readOnly={selectedCategory !== 'custom'}
                  className={`w-full px-4 py-3 border border-gray-200 rounded-none text-sm text-gray-700 h-[48px] ${
                    selectedCategory === 'custom' ? 'bg-white' : 'bg-gray-50'
                  }`}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search habits..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-none focus:outline-none focus:border-gray-400 text-sm"
              />
            </div>
          )}
        </div>

        {/* Content Area - Scrollable */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {showCustomization ? (
            // Habit Customization View - Larger Layout
            <div className="space-y-6">
              {/* Icon Selection - Raycast Style */}
              <div className="mb-8 flex items-center gap-4">
                <label className="block text-sm font-medium text-gray-700 w-20 text-left">Icon</label>
                <div className="flex-1 max-w-md">
                  <Suspense fallback={
                    <div className="flex items-center justify-between w-full px-4 py-3 border border-gray-300 bg-white text-sm font-medium text-gray-700 h-[48px]">
                      <span>Loading icons...</span>
                    </div>
                  }>
                    <IconPicker
                      value={selectedIcon}
                      onChange={(name) => setSelectedIcon(name)}
                      anchorClassName="flex items-center justify-between w-full px-4 py-3 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-[#F3F3F3] focus:outline-none h-[48px]"
                      portalRef={floatingLayerRef}
                      withinCardRef={cardRef}
                      minMenuHeight={260}
                      desiredMenuWidth={384}
                    />
                  </Suspense>
                </div>
              </div>

              {/* Metric Type Selection - Raycast Style */}
              <div className="mb-8 flex items-center gap-4">
                <label className="block text-sm font-medium text-gray-700 w-20 text-left">Metric</label>
                <div className="flex-1 max-w-md">
                  <div className="relative" ref={metricDropdownRef}>
                    <button
                      ref={metricBtnRef}
                      onClick={() => setIsMetricDropdownOpen((v) => !v)}
                      className="flex items-center justify-between w-full px-4 py-3 border border-gray-200 rounded-none bg-white text-sm font-medium text-gray-700 hover:bg-[#F3F3F3] focus:outline-none h-[48px]"
                    >
                      <span>{selectedMetric}</span>
                      <ChevronDown className={`h-4 w-4 transition-transform ${isMetricDropdownOpen ? 'rotate-180' : ''}`} />
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
                                className={`flex items-center w-full px-4 py-2 text-sm hover:bg-[#F3F3F3] text-left ${
                                  selectedMetric === metric ? 'bg-gray-100 text-gray-700' : 'text-gray-700'
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

              {/* Start Date Selection - Raycast Style */}
              <div className="mb-8 flex items-center gap-4">
                <label className="block text-sm font-medium text-gray-700 w-20 text-left">Start Date</label>
                <div className="flex-1 max-w-md">
                  <div className="flex items-center gap-3 px-4 py-3 border border-gray-200 rounded-none bg-gray-50 text-sm text-gray-700 h-[48px]">
                    <Calendar className="w-4 h-4" />
                    <span>Today, {new Date().toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}</span>
                  </div>
                </div>
              </div>

              {/* Start Tracking Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleCreateHabit}
                  disabled={isCreating}
                  className="px-6 py-2 bg-black text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                  {isCreating ? 'Starting...' : 'Start Tracking'}
                </button>
              </div>
            </div>
          ) : !selectedCategory ? (
            // Category Selection
            <div className="space-y-0.5">
                
                                {/* Custom Habit - Manual */}
                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-3">
                      <Plus className="w-4 h-4 text-gray-700" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Custom Habit</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('custom')}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors"
                  >
                    Manual
                  </button>
                </div>

                                {/* Wearables & Devices - Connect */}
                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex items-center justify-center mr-3">
                      <img src="/images/Screen_Time.svg" alt="Screen Time" className="w-7 h-7" onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const nextSibling = e.currentTarget.nextElementSibling as HTMLElement;
                        if (nextSibling) nextSibling.style.display = 'block';
                      }} />
                      <svg className="w-6 h-6 text-gray-700" style={{display: 'none'}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Screen Time</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('screentime')}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors"
                  >
                    Connect
                  </button>
                </div>

                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center mr-3">
                      <svg className="h-6 w-6" viewBox="0 0 814 1000" fill="currentColor">
                        <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
                      </svg>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Apple Watch</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('applewatch')}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors"
                  >
                    Connect
                  </button>
                </div>

                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center mr-3">
                      <img src="/images/oura.svg" alt="Oura Ring" className="h-28" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Oura Ring</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('oura')}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors"
                  >
                    Connect
                  </button>
                </div>

                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center mr-3">
                      <img src="/images/whoop.svg" alt="Whoop" className="h-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Whoop</p>
                    </div>
                  </div>
                  {whoopConnected ? (
                    <button 
                      onClick={() => handleCategorySelect('whoop')}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-lime-500 rounded-none hover:bg-lime-600 transition-colors"
                    >
                      Connected
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleCategorySelect('whoop')}
                      disabled={whoopConnecting}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors disabled:opacity-50"
                    >
                      {whoopConnecting ? 'Connecting...' : 'Connect'}
                    </button>
                  )}
                </div>

                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center mr-3">
                      <img src="/images/fitbit.svg" alt="Fitbit" className="h-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Fitbit</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('fitbit')}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors"
                  >
                    Connect
                  </button>
                </div>

                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center mr-3">
                      <img src="/images/garmin.svg" alt="Garmin" className="h-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Garmin</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('garmin')}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors"
                  >
                    Connect
                  </button>
                </div>

                                {/* Manual Tracking Categories */}
                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-3">
                      <CheckSquare className="w-4 h-4 text-gray-700" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Productivity</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('productivity')}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors"
                  >
                    Manual
                  </button>
                </div>

                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-3">
                      <BookCheck className="w-4 h-4 text-gray-700" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Education</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('education')}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors"
                  >
                    Manual
                  </button>
                </div>

                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-3">
                      <Heart className="w-4 h-4 text-gray-700" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Fitness & Health</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('fitness')}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors"
                  >
                    Manual
                  </button>
                </div>

                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-3">
                      <Zap className="w-4 h-4 text-gray-700" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Experiments</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('experiments')}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors"
                  >
                    Manual
                  </button>
                </div>

                <div className="flex justify-between items-center py-2 px-3">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-3">
                      <Plus className="w-4 h-4 text-gray-700" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">Custom Habits</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('custom')}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors"
                  >
                    Manual
                  </button>
                </div>
            </div>
          ) : (
            // Habit Selection for Category
            <div className="space-y-0.5">
                {displayedHabits.length > 0 ? (
                  displayedHabits.map((habit, index) => (
                    <div key={habit.value} className="flex justify-between items-center py-2 px-3">
                      <div className="flex items-center">
                        <div>
                          <p className="text-sm font-medium leading-none">{habit.label}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleHabitClick(habit)}
                        disabled={isCreating}
                        className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-none hover:bg-[#F3F3F3] transition-colors disabled:opacity-50"
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
                    <p className="text-sm font-medium text-gray-900 mb-1">No habits found</p>
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