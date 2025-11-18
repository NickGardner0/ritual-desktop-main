/**
 * Server-Side Data Fetchers
 * 
 * These functions run ONLY on the server, enabling:
 * - Fast parallel data fetching
 * - Direct backend access
 * - No client bundle bloat
 * - Server-side caching
 * 
 * Following Midday's pattern: https://github.com/midday-ai/midday
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

// Server-only environment variables
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8000';

/**
 * Get server-side auth token from Clerk
 */
async function getServerAuthToken(): Promise<string | null> {
  try {
    const { getToken } = await auth();
    const token = await getToken();
    return token;
  } catch (error) {
    console.error('❌ Failed to get server auth token:', error);
    return null;
  }
}

/**
 * Get authenticated user ID
 */
export async function getAuthenticatedUserId(): Promise<string> {
  console.log('🔐 [Server] Getting authenticated user ID...');
  
  try {
    const { userId } = await auth();
    
    if (!userId) {
      console.log('❌ [Server] No user ID found, redirecting to auth');
      redirect('/auth');
    }
    
    console.log('✅ [Server] Authenticated user ID:', userId);
    return userId;
  } catch (error) {
    console.error('❌ [Server] Error getting user ID:', error);
    throw error;
  }
}

/**
 * Server-side fetch with auth
 */
async function serverFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getServerAuthToken();
  
  const response = await fetch(`${PYTHON_API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Server fetch error (${response.status}):`, errorText);
    throw new Error(`API Error (${response.status}): ${errorText}`);
  }
  
  return response.json();
}

// ================================
// HABIT DATA FETCHERS
// ================================

export interface Habit {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  icon?: string;
  unit_type: 'duration' | 'amount' | 'completion';
  target_value?: number;
  target_unit?: string;
  frequency: 'daily' | 'weekly' | 'custom';
  is_active: boolean;
  display_order?: number;
  created_at: string;
  updated_at?: string;
}

export interface HabitLog {
  id: string;
  habit_id: string;
  user_id: string;
  duration?: number;
  amount?: number;
  date: string;
  completed_at: string;
  status: 'completed' | 'skipped' | 'pending';
  notes?: string;
  unit?: string;
}

/**
 * Fetch all habits for authenticated user
 * Called from Server Components
 */
export async function getHabits(): Promise<Habit[]> {
  console.log('📊 [Server] getHabits() called');
  const startTime = Date.now();
  
  try {
    const userId = await getAuthenticatedUserId();
    console.log('📊 [Server] Fetching habits for user:', userId, `(auth took ${Date.now() - startTime}ms)`);
    
    const fetchStart = Date.now();
    const habits = await serverFetch<Habit[]>('/api/habits');
    console.log('✅ [Server] Fetched', habits.length, 'habits in', Date.now() - fetchStart, 'ms');
    console.log('✅ [Server] Total getHabits() time:', Date.now() - startTime, 'ms');
    return habits;
  } catch (error) {
    console.error('❌ [Server] Failed to fetch habits:', error);
    console.error('❌ [Server] Error details:', error);
    return [];
  }
}

/**
 * Fetch habit logs for authenticated user
 */
export async function getHabitLogs(habitId?: string): Promise<HabitLog[]> {
  const userId = await getAuthenticatedUserId();
  
  console.log('📊 [Server] Fetching habit logs for user:', userId);
  
  try {
    const endpoint = habitId ? `/api/habits/${habitId}/logs` : '/api/habit-logs';
    const logs = await serverFetch<HabitLog[]>(endpoint);
    console.log('✅ [Server] Fetched', logs.length, 'logs');
    return logs;
  } catch (error) {
    console.error('❌ [Server] Failed to fetch logs:', error);
    return [];
  }
}

// ================================
// ANALYTICS DATA FETCHERS
// ================================

export interface AnalyticsData {
  habits: Habit[];
  summaryMetrics: {
    totalHabits: number;
    totalLogs: number;
    completionRate: number;
    bestHabit: { name: string; rate: number } | null;
  };
  trends: any[];
}

/**
 * Fetch analytics summary data
 * Combines multiple queries into one efficient server call
 */
