/**
 * ⚠️ DEPRECATED: This service is legacy hybrid code
 * 
 * DO NOT USE THIS FOR NEW FEATURES!
 * 
 * All habit management now uses:
 * - Frontend: HabitsContext (contexts/HabitsContext.tsx)
 * - Backend: Python FastAPI (backend/main.py)
 * - Database: SQLite + Tinybird
 * - Auth: Clerk
 * 
 * This file is kept only for backward compatibility.
 * Use `useHabits()` hook from HabitsContext instead!
 * 
 * NOTE: Supabase imports removed - this file is deprecated
 */

// Removed Supabase import - using Clerk + Python backend now
import { tinybirdService } from './tinybird-service';
import { tinybirdAnalyticsService } from './tinybird-analytics-service';

export interface Habit {
  id?: string;
  name: string;
  category: string;
  icon?: string;
  is_custom?: boolean;
  integration_source?: string;
  created_at?: string;
  updated_at?: string;
  user_id?: string;
  unit_type?: string;
}

export interface HabitLog {
  id?: string;
  habit_id: string;
  duration?: number;
  amount?: number;
  unit?: string;
  date: string;
  status: 'completed' | 'skipped' | 'missed';
  notes?: string;
}

export interface HabitMetrics {
  habit_id: string;
  habit_name: string;
  total_completed: number;
  total_duration: number | null;
  total_amount: number | null;
  last_completed_date: string | null;
}

/**
 * Tinybird-powered Habits Service
 * 
 * This service implements the hybrid architecture:
 * - Supabase: User profiles, habit definitions, auth tokens
 * - Tinybird: Analytics data, habit logs, metrics
 */
