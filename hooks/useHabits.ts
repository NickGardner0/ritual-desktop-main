import { useState, useEffect, useCallback } from 'react';
import apiClient from '@/lib/api-client';
import { supabase } from '@/lib/supabase';
import { HabitsService } from '@/lib/habits-service';

export interface Habit {
  id: string;
  name: string;
  category: string;
  integration_source?: string;
  unit_type?: string;
  is_custom: boolean;
  created_at: string;
  updated_at?: string;
  user_id: string;
  icon?: string;
}

export interface HabitLog {
  id: string;
  habit_id: string;
  user_id: string;
  date: string;
  time?: string;
  duration?: number;
  amount?: number;
  unit?: string;
  status: 'completed' | 'skipped' | 'missed';
  notes?: string;
  created_at: string;
}

export function useHabits() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all habits for the current user
  const fetchHabits = useCallback(async (forceLoading = false) => {
    try {
      // Only show loading spinner if we don't have data yet or forced
      if (habits.length === 0 || forceLoading) {
        setLoading(true);
      }
      setError(null);
      
      // Use session instead of getUser() to reduce auth requests
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        console.warn('No authenticated session found for habits');
        setHabits([]);
        return;
      }
      const user = session.user;

      const { data: fetchedHabits, error } = await supabase
        .from('habits')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase error fetching habits:', error);
        setError('Failed to fetch habits');
        return;
      }

      setHabits(fetchedHabits || []);
    } catch (err) {
      console.error('Error fetching habits:', err);
      setError('Failed to fetch habits');
    } finally {
      setLoading(false);
    }
  }, []); // Remove habits.length dependency to prevent infinite loops

  // Fetch habit logs
  const fetchHabitLogs = useCallback(async (habitId?: string, startDate?: string, endDate?: string) => {
    try {
      // Use session instead of getUser() to reduce auth requests
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        console.warn('No authenticated session found for habit logs');
        return [];
      }
      const user = session.user;

      let query = supabase
        .from('habit_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('date', { ascending: false });

      if (habitId) {
        query = query.eq('habit_id', habitId);
      }
      if (startDate) {
        query = query.gte('date', startDate);
      }
      if (endDate) {
        query = query.lte('date', endDate);
      }

      const { data: logs, error } = await query;
      
      if (error) {
        console.error('Supabase error fetching habit logs:', error);
        setError('Failed to fetch habit logs');
        return [];
      }

      const habitLogs = logs || [];
      
      setHabitLogs(habitLogs);
      return habitLogs;
    } catch (err) {
      console.error('Error fetching habit logs:', err);
      setError('Failed to fetch habit logs');
      return [];
    }
  }, []);

  // Create a new habit
  const createHabit = async (habitData: {
    name: string;
    category: string;
    unit_type?: string;
    is_custom?: boolean;
    integration_source?: string;
    icon?: string;
  }) => {
    try {
      const habitsService = new HabitsService();
      const newHabit = await habitsService.createHabit(habitData) as Habit;
      setHabits(prev => [...prev, newHabit]);
      return newHabit;
    } catch (err) {
      console.error('Error creating habit:', err);
      setError('Failed to create habit');
      throw err;
    }
  };

  // Update a habit
  const updateHabit = async (habitId: string, habitData: Partial<Habit>) => {
    try {
      const updatedHabit = await apiClient.habits.update(habitId, habitData) as Habit;
      setHabits(prev => prev.map(h => h.id === habitId ? updatedHabit : h));
      return updatedHabit;
    } catch (err) {
      console.error('Error updating habit:', err);
      setError('Failed to update habit');
      throw err;
    }
  };

  // Delete a habit
  const deleteHabit = async (habitId: string) => {
    try {
      // Use session instead of getUser() to reduce auth requests
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('No authenticated session found');
      }
      const user = session.user;

      // Delete the habit from Supabase
      const { error } = await supabase
        .from('habits')
        .delete()
        .eq('id', habitId)
        .eq('user_id', user.id); // Ensure user can only delete their own habits

      if (error) {
        console.error('Supabase error deleting habit:', error);
        throw error;
      }

      // Update local state
      setHabits(prev => prev.filter(h => h.id !== habitId));
      // Also remove related logs
      setHabitLogs(prev => prev.filter(log => log.habit_id !== habitId));
      
      console.log('✅ Habit deleted successfully from database');
    } catch (err) {
      console.error('Error deleting habit:', err);
      setError('Failed to delete habit');
      throw err;
    }
  };

  // Log a habit completion
  const logHabitCompletion = async (logData: {
    habit_id: string;
    date: string;
    duration?: number;
    amount?: number;
    unit?: string;
    status?: 'completed' | 'skipped' | 'missed';
    notes?: string;
  }) => {
    try {
      // Use session instead of getUser() to reduce auth requests
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('No authenticated session found');
      }
      const user = session.user;

      const { data: newLog, error } = await supabase
        .from('habit_logs')
        .insert({
          ...logData,
          user_id: user.id,
          status: logData.status || 'completed'
        })
        .select()
        .single();

      if (error) {
        console.error('Supabase error creating habit log:', error);
        throw error;
      }

      setHabitLogs(prev => [...prev, newLog]);
      return newLog;
    } catch (err) {
      console.error('Error logging habit:', err);
      setError('Failed to log habit');
      throw err;
    }
  };

  // Update a habit log
  const updateHabitLog = async (logId: string, logData: Partial<HabitLog>) => {
    try {
      const updatedLog = await apiClient.habitLogs.update(logId, logData) as HabitLog;
      setHabitLogs(prev => prev.map(log => log.id === logId ? updatedLog : log));
      return updatedLog;
    } catch (err) {
      console.error('Error updating habit log:', err);
      setError('Failed to update habit log');
      throw err;
    }
  };

  // Delete a habit log
  const deleteHabitLog = async (logId: string) => {
    try {
      await apiClient.habitLogs.delete(logId);
      setHabitLogs(prev => prev.filter(log => log.id !== logId));
    } catch (err) {
      console.error('Error deleting habit log:', err);
      setError('Failed to delete habit log');
      throw err;
    }
  };

  // Get logs for a specific habit
  const getHabitLogs = (habitId: string) => {
    return habitLogs.filter(log => log.habit_id === habitId);
  };

  // Get today's logs
  const getTodaysLogs = () => {
    const today = new Date().toISOString().split('T')[0];
    return habitLogs.filter(log => log.date === today);
  };

  // Get habit statistics
  const getHabitStats = (habitId: string) => {
    const logs = getHabitLogs(habitId);
    const completedLogs = logs.filter(log => log.status === 'completed');
    
    return {
      totalLogs: logs.length,
      completedCount: completedLogs.length,
      completionRate: logs.length > 0 ? (completedLogs.length / logs.length) * 100 : 0,
      lastCompleted: completedLogs.length > 0 ? completedLogs[completedLogs.length - 1].date : null,
      currentStreak: calculateStreak(logs)
    };
  };

  // Calculate current streak
  const calculateStreak = (logs: HabitLog[]) => {
    const completedLogs = logs
      .filter(log => log.status === 'completed')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (completedLogs.length === 0) return 0;

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < completedLogs.length; i++) {
      const logDate = new Date(completedLogs[i].date);
      logDate.setHours(0, 0, 0, 0);
      
      const daysDiff = Math.floor((today.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDiff === i) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  };

  // Optimistic update for instant UI feedback with cumulative logic
  const updateHabitLogOptimistically = useCallback((habitData: {
    habitName: string;
    amount?: number;
    duration?: number;
    unit?: string;
    activity: string;
    date?: string;
  }) => {
    const today = habitData.date || new Date().toISOString().split('T')[0];
    const currentTimestamp = new Date().toISOString(); // Full timestamp with date and time
    
    // Find the matching habit
    const habit = habits.find(h => 
      h.name.toLowerCase().includes(habitData.habitName.toLowerCase()) ||
      habitData.habitName.toLowerCase().includes(h.name.toLowerCase())
    );
    
    if (!habit) {
      console.warn('Could not find habit for optimistic update:', habitData.habitName);
      return;
    }

    // Check for existing log today for this habit
    const existingTodayLog = habitLogs.find(log => 
      log.habit_id === habit.id && log.date === today
    );

    // Calculate cumulative amounts
    let newAmount = habitData.amount || null;
    let newDuration = habitData.duration ? habitData.duration * 60 : null; // Convert to seconds

    if (existingTodayLog) {
      // Add to existing amounts for cumulative totals
      if (newAmount && existingTodayLog.amount) {
        newAmount = newAmount + existingTodayLog.amount;
      } else if (!newAmount && existingTodayLog.amount) {
        newAmount = existingTodayLog.amount;
      }

      if (newDuration && existingTodayLog.duration) {
        newDuration = newDuration + existingTodayLog.duration;
      } else if (!newDuration && existingTodayLog.duration) {
        newDuration = existingTodayLog.duration;
      }
    }

    console.log('🔍 Optimistic update with cumulative logic:', {
      existingLog: existingTodayLog,
      inputAmount: habitData.amount,
      inputDuration: habitData.duration,
      newAmount,
      newDuration,
      unit: habitData.unit
    });
    
    const optimisticLog: HabitLog = {
      id: existingTodayLog?.id || `temp-${Date.now()}`, // Use existing ID or temp ID
      habit_id: habit.id,
      user_id: existingTodayLog?.user_id || '', // Preserve user_id if updating
      date: today,
      time: currentTimestamp,
      status: 'completed',
      amount: newAmount,
      duration: newDuration,
      unit: habitData.unit || existingTodayLog?.unit || null,
      notes: existingTodayLog?.notes 
        ? `${existingTodayLog.notes}; ${habitData.activity}` 
        : `Logged via AI: ${habitData.activity}`,
      created_at: existingTodayLog?.created_at || new Date().toISOString()
    };

    // Update state optimistically
    setHabitLogs(prevLogs => {
      if (existingTodayLog) {
        // Update existing log with cumulative amounts
        return prevLogs.map(log => 
          log.id === existingTodayLog.id ? optimisticLog : log
        );
      } else {
        // Add new log
        return [optimisticLog, ...prevLogs];
      }
    });

    console.log('✅ Optimistic cumulative update applied for:', habitData.habitName, {
      finalAmount: newAmount,
      finalDuration: newDuration,
      unit: habitData.unit
    });
  }, [habits, habitLogs]);

  // Load habits on mount - only once
  useEffect(() => {
    let mounted = true;
    let hasRun = false;
    
    const loadHabits = async () => {
      if (mounted && !hasRun) {
        hasRun = true;
        await fetchHabits();
      }
    };
    
    loadHabits();
    
    return () => {
      mounted = false;
    };
  }, []); // No dependencies - run only once on mount

  return {
    habits,
    habitLogs,
    loading,
    error,
    fetchHabits,
    fetchHabitLogs,
    createHabit,
    updateHabit,
    deleteHabit,
    logHabitCompletion,
    updateHabitLog,
    deleteHabitLog,
    getHabitLogs,
    getTodaysLogs,
    getHabitStats,
    updateHabitLogOptimistically, // Add optimistic update function
    setError // Allow manual error clearing
  };
} 