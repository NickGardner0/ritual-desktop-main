import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

// Optimized Supabase client configuration for better performance
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Client-side optimized configuration
export const supabaseOptimized = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Reduce auth token refresh frequency for better performance
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Optimize storage for faster auth checks
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  // Connection pool optimization
  db: {
    schema: 'public'
  },
  // Reduce network overhead
  global: {
    headers: {
      'x-client-info': 'ritual-app-optimized'
    }
  },
  // Enable real-time only when needed
  realtime: {
    params: {
      eventsPerSecond: 10 // Limit events to reduce costs
    }
  }
})

// Admin client for server-side operations (better performance, bypasses RLS)
export const supabaseAdminOptimized = createClient<Database>(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  // Server-side optimizations
  global: {
    headers: {
      'x-client-info': 'ritual-admin-optimized'
    }
  }
})

/**
 * Query builder helpers for optimized database access
 */
export class OptimizedQueryBuilder {
  /**
   * Build an optimized habits query with proper indexing
   */
  static buildHabitsQuery(userId: string, limit = 100) {
    return supabaseOptimized
      .from('habits')
      .select('id, name, category, icon, is_custom, integration_source, created_at, updated_at, user_id, unit_type')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
  }

  /**
   * Build an optimized habit logs query with date range and proper indexing
   */
  static buildHabitLogsQuery(
    userId: string, 
    habitId?: string, 
    dateFrom?: string, 
    dateTo?: string,
    limit = 1000
  ) {
    let query = supabaseOptimized
      .from('habit_logs')
      .select('id, habit_id, duration, amount, unit, date, status, notes, created_at')
      .eq('user_id', userId)

    if (habitId) {
      query = query.eq('habit_id', habitId)
    }

    // Use date range to leverage partial indexes
    const defaultDateFrom = new Date()
    defaultDateFrom.setDate(defaultDateFrom.getDate() - 90)
    
    query = query.gte('date', dateFrom || defaultDateFrom.toISOString().split('T')[0])
    
    if (dateTo) {
      query = query.lte('date', dateTo)
    }

    return query
      .order('date', { ascending: false })
      .limit(limit)
  }

  /**
   * Build an optimized metrics query using the database function
   */
  static buildMetricsQuery(userId: string, dateFrom?: string, dateTo?: string) {
    return supabaseOptimized.rpc('get_user_habit_metrics', {
      user_uuid: userId,
      date_from: dateFrom || null,
      date_to: dateTo || null
    })
  }

  /**
   * Build an optimized profile query
   */
  static buildProfileQuery(userId: string) {
    return supabaseOptimized
      .from('profiles')
      .select('id, email, onboarding_completed, created_at, updated_at')
      .eq('id', userId)
      .single()
  }
}

/**
 * Connection health monitoring
 */
export class ConnectionMonitor {
  private static healthCheckCache: { timestamp: number, healthy: boolean } | null = null
  private static readonly HEALTH_CHECK_CACHE_DURATION = 60 * 1000 // 1 minute

  /**
   * Check database connection health with caching
   */
  static async checkHealth(): Promise<boolean> {
    const now = Date.now()
    
    // Return cached result if still valid
    if (this.healthCheckCache && 
        (now - this.healthCheckCache.timestamp) < this.HEALTH_CHECK_CACHE_DURATION) {
      return this.healthCheckCache.healthy
    }

    try {
      console.log('🔍 Checking database connection health...')
      
      const { data, error } = await supabaseOptimized
        .from('habits')
        .select('count')
        .limit(1)
        .single()

      const healthy = !error
      
      // Cache the result
      this.healthCheckCache = {
        timestamp: now,
        healthy
      }

      if (healthy) {
        console.log('✅ Database connection healthy')
      } else {
        console.warn('⚠️ Database connection issues:', error)
      }

      return healthy
    } catch (error) {
      console.error('❌ Database health check failed:', error)
      
      // Cache failure result
      this.healthCheckCache = {
        timestamp: now,
        healthy: false
      }
      
      return false
    }
  }

  /**
   * Get connection statistics
   */
  static getConnectionStats() {
    return {
      healthCheckCached: !!this.healthCheckCache,
      lastHealthCheck: this.healthCheckCache?.timestamp || null,
      lastHealthStatus: this.healthCheckCache?.healthy || false
    }
  }
}

/**
 * Query performance monitoring
 */
export class QueryMonitor {
  private static queryTimes: Map<string, number[]> = new Map()

  /**
   * Time a query execution
   */
  static async timeQuery<T>(queryName: string, queryFn: () => Promise<T>): Promise<T> {
    const startTime = performance.now()
    
    try {
      const result = await queryFn()
      const endTime = performance.now()
      const duration = endTime - startTime

      // Store query time for monitoring
      if (!this.queryTimes.has(queryName)) {
        this.queryTimes.set(queryName, [])
      }
      
      const times = this.queryTimes.get(queryName)!
      times.push(duration)
      
      // Keep only last 10 measurements
      if (times.length > 10) {
        times.shift()
      }

      console.log(`⏱️ Query "${queryName}" took ${duration.toFixed(2)}ms`)
      
      return result
    } catch (error) {
      const endTime = performance.now()
      const duration = endTime - startTime
      
      console.error(`❌ Query "${queryName}" failed after ${duration.toFixed(2)}ms:`, error)
      throw error
    }
  }

  /**
   * Get query performance statistics
   */
  static getQueryStats() {
    const stats: Record<string, { avg: number, min: number, max: number, count: number }> = {}
    
    for (const [queryName, times] of this.queryTimes.entries()) {
      if (times.length > 0) {
        stats[queryName] = {
          avg: times.reduce((sum, time) => sum + time, 0) / times.length,
          min: Math.min(...times),
          max: Math.max(...times),
          count: times.length
        }
      }
    }
    
    return stats
  }

  /**
   * Clear query statistics
   */
  static clearStats() {
    this.queryTimes.clear()
    console.log('🧹 Query statistics cleared')
  }
}

// Export optimized clients and utilities
export { 
  supabaseOptimized as supabase,
  supabaseAdminOptimized as supabaseAdmin,
  OptimizedQueryBuilder,
  ConnectionMonitor,
  QueryMonitor
}
