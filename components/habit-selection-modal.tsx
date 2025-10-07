'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as LucideIcons from 'lucide-react';
import { ChevronDown, CheckCircle2 } from 'lucide-react';
import IconPicker from './IconPicker';
import { HabitsService } from '../lib/habits-service';
import { useHabits } from '@/hooks/useHabits';
import { supabase } from '@/lib/supabase';

// Define habit arrays locally
const productivityHabits = [
  { value: 'deep-work', label: 'Deep Work Sessions' },
  { value: 'focus-sessions', label: 'Focus Sessions' },
  { value: 'pomodoro-technique', label: 'Pomodoro Technique' },
  { value: 'time-blocking', label: 'Time Blocking' },
  { value: 'task-completion', label: 'Daily Task Completion' },
  { value: 'priority-tasks', label: 'Priority Task Focus' },
  { value: 'email-batching', label: 'Email Batching' },
  { value: 'inbox-zero', label: 'Inbox Zero' },
  { value: 'meeting-free-blocks', label: 'Meeting-Free Blocks' },
  { value: 'calendar-review', label: 'Calendar Review' },
  { value: 'daily-planning', label: 'Daily Planning' },
  { value: 'weekly-planning', label: 'Weekly Planning' },
  { value: 'monthly-review', label: 'Monthly Review' },
  { value: 'goal-setting', label: 'Goal Setting' },
  { value: 'habit-tracking', label: 'Habit Tracking' },
  { value: 'reflection-journaling', label: 'Reflection Journaling' },
  { value: 'gratitude-practice', label: 'Gratitude Practice' },
  { value: 'morning-routine', label: 'Morning Routine' },
  { value: 'evening-routine', label: 'Evening Routine' },
  { value: 'workspace-organization', label: 'Workspace Organization' },
  { value: 'digital-declutter', label: 'Digital Declutter' },
  { value: 'notification-management', label: 'Notification Management' },
  { value: 'distraction-free-time', label: 'Distraction-Free Time' },
  { value: 'single-tasking', label: 'Single-Tasking' },
  { value: 'breaks-taken', label: 'Regular Breaks' },
  { value: 'standup-checkin', label: 'Daily Standup' },
  { value: 'team-communication', label: 'Team Communication' },
  { value: 'project-updates', label: 'Project Updates' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'code-review', label: 'Code Review' },
  { value: 'learning-hour', label: 'Learning Hour' },
  { value: 'skill-development', label: 'Skill Development' },
  { value: 'end-of-day-shutdown', label: 'End of Day Shutdown' },
  { value: 'energy-management', label: 'Energy Management' },
  { value: 'decision-logging', label: 'Decision Logging' }
];

const fitnessHealthHabits = [
  { value: 'morning-workout', label: 'Morning Workout' },
  { value: 'evening-workout', label: 'Evening Workout' },
  { value: 'strength-training', label: 'Strength Training' },
  { value: 'cardio-exercise', label: 'Cardio Exercise' },
  { value: 'yoga-practice', label: 'Yoga Practice' },
  { value: 'pilates', label: 'Pilates' },
  { value: 'daily-walk', label: 'Daily Walk' },
  { value: 'running', label: 'Running' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'swimming', label: 'Swimming' },
  { value: 'hiking', label: 'Hiking' },
  { value: 'stretching', label: 'Stretching' },
  { value: 'mobility-work', label: 'Mobility Work' },
  { value: 'foam-rolling', label: 'Foam Rolling' },
  { value: 'meditation', label: 'Meditation' },
  { value: 'mindfulness', label: 'Mindfulness Practice' },
  { value: 'breathing-exercises', label: 'Breathing Exercises' },
  { value: 'cold-therapy', label: 'Cold Therapy' },
  { value: 'sauna-session', label: 'Sauna Session' },
  { value: 'hydration', label: 'Daily Hydration' },
  { value: 'water-intake', label: 'Water Intake Tracking' },
  { value: 'nutrition-logging', label: 'Nutrition Logging' },
  { value: 'meal-prep', label: 'Meal Preparation' },
  { value: 'healthy-snacking', label: 'Healthy Snacking' },
  { value: 'vitamin-supplements', label: 'Vitamin Supplements' },
  { value: 'sleep-schedule', label: 'Sleep Schedule' },
  { value: 'sleep-hygiene', label: 'Sleep Hygiene' },
  { value: 'bedtime-routine', label: 'Bedtime Routine' },
  { value: 'wake-up-routine', label: 'Wake-up Routine' },
  { value: 'screen-time-limit', label: 'Screen Time Limit' },
  { value: 'posture-check', label: 'Posture Check' },
  { value: 'eye-exercises', label: 'Eye Exercises' },
  { value: 'dental-hygiene', label: 'Dental Hygiene' },
  { value: 'skincare-routine', label: 'Skincare Routine' },
  { value: 'stress-management', label: 'Stress Management' },
  { value: 'mental-health-check', label: 'Mental Health Check-in' }
];

