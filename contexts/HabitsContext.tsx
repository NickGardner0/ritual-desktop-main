'use client';

import * as React from 'react';
import { useAuth } from './AuthContext';
import { habitsService } from '@/lib/habits-service';

// Import types from habits-service to maintain consistency
import type { Habit as ServiceHabit, HabitLog as ServiceHabitLog } from '@/lib/habits-service';

// Extended habit type with additional UI properties
export interface Habit extends ServiceHabit {
  emoji?: string;
  streak?: number;
  color?: string;
}

// Extended habit log type with user_id for UI
export interface HabitLog extends Omit<ServiceHabitLog, 'duration'> {
  user_id?: string;
  duration: number;
  status: 'completed' | 'missed' | 'skipped';
}

// Props for the context provider
export interface HabitsContextType {
  // Habits data
  habits: Habit[];
  habitLogs: HabitLog[];
  
  // Loading states
  isLoading: boolean;
  isLoadingLogs: boolean;
  
  // Error states
  error: Error | null;
  
  // Actions
  fetchHabits: () => Promise<void>;
  fetchHabitLogs: () => Promise<void>;
  logHabit: (habitLog: Omit<HabitLog, 'id'>) => Promise<void>;
  
  // Computed values
  totalMinutesToday: number;
  completedHabitsToday: number;
  currentStreak: number;
  
  // Legacy support (for existing components)
  selectedHabits: string[];
  setSelectedHabits: (habits: string[]) => void;
  customHabits: Array<{value: string; label: string; emoji: string; stat: string}>;
  addCustomHabit: (habit: any) => void;
  habitOrder: string[];
  setHabitOrder: (order: string[]) => void;
  fetchHabitsFromApi: () => Promise<void>;
}

// Create the context with default values
export const HabitsContext = React.createContext<HabitsContextType>({
  habits: [],
  habitLogs: [],
  isLoading: false,
  isLoadingLogs: false,
  error: null,
  fetchHabits: async () => {},
  fetchHabitLogs: async () => {},
  logHabit: async () => {},
  totalMinutesToday: 0,
  completedHabitsToday: 0,
  currentStreak: 0,
  selectedHabits: [],
  setSelectedHabits: () => {},
  customHabits: [],
  addCustomHabit: () => {},
  habitOrder: [],
  setHabitOrder: () => {},
  fetchHabitsFromApi: async () => {},
});