export async function getAnalyticsSummary(daysBack: number = 365): Promise<AnalyticsData> {
  console.log('📊 [Server] getAnalyticsSummary() called - START');
  const startTime = Date.now();
  
  try {
    const userId = await getAuthenticatedUserId();
    console.log('📊 [Server] Fetching analytics data (parallel)...', `(auth took ${Date.now() - startTime}ms)`);
    
    const fetchStart = Date.now();
    // ✅ PARALLEL FETCHING - All at once!
    const [habits, metricsResponse] = await Promise.all([
      serverFetch<Habit[]>('/api/habits'),
      serverFetch<any>(`/api/analytics/habits/summary?user_id=${userId}&days_back=${daysBack}`),
    ]);
    
    console.log('✅ [Server] Parallel fetch completed in', Date.now() - fetchStart, 'ms');
    
    const metrics = metricsResponse.data || [];
    
    console.log('✅ [Server] Fetched habits:', habits.length);
    console.log('✅ [Server] Fetched metrics:', metrics.length);
    
    // Merge habits with metrics
    const habitsWithMetrics = habits.map((habit: Habit) => {
      const metric = metrics.find((m: any) => m.habit_id === habit.id);
      return {
        habit_id: habit.id,
        habit_name: habit.name,
        unit: habit.target_unit || 'count',
        icon: habit.icon,
        total_logs: metric?.total_logs || 0,
        completed_count: metric?.completed_count || 0,
        total_duration_seconds: metric?.total_duration_seconds || 0,
        total_amount: metric?.total_amount || 0,
        last_completed_date: metric?.last_completed_date || null,
        first_log_date: metric?.first_log_date || null,
      };
    });
    
    // Calculate summary metrics
    const totalHabits = habitsWithMetrics.length;
    const totalLogs = habitsWithMetrics.reduce((sum, h) => sum + (h.total_logs || 0), 0);
    const totalCompleted = habitsWithMetrics.reduce((sum, h) => sum + (h.completed_count || 0), 0);
    const completionRate = totalLogs > 0 ? Math.round((totalCompleted / totalLogs) * 100) : 0;
    
    // Find best performing habit
    const habitsWithRate = habitsWithMetrics
      .filter((h) => h.total_logs >= 3)
      .map((h) => ({
        name: h.habit_name,
        rate: h.total_logs > 0 ? (h.completed_count / h.total_logs) * 100 : 0,
      }))
      .sort((a, b) => b.rate - a.rate);
    
    const bestHabit = habitsWithRate.length > 0 ? habitsWithRate[0] : null;
    
    return {
      habits: habitsWithMetrics,
      summaryMetrics: {
        totalHabits,
        totalLogs,
        completionRate,
        bestHabit,
      },
      trends: [],
    };
  } catch (error) {
    console.error('❌ [Server] Failed to fetch analytics:', error);
    throw error;
  }
}

/**
 * Fetch analytics trends data
 */
export async function getAnalyticsTrends(
  daysBack: number = 30,
  habitIds?: string[]
): Promise<any[]> {
  const userId = await getAuthenticatedUserId();
  
  console.log('📊 [Server] Fetching analytics trends...');
  
  try {
    const response = await serverFetch<any>(
      `/api/analytics/habits/trends?user_id=${userId}&period=day&days_back=${daysBack}`
    );
    
    const allLogs = response.data || [];
    console.log('✅ [Server] Fetched', allLogs.length, 'trend entries');
    
    // Filter by habit IDs if provided
    if (habitIds && habitIds.length > 0) {
      return allLogs.filter((log: any) => habitIds.includes(log.habit_id));
    }
    
    return allLogs;
  } catch (error) {
    console.error('❌ [Server] Failed to fetch trends:', error);
    return [];
  }
}

// ================================
// INTEGRATIONS DATA FETCHERS
// ================================

export interface WhoopIntegration {
  connected: boolean;
  lastSync?: string;
}

/**
 * Check Whoop integration status
 */
export async function getWhoopStatus(): Promise<WhoopIntegration> {
  await getAuthenticatedUserId(); // Ensure authenticated
  
  console.log('📊 [Server] Checking Whoop integration status...');
  
  try {
    const data = await serverFetch<WhoopIntegration>('/api/integrations/whoop/status');
    console.log('✅ [Server] Whoop status:', data);
    return data;
  } catch (error) {
    console.error('❌ [Server] Failed to check Whoop status:', error);
    return { connected: false };
  }
}

// ================================
// DASHBOARD DATA FETCHERS
// ================================

/**
 * Fetch all dashboard data in parallel
 * This is the Midday pattern - one fast parallel fetch!
 */
export async function getDashboardData() {
  const userId = await getAuthenticatedUserId();
  
  console.log('📊 [Server] Fetching dashboard data in parallel...');
  
  try {
    // ✅ PARALLEL - All at once!
    const [habits, logs] = await Promise.all([
      getHabits(),
      getHabitLogs(),
    ]);
    
    console.log('✅ [Server] Dashboard data loaded:', {
      habits: habits.length,
      logs: logs.length,
    });
    
    return {
      habits,
      logs,
    };
  } catch (error) {
    console.error('❌ [Server] Failed to fetch dashboard data:', error);
    throw error;
  }
}