const educationHabits = [
  { value: 'daily-reading', label: 'Daily Reading' },
  { value: 'book-reading', label: 'Book Reading' },
  { value: 'article-reading', label: 'Article Reading' },
  { value: 'research-papers', label: 'Research Papers' },
  { value: 'online-courses', label: 'Online Courses' },
  { value: 'video-tutorials', label: 'Video Tutorials' },
  { value: 'podcast-listening', label: 'Educational Podcasts' },
  { value: 'audiobook-listening', label: 'Audiobook Listening' },
  { value: 'language-study', label: 'Language Study' },
  { value: 'vocabulary-building', label: 'Vocabulary Building' },
  { value: 'flashcards', label: 'Flashcards/Spaced Repetition' },
  { value: 'anki-reviews', label: 'Anki Reviews' },
  { value: 'duolingo-practice', label: 'Duolingo Practice' },
  { value: 'coding-practice', label: 'Coding Practice' },
  { value: 'algorithm-study', label: 'Algorithm Study' },
  { value: 'technical-skills', label: 'Technical Skills' },
  { value: 'skill-practice', label: 'Skill Practice' },
  { value: 'instrument-practice', label: 'Instrument Practice' },
  { value: 'art-practice', label: 'Art Practice' },
  { value: 'writing-practice', label: 'Writing Practice' },
  { value: 'creative-writing', label: 'Creative Writing' },
  { value: 'journaling', label: 'Learning Journal' },
  { value: 'reflection-notes', label: 'Reflection Notes' },
  { value: 'note-taking', label: 'Note Taking' },
  { value: 'mind-mapping', label: 'Mind Mapping' },
  { value: 'lecture-attendance', label: 'Lecture Attendance' },
  { value: 'webinar-attendance', label: 'Webinar Attendance' },
  { value: 'conference-sessions', label: 'Conference Sessions' },
  { value: 'group-study', label: 'Group Study' },
  { value: 'study-sessions', label: 'Study Sessions' },
  { value: 'focused-learning', label: 'Focused Learning Time' },
  { value: 'research-time', label: 'Research Time' },
  { value: 'project-work', label: 'Project Work' },
  { value: 'homework-completion', label: 'Homework Completion' },
  { value: 'assignment-work', label: 'Assignment Work' },
  { value: 'practice-tests', label: 'Practice Tests' },
  { value: 'quiz-preparation', label: 'Quiz Preparation' },
  { value: 'exam-study', label: 'Exam Study' },
  { value: 'reading-summaries', label: 'Reading Summaries' },
  { value: 'concept-review', label: 'Concept Review' },
  { value: 'problem-solving', label: 'Problem Solving' },
  { value: 'case-studies', label: 'Case Studies' },
  { value: 'presentation-prep', label: 'Presentation Prep' },
  { value: 'public-speaking', label: 'Public Speaking Practice' },
  { value: 'study-breaks', label: 'Study Breaks' },
  { value: 'learning-goals', label: 'Learning Goals Review' },
  { value: 'progress-tracking', label: 'Learning Progress Tracking' }
];