export class TinybirdHabitsService {
  private habitsCache: Map<string, Habit[]> = new Map();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  /**
   * Get habits from Supabase with caching
   */
  async getHabits(userId?: string): Promise<Habit[]> {
    try {
      // If no userId provided, try to get from auth
      if (!userId) {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        
        if (userError || !user) {
          console.error('❌ No authenticated user found for habits');
          return [];
        }
        
        userId = user.id;
      }
      
      // Check cache first
      const cacheKey = `habits_${userId}`;
      const cached = this.habitsCache.get(cacheKey);
      if (cached) {
        return cached;
      }
      
      // Fetch from Supabase
      const { data, error } = await supabase
        .from('habits')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error fetching habits:', error);
        return [];
      }
      
      // Cache the results
      this.habitsCache.set(cacheKey, data || []);
      setTimeout(() => this.habitsCache.delete(cacheKey), this.cacheTimeout);
      
      return data || [];
    } catch (error) {
      console.error('❌ Error in getHabits:', error);
      return [];
    }
  }

  /**
   * Get habit metrics from Tinybird
   */
  async getHabitMetrics(userId?: string, daysBack: number = 30): Promise<HabitMetrics[]> {
    try {
      // If no userId provided, try to get from auth
      if (!userId) {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        
        if (userError || !user) {
          console.error('❌ No authenticated user found for metrics');
          return [];
        }
        
        userId = user.id;
      }
      
      // Get metrics from Tinybird
      return await tinybirdAnalyticsService.getHabitMetrics(userId, daysBack);
    } catch (error) {
      console.error('❌ Error in getHabitMetrics:', error);
      return [];
    }
  }
  
  /**
   * Get habit logs from Tinybird
   */
  async getHabitLogs(
    userId?: string,
    habitId?: string,
    startDate?: string,
    endDate?: string,
    limit: number = 100
  ): Promise<any[]> {
    try {
      console.log('🔍 tinybird-habits-service: getHabitLogs called with:', { userId, habitId, startDate, endDate, limit });
      
      // If no userId provided, try to get from auth
      if (!userId) {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        
        if (userError || !user) {
          console.error('❌ No authenticated user found for logs');
          return [];
        }
        
        userId = user.id;
      }
      
      // Calculate days back from date range or default to 30
      let daysBack = 30;
      if (startDate) {
        const start = new Date(startDate);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - start.getTime());
        daysBack = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }
      
      console.log('🔍 Fetching logs with daysBack:', daysBack);
      
      // Get logs from Tinybird
      const logs = await tinybirdAnalyticsService.getRecentLogs(
        userId,
        habitId,
        daysBack,
        limit
      );
      
      console.log('✅ tinybird-habits-service: Received logs:', logs ? (logs.data ? logs.data.length : 0) : 0);
      
      if (logs && logs.data) {
        return logs.data;
      } else {
        console.warn('⚠️ No logs data returned from Tinybird analytics service');
        return [];
      }
    } catch (error) {
      console.error('❌ Error in getHabitLogs:', error);
      return [];
    }
  }
  
  /**
   * Get habit trends from Tinybird
   */
  async getHabitTrends(
    userId?: string,
    habitId?: string,
    period: 'day' | 'week' = 'day',
    daysBack: number = 30
  ): Promise<any[]> {
    try {
      // If no userId provided, try to get from auth
      if (!userId) {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        
        if (userError || !user) {
          console.error('❌ No authenticated user found for trends');
          return [];
        }
        
        userId = user.id;
      }
      
      // Get trends from Tinybird
      const trends = await tinybirdAnalyticsService.getHabitTrends(
        userId,
        habitId,
        period,
        daysBack
      );
      
      return trends;
    } catch (error) {
      console.error('❌ Error in getHabitTrends:', error);
      return [];
    }
  }
  
  /**
   * Create a new habit in Supabase
   */
  async createHabit(habit: Habit, userId: string): Promise<Habit | null> {
    try {
      const { data, error } = await supabase
        .from('habits')
        .insert({
          ...habit,
          user_id: userId,
          is_custom: true,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error creating habit:', error);
        return null;
      }
      
      // Clear cache
      this.clearHabitsCache(userId);
      
      return data;
    } catch (error) {
      console.error('❌ Error in createHabit:', error);
      return null;
    }
  }
  
  /**
   * Update an existing habit in Supabase
   */
  async updateHabit(habitId: string, updates: Partial<Habit>, userId: string): Promise<Habit | null> {
    try {
      const { data, error } = await supabase
        .from('habits')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', habitId)
        .eq('user_id', userId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error updating habit:', error);
        return null;
      }
      
      // Clear cache
      this.clearHabitsCache(userId);
      
      return data;
    } catch (error) {
      console.error('❌ Error in updateHabit:', error);
      return null;
    }
  }
  
  /**
   * Delete a habit from Supabase
   */
  async deleteHabit(habitId: string, userId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('habits')
        .delete()
        .eq('id', habitId)
        .eq('user_id', userId);
      
      if (error) {
        console.error('❌ Error deleting habit:', error);
        return false;
      }
      
      // Clear cache
      this.clearHabitsCache(userId);
      
      return true;
    } catch (error) {
      console.error('❌ Error in deleteHabit:', error);
      return false;
    }
  }
  
  /**
   * Log a habit completion directly to Tinybird
   */
  async logHabit(log: HabitLog, userId: string): Promise<boolean> {
    try {
      // Get habit details
      const { data: habit, error: habitError } = await supabase
        .from('habits')
        .select('name')
        .eq('id', log.habit_id)
        .eq('user_id', userId)
        .single();
      
      if (habitError || !habit) {
        console.error('❌ Error finding habit:', habitError);
        return false;
      }
      
      // Format for Tinybird
      const currentTimestamp = new Date().toISOString();
      const tinybirdLog = {
        id: crypto.randomUUID(),
        habit_id: log.habit_id,
        habit_name: habit.name,
        user_id: userId,
        date: log.date,
        timestamp: currentTimestamp,
        status: log.status,
        duration: log.duration || 0,
        amount: log.amount || 0,
        unit: log.unit || '',
        notes: log.notes || '',
        source: 'manual',
        integration_id: '',
        whoop_metric_type: '',
        metadata: '{}',
        created_at: currentTimestamp
      };
      
      // Send to Tinybird
      const result = await tinybirdService.ingestHabitLog(tinybirdLog);
      
      if (!result.success) {
        console.error('❌ Error logging to Tinybird:', result.error);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error in logHabit:', error);
      return false;
    }
  }
  
  /**
   * Clear habits cache for a user
   */
  clearHabitsCache(userId?: string): void {
    if (userId) {
      this.habitsCache.delete(`habits_${userId}`);
    } else {
      this.habitsCache.clear();
    }
  }
}

// Export singleton instance
export const tinybirdHabitsService = new TinybirdHabitsService();