// Create a provider component for this context
export function HabitsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  
  // Main state
  const [habits, setHabits] = React.useState<Habit[]>([]);
  const [habitLogs, setHabitLogs] = React.useState<HabitLog[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  
  // Legacy state for backward compatibility
  const [selectedHabits, setSelectedHabits] = React.useState<string[]>([]);
  const [customHabits, setCustomHabits] = React.useState<Array<{value: string; label: string; emoji: string; stat: string}>>([]);
  const [habitOrder, setHabitOrder] = React.useState<string[]>([]);
  
  // Refs to prevent duplicate fetches
  const hasFetchedHabits = React.useRef(false);
  const isFetching = React.useRef(false);

  // Fetch habits when user is available
  const fetchHabits = React.useCallback(async () => {
    if (!user || isFetching.current) return;
    if (hasFetchedHabits.current && habits.length > 0) {
      console.log(' Habits already fetched, skipping...');
      return;
    }
    
    console.log('🔄 Starting habit fetch for user:', user.email);
    isFetching.current = true;
    setIsLoading(true);
    setError(null);
    
    try {
      const fetchedHabits = await habitsService.getHabits();
      setHabits(fetchedHabits);
      hasFetchedHabits.current = true;
      console.log('✅ Habits successfully loaded in provider');
    } catch (err) {
      console.error('❌ Failed to fetch habits in provider:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch habits'));
    } finally {
      setIsLoading(false);
      isFetching.current = false;
    }
  }, [user, habits.length]);
  
  // Fetch habit logs
  const fetchHabitLogs = React.useCallback(async () => {
    if (!user) return;
    
    setIsLoadingLogs(true);
    try {
      const logs = await habitsService.getHabitLogs();
      const processedLogs = logs.map(log => ({
        ...log,
        duration: log.duration || 0
      }));
      setHabitLogs(processedLogs);
    } catch (err) {
      console.error('Failed to fetch habit logs:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  }, [user]);
  
  // Log a habit
  const logHabit = React.useCallback(async (habitLog: Omit<HabitLog, 'id'>) => {
    try {
      const newLog = await habitsService.logHabit(habitLog);
      const processedLog = {
        ...newLog,
        duration: newLog.duration || 0
      };
      setHabitLogs(prev => [...prev, processedLog]);
      // Refresh habits to update streaks
      await fetchHabits();
    } catch (err) {
      console.error('Failed to log habit:', err);
      throw err;
    }
  }, [fetchHabits]);
  
  // Initial data fetch - only when user becomes available for the first time
  React.useEffect(() => {
    if (user && !hasFetchedHabits.current && !isFetching.current) {
      console.log('🔄 User authenticated, triggering initial data fetch');
      fetchHabits();
      fetchHabitLogs();
    }
  }, [user, fetchHabits, fetchHabitLogs]);
  
  // Reset fetch flag when user changes (logout/login)
  React.useEffect(() => {
    if (!user) {
      console.log('🔄 User logged out, resetting fetch flags');
      hasFetchedHabits.current = false;
      isFetching.current = false;
      setHabits([]);
      setHabitLogs([]);
      setError(null);
    }
  }, [user]);

  // Save to localStorage when state changes
  React.useEffect(() => {
          if (typeof window !== 'undefined') {
        localStorage.setItem('selectedHabits', JSON.stringify(selectedHabits));
      }
  }, [selectedHabits]);

  React.useEffect(() => {
          if (typeof window !== 'undefined') {
        localStorage.setItem('habitOrder', JSON.stringify(habitOrder));
      }
  }, [habitOrder]);

  React.useEffect(() => {
          if (typeof window !== 'undefined') {
        localStorage.setItem('customHabits', JSON.stringify(customHabits));
      }
  }, [customHabits]);


  // Computed values
  const totalMinutesToday = React.useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return habitLogs
      .filter(log => log.date === today && log.status === 'completed')
      .reduce((total, log) => total + (log.duration || 0), 0);
  }, [habitLogs]);
  
  const completedHabitsToday = React.useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return habitLogs.filter(log => log.date === today && log.status === 'completed').length;
  }, [habitLogs]);
  
  const currentStreak = React.useMemo(() => {
    if (habits.length === 0) return 0;
    return Math.max(...habits.map(h => h.streak || 0));
  }, [habits]);
  
  // Legacy function for backward compatibility
  const fetchHabitsFromApi = React.useCallback(async () => {
    await fetchHabits();
  }, [fetchHabits]);
  
  // Legacy function for adding custom habits
  const addCustomHabit = React.useCallback((habit: any) => {
    const legacyHabit = {
      value: habit.value || habit.id,
      label: habit.label || habit.name,
      emoji: habit.emoji,
      stat: habit.stat || 'New habit'
    };
    setCustomHabits(prev => [...prev, legacyHabit]);
    setSelectedHabits(prev => [...prev, legacyHabit.value]);
    setHabitOrder(prev => [...prev, legacyHabit.value]);
  }, []);
  
  // Update legacy customHabits when habits change
  React.useEffect(() => {
    const legacyHabits = habits.map(habit => ({
      value: habit.id || '',
      label: habit.name,
      emoji: habit.emoji || '🔄',
      stat: (habit.streak || 0) > 0 ? `${habit.streak} day streak` : 'No streak yet'
    }));
    setCustomHabits(legacyHabits);
  }, [habits]);

  return (
    <HabitsContext.Provider
      value={{
        habits,
        habitLogs,
        isLoading,
        isLoadingLogs,
        error,
        fetchHabits,
        fetchHabitLogs,
        logHabit,
        totalMinutesToday,
        completedHabitsToday,
        currentStreak,
        selectedHabits,
        setSelectedHabits,
        customHabits,
        addCustomHabit,
        habitOrder,
        setHabitOrder,
        fetchHabitsFromApi,
      }}
    >
      {children}
    </HabitsContext.Provider>
  );
}

// Custom hook for using the habits context
export function useHabits() {
  const context = React.useContext(HabitsContext);
  
  if (context === undefined) {
    throw new Error('useHabits must be used within a HabitsProvider');
  }
  
  return context;
} 