const experimentsHabits = [
  { value: 'new-recipes', label: 'Try New Recipes' },
  { value: 'cooking-experiments', label: 'Cooking Experiments' },
  { value: 'new-cuisines', label: 'Try New Cuisines' },
  { value: 'meal-timing', label: 'Meal Timing Experiments' },
  { value: 'intermittent-fasting', label: 'Intermittent Fasting' },
  { value: 'diet-experiments', label: 'Diet Experiments' },
  { value: 'no-caffeine', label: 'No Caffeine Challenge' },
  { value: 'no-sugar', label: 'No Sugar Challenge' },
  { value: 'no-alcohol', label: 'No Alcohol Challenge' },
  { value: 'water-only', label: 'Water Only Days' },
  { value: 'new-supplements', label: 'Try New Supplements' },
  { value: 'supplement-cycling', label: 'Supplement Cycling' },
  { value: 'cold-showers', label: 'Cold Showers' },
  { value: 'ice-baths', label: 'Ice Baths' },
  { value: 'heat-therapy', label: 'Heat Therapy' },
  { value: 'breathing-techniques', label: 'New Breathing Techniques' },
  { value: 'sleep-schedule-experiment', label: 'Sleep Schedule Experiments' },
  { value: 'polyphasic-sleep', label: 'Polyphasic Sleep' },
  { value: 'wake-up-times', label: 'Wake-up Time Experiments' },
  { value: 'bedtime-experiments', label: 'Bedtime Experiments' },
  { value: 'new-exercise', label: 'Try New Exercise' },
  { value: 'workout-timing', label: 'Workout Timing Tests' },
  { value: 'exercise-intensity', label: 'Exercise Intensity Tests' },
  { value: 'movement-patterns', label: 'New Movement Patterns' },
  { value: 'productivity-tests', label: 'Productivity Method Tests' },
  { value: 'work-schedules', label: 'Work Schedule Experiments' },
  { value: 'focus-techniques', label: 'Focus Technique Tests' },
  { value: 'time-management', label: 'Time Management Tests' },
  { value: 'habit-experiments', label: 'Habit Formation Tests' },
  { value: 'habit-stacking', label: 'Habit Stacking Tests' },
  { value: 'routine-experiments', label: 'Routine Experiments' },
  { value: 'morning-routines', label: 'Morning Routine Tests' },
  { value: 'evening-routines', label: 'Evening Routine Tests' },
  { value: 'digital-detox', label: 'Digital Detox' },
  { value: 'social-media-breaks', label: 'Social Media Breaks' },
  { value: 'phone-free-time', label: 'Phone-Free Time' },
  { value: 'screen-time-limits', label: 'Screen Time Limit Tests' },
  { value: 'notification-experiments', label: 'Notification Experiments' },
  { value: 'mindfulness-experiments', label: 'Mindfulness Experiments' },
  { value: 'meditation-techniques', label: 'New Meditation Techniques' },
  { value: 'gratitude-experiments', label: 'Gratitude Practice Tests' },
  { value: 'journaling-methods', label: 'Journaling Method Tests' },
  { value: 'creative-projects', label: 'Creative Projects' },
  { value: 'art-experiments', label: 'Art Experiments' },
  { value: 'writing-experiments', label: 'Writing Experiments' },
  { value: 'music-experiments', label: 'Music Experiments' },
  { value: 'skill-challenges', label: 'Skill Challenges' },
  { value: 'learning-methods', label: 'Learning Method Tests' },
  { value: 'memory-techniques', label: 'Memory Technique Tests' },
  { value: 'social-experiments', label: 'Social Experiments' },
  { value: 'communication-tests', label: 'Communication Tests' },
  { value: 'relationship-experiments', label: 'Relationship Experiments' },
  { value: 'wellness-trials', label: 'Wellness Trials' },
  { value: 'stress-tests', label: 'Stress Management Tests' },
  { value: 'energy-experiments', label: 'Energy Level Experiments' },
  { value: 'mood-tracking', label: 'Mood Tracking Experiments' },
  { value: 'early-wake-up', label: 'Early Wake Up Challenge' },
  { value: 'late-wake-up', label: 'Late Wake Up Test' },
  { value: 'nap-experiments', label: 'Nap Experiments' }
];

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

