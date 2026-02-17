/**
 * ⚠️ DEPRECATED: This service is legacy code
 * 
 * DO NOT USE THIS FOR NEW FEATURES!
 * 
 * All analytics now uses:
 * - Frontend: Tinybird service (lib/tinybird-service.ts)
 * - Backend: Python FastAPI analytics endpoints
 * - Auth: Clerk
 * 
 * This file is kept only for backward compatibility.
 * 
 * NOTE: Supabase imports are deprecated - migration to Clerk + Python backend needed
 */

// TODO: Remove Supabase dependency and migrate to Clerk + Python backend
import { createClient } from '@supabase/supabase-js';
import { tinybirdService } from './tinybird-service';

// Types for habit metrics
export interface HabitMetrics {
  habit_id: string;
  habit_name: string;
  total_completed: number;
  total_duration: number | null;
  total_amount: number | null;
  last_completed_date: string | null;
}

export interface HabitTrend {
  date: string;
  habit_id: string;
  habit_name: string;
  count: number;
  duration_seconds: number;
  amount: number;
  unit: string;
}

export class TinybirdAnalyticsService {
  private supabase;
  
  // Simple in-memory cache for habit definitions
  private habitsCache: Map<string, any[]> = new Map();
  
  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon";
    this.supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  
  /**
   * Get habit definitions from Supabase (these stay in Supabase)
   */
  async getHabits(userId?: string): Promise<any[]> {
    try {
      // If no userId provided, try to get from auth
      if (!userId) {
        const { data: { user }, error: userError } = await this.supabase.auth.getUser();
        
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
      const { data, error } = await this.supabase
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
        const { data: { user }, error: userError } = await this.supabase.auth.getUser();
        
        if (userError || !user) {
          console.error('❌ No authenticated user found for metrics');
          return [];
        }
        
        userId = user.id;
      }
      
      // Get summary from Tinybird
      const summary = await tinybirdService.getUserHabitsSummary(userId, daysBack);
      
      if (!summary || !summary.data) {
        console.error('❌ No summary data returned from Tinybird');
        return [];
      }
      
      // Transform to expected format
      const metrics: HabitMetrics[] = summary.data.map((item: any) => ({
        habit_id: item.habit_id,
        habit_name: item.habit_name,
        total_completed: item.completed_count || 0,
        total_duration: item.total_duration_seconds || null,
        total_amount: item.total_amount || null,
        last_completed_date: item.last_completed_date || null
      }));
      
      return metrics;
    } catch (error) {
      console.error('❌ Error in getHabitMetrics:', error);
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
  ): Promise<HabitTrend[]> {
    try {
      // If no userId provided, try to get from auth
      if (!userId) {
        const { data: { user }, error: userError } = await this.supabase.auth.getUser();
        
        if (userError || !user) {
          console.error('❌ No authenticated user found for trends');
          return [];
        }
        
        userId = user.id;
      }
      
      // Get trends from Tinybird
      const trends = await tinybirdService.getHabitTrends(
        userId,
        period,
        daysBack,
        habitId
      );
      
      if (!trends || !trends.data) {
        console.error('❌ No trend data returned from Tinybird');
        return [];
      }
      
      // Transform to expected format
      const trendData: HabitTrend[] = trends.data.map((item: any) => ({
        date: item.date,
        habit_id: item.habit_id,
        habit_name: item.habit_name,
        count: item.count || 0,
        duration_seconds: item.duration_seconds || 0,
        amount: item.amount || 0,
        unit: item.unit || ''
      }));
      
      return trendData;
    } catch (error) {
      console.error('❌ Error in getHabitTrends:', error);
      return [];
    }
  }
  
  /**
   * Get recent habit logs from Tinybird
   */
  async getRecentLogs(
    userId?: string,
    habitId?: string,
    daysBack: number = 7,
    limit: number = 100
  ): Promise<any> {
    try {
      console.log('🔍 tinybird-analytics-service: getRecentLogs called with:', { userId, habitId, daysBack, limit });
      
      // If no userId provided, try to get from auth
      if (!userId) {
        const { data: { user }, error: userError } = await this.supabase.auth.getUser();
        
        if (userError || !user) {
          console.error('❌ No authenticated user found for logs');
          return { data: [] };
        }
        
        userId = user.id;
      }
      
      // Get logs from Tinybird using the proper pipe
      console.log('🔍 Calling tinybirdService.getRecentHabitLogs with:', { userId, daysBack, limit, habitId });
      const logs = await tinybirdService.getRecentHabitLogs(
        userId,
        daysBack,
        limit,
        habitId
      );
      
      console.log('🔍 Raw response from Tinybird:', logs);
      
      if (!logs || !logs.data) {
        console.error('❌ No log data returned from Tinybird');
        return { data: [] };
      }
      
      console.log('✅ tinybird-analytics-service: Received logs:', logs.data.length);
      console.log('🔍 First few logs:', logs.data.slice(0, 3));
      
      return logs;
    } catch (error) {
      console.error('❌ Error in getRecentLogs:', error);
      return { data: [] };
    }
  }
  
  /**
   * Clear habits cache
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
export const tinybirdAnalyticsService = new TinybirdAnalyticsService();
