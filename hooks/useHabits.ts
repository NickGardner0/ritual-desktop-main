import { useState, useEffect } from 'react';
import apiClient from '@/lib/api-client';

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
  const fetchHabits = async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchedHabits = await apiClient.habits.getAll() as Habit[];
      setHabits(fetchedHabits);
    } catch (err) {
      console.error('Error fetching habits:', err);
      setError('Failed to fetch habits');
    } finally {
      setLoading(false);
    }
  };

  // Fetch habit logs
  const fetchHabitLogs = async (habitId?: string, startDate?: string, endDate?: string) => {
    try {
      const logs = await apiClient.habitLogs.getAll(habitId, startDate, endDate) as HabitLog[];
      setHabitLogs(logs);
      return logs;
    } catch (err) {
      console.error('Error fetching habit logs:', err);
      setError('Failed to fetch habit logs');
      return [];
    }
  };

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
      const newHabit = await apiClient.habits.create(habitData) as Habit;
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
      await apiClient.habits.delete(habitId);
      setHabits(prev => prev.filter(h => h.id !== habitId));
      // Also remove related logs
      setHabitLogs(prev => prev.filter(log => log.habit_id !== habitId));
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
      const newLog = await apiClient.habitLogs.create(logData) as HabitLog;
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

  // Load habits on mount
  useEffect(() => {
    fetchHabits();
  }, []);

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
    setError // Allow manual error clearing
  };
} 