export function HabitSelectionModal({ isOpen, onClose, onHabitSelect, onHabitCreated, initialCategory = null }: HabitSelectionModalProps) {
  const { createHabit } = useHabits(); // Add useHabits hook
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
  const [selectedIcon, setSelectedIcon] = useState('target');
  const [selectedMetric, setSelectedMetric] = useState('Count');
  const [isMetricDropdownOpen, setIsMetricDropdownOpen] = useState(false);
  const metricDropdownRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const floatingLayerRef = useRef<HTMLDivElement>(null);
  const metricBtnRef = useRef<HTMLButtonElement>(null);
  
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

  // Check if Whoop is connected on mount
  useEffect(() => {
    checkWhoopConnection();
  }, []);

  async function checkWhoopConnection() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;

      const { data, error } = await supabase
        .from('whoop_connections')
        .select('is_active')
        .eq('user_id', session.user.id)
        .eq('is_active', true)
        .single();

      if (data && !error) {
        setWhoopConnected(true);
      }
    } catch (error) {
      console.error('Error checking Whoop connection:', error);
    }
  }

  async function handleWhoopConnect() {
    try {
      setWhoopConnecting(true);
      
      // Get current user session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        console.error('No active session');
        setWhoopConnecting(false);
        return;
      }
      
      // Store flag to show modal after OAuth redirect
      sessionStorage.setItem('whoop_return_to_modal', 'true');
      
      // Get the authorization URL from our API with user ID
      const response = await fetch(`/api/integrations/whoop/auth?userId=${session.user.id}`);
      const data = await response.json();
      
      if (data.authUrl) {
        console.log('🔗 Redirecting to Whoop authorization...');
        // Redirect to Whoop authorization page
        window.location.href = data.authUrl;
      }
    } catch (error) {
      console.error('Error connecting to Whoop:', error);
      setWhoopConnecting(false);
    }
  }

  const handleCategorySelect = (category: string) => {
    // If Whoop is selected and not connected, trigger OAuth
    if (category === 'whoop' && !whoopConnected) {
      handleWhoopConnect();
      return;
    }
    
    // If Whoop is already connected, show metrics selection
    setSelectedCategory(category);
  };

  const handleBack = () => {
    if (showCustomization) {
      setShowCustomization(false);
      setSelectedHabit(null);
    } else {
      setSelectedCategory(null);
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
    if (!selectedHabit) {
      console.error('❌ No habit selected');
      return;
    }
    
    setIsCreating(true);
    
    try {
      const newHabit = {
        name: selectedHabit.label,
        category: categoryMap[selectedCategory || 'productivity'] || 'manual',
        is_custom: false,
        sensor_type: 'Manual',
        icon: kebabToPascal(selectedIcon),
        unit_type: selectedMetric
      };
      
      // Create habit using the useHabits hook
      const backendHabit = await createHabit(newHabit);

      console.log('✅ Habit created successfully in backend:', backendHabit);

      // If this is a Whoop habit, trigger automatic sync
      if (selectedCategory === 'whoop') {
        console.log('🔄 Triggering automatic Whoop sync...');
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user?.id) {
            await fetch('/api/integrations/whoop/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: session.user.id }),
            });
            console.log('✅ Whoop sync completed');
          }
        } catch (syncError) {
          console.error('⚠️ Failed to auto-sync Whoop data:', syncError);
          // Don't block habit creation if sync fails
        }
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
      setSelectedIcon('target');
      setSelectedMetric('Count');
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
      case 'garmin':
        return [
          { value: 'vo2-max', label: 'VO2 Max' },
          { value: 'training-load', label: 'Training Load' },
          { value: 'body-battery', label: 'Body Battery' }
        ];
      case 'productivity':
        return productivityHabits;
      case 'fitness':
        return fitnessHealthHabits;
      case 'education':
        return educationHabits;
      case 'experiments':
        return experimentsHabits;
      default:
        return [];
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'fixed' }}>
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-black/10 backdrop-blur-sm" onClick={onClose} style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'absolute' }}></div>
      
      <div 
        ref={cardRef}
        className={`relative bg-white w-full flex flex-col shadow-lg border border-gray-300 z-10 transition-all duration-300 ${
          showCustomization 
            ? 'max-w-[700px] h-[550px]' // Optimal height for 7-row dropdowns
            : 'max-w-[525px] max-h-[60vh]' // Original size for selection
        }`}
      >
        {/* floating layer that confines dropdowns to the card */}
        <div
          ref={floatingLayerRef}
          className="pointer-events-none absolute inset-0 z-50 overflow-hidden"
        />
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-2 flex-shrink-0">
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
                {selectedCategory ? `${selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)} Habits` : 'Start tracking anything'}
              </h2>
            </div>
          )}
            <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            </button>
        </div>

        {/* Description */}
        {!selectedCategory && (
          <div className="px-6 pb-2 flex-shrink-0">
            <p className="text-sm text-gray-600">
              Ritual works best when you connect and integrate your wearable devices with manual self tracking tools.
            </p>
        </div>
        )}

        {/* Search Bar */}
        <div className="px-8 py-2 flex items-center gap-4 flex-shrink-0">
          {showCustomization ? (
            <div className="flex items-center gap-4 w-full">
              <label className="block text-sm font-medium text-gray-700 w-20 text-left">Title</label>
              <div className="flex-1 max-w-md">
                <input
                  type="text"
                  placeholder={selectedHabit?.label}
                  value={selectedHabit?.label}
                  readOnly={true}
                  className="w-full px-4 py-3 border border-gray-300 bg-gray-50 text-sm text-gray-700 h-[48px]"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search habits..."
                value=""
                className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          )}
        </div>

        {/* Content Area - Scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {showCustomization ? (
            // Habit Customization View - Larger Layout
            <div className="px-8 pb-8 pt-4">
              {/* Icon Selection - Raycast Style */}
              <div className="mb-8 flex items-center gap-4">
                <label className="block text-sm font-medium text-gray-700 w-20 text-left">Icon</label>
                <div className="flex-1 max-w-md">
                  <IconPicker
                    value={selectedIcon}
                    onChange={(name) => setSelectedIcon(name)}
                    anchorClassName="flex items-center justify-between w-full px-4 py-3 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-[#F3F3F3] focus:outline-none h-[48px]"
                    portalRef={floatingLayerRef}
                    withinCardRef={cardRef}
                    minMenuHeight={260}
                    desiredMenuWidth={384}
                  />
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
                      className="flex items-center justify-between w-full px-4 py-3 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-[#F3F3F3] focus:outline-none h-[48px]"
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
                  <div className="flex items-center gap-3 px-4 py-3 border border-gray-300 bg-gray-50 text-sm text-gray-700 h-[48px]">
                    <LucideIcons.Calendar className="w-4 h-4" />
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
            <div className="px-6 pb-3 pt-0">
              <div className="space-y-0">
                
                                {/* Wearables & Devices - Connect */}
                <div className="flex justify-between items-center py-2">
                  <div className="flex items-center">
                    <div className="flex items-center justify-center mr-4">
                      <img src="/images/Screen_Time.svg" alt="Screen Time" className="w-8 h-8" onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const nextSibling = e.currentTarget.nextElementSibling as HTMLElement;
                        if (nextSibling) nextSibling.style.display = 'block';
                      }} />
                      <svg className="w-7 h-7 text-gray-700" style={{display: 'none'}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">Screen Time</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('screentime')}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3] transition-colors"
                  >
                    Connect
                  </button>
                </div>

                <div className="flex justify-between items-center py-1.5">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-4">
                      <img src="/images/apple-logo.png" alt="Apple Watch" className="w-5 h-5" onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const nextSibling = e.currentTarget.nextElementSibling as HTMLElement;
                        if (nextSibling) nextSibling.style.display = 'block';
                      }} />
                      <svg className="w-4 h-4 text-gray-700" style={{display: 'none'}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">Apple Watch</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('applewatch')}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3] transition-colors"
                  >
                    Connect
                  </button>
                </div>

                <div className="flex justify-between items-center py-1.5">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-4">
                      <img src="/images/oura-logo.png" alt="Oura" className="w-5 h-5" onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const nextSibling = e.currentTarget.nextElementSibling as HTMLElement;
                        if (nextSibling) nextSibling.style.display = 'block';
                      }} />
                      <svg className="w-4 h-4 text-gray-700" style={{display: 'none'}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">Oura Ring</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('oura')}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3] transition-colors"
                  >
                    Connect
                  </button>
                </div>

                <div className="flex justify-between items-center py-2">
                  <div className="flex items-center">
                    <div className="flex items-center justify-center mr-4">
                      <img src="/images/whoop.svg" alt="Whoop" className="w-8 h-8" onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const nextSibling = e.currentTarget.nextElementSibling as HTMLElement;
                        if (nextSibling) nextSibling.style.display = 'block';
                      }} />
                      <svg className="w-7 h-7 text-gray-700" style={{display: 'none'}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">Whoop</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('whoop')}
                    disabled={whoopConnecting}
                    className={`px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                      whoopConnected 
                        ? 'bg-lime-500 text-white hover:bg-lime-600 border-lime-500' 
                        : 'text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3]'
                    }`}
                  >
                    {whoopConnecting ? 'Connecting...' : whoopConnected ? 'Connected' : 'Connect'}
                  </button>
                </div>

                <div className="flex justify-between items-center py-1.5">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-4">
                      <img src="/images/garmin-logo.png" alt="Garmin" className="w-5 h-5" onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const nextSibling = e.currentTarget.nextElementSibling as HTMLElement;
                        if (nextSibling) nextSibling.style.display = 'block';
                      }} />
                      <svg className="w-4 h-4 text-gray-700" style={{display: 'none'}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">Garmin</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('garmin')}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3] transition-colors"
                  >
                    Connect
                  </button>
                </div>

                                {/* Manual Tracking Categories */}
                <div className="flex justify-between items-center py-1.5">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-4">
                      <LucideIcons.CheckSquare className="w-4 h-4 text-gray-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">Productivity</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('productivity')}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3] transition-colors"
                  >
                    Manual
                  </button>
                </div>

                <div className="flex justify-between items-center py-1.5">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-4">
                      <LucideIcons.BookCheck className="w-4 h-4 text-gray-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">Education</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('education')}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3] transition-colors"
                  >
                    Manual
                  </button>
                </div>

                <div className="flex justify-between items-center py-1.5">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-4">
                      <LucideIcons.Heart className="w-4 h-4 text-gray-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">Fitness & Health</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('fitness')}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3] transition-colors"
                  >
                    Manual
                  </button>
                </div>

                <div className="flex justify-between items-center py-1.5">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-4">
                      <LucideIcons.Zap className="w-4 h-4 text-gray-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">Experiments</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('experiments')}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3] transition-colors"
                  >
                    Manual
                  </button>
                </div>

                <div className="flex justify-between items-center py-1.5">
                  <div className="flex items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 mr-4">
                      <LucideIcons.Plus className="w-4 h-4 text-gray-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">Custom Habits</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCategorySelect('custom')}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3] transition-colors"
                  >
                    Manual
                  </button>
                </div>

                  </div>
            </div>
          ) : (
            // Habit Selection for Category
            <div className="px-6 pb-3 pt-0">
              
                            <div className="space-y-0 overflow-y-auto">
                {getHabitsForCategory(selectedCategory).map((habit, index) => (
                  <div key={habit.value} className="flex justify-between items-center py-1.5">
                    <div className="flex items-center">
                      <div>
                        <p className="text-sm font-medium leading-none">{habit.label}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleHabitClick(habit)}
                      disabled={isCreating}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3] transition-colors disabled:opacity-50"
                    >
                      {isCreating ? 'Creating...' : 'Track'}
                    </button>
                  </div>
                ))}
                  </div>
                </div>
              )}
          </div>

        
                </div>
          </div>
  );

  // Use portal to render at document body level for full coverage
  return typeof window !== 'undefined' ? createPortal(modalContent, document.body) : null;
} 