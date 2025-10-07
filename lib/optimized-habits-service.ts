import { supabase, supabaseAdmin } from './supabase'

export interface Habit {
  id?: string
  name: string
  category: string
  icon?: string
  is_custom?: boolean
  integration_source?: string
  created_at?: string
  updated_at?: string
  user_id?: string
  unit_type?: string
}

export interface HabitLog {
  id?: string
  habit_id: string
  duration?: number
  amount?: number
  unit?: string
  date: string
  status: 'completed' | 'skipped' | 'missed'
  notes?: string
}

export interface HabitMetrics {
  habit_id: string
  habit_name: string
  total_completed: number
  total_duration: number | null
  total_amount: number | null
  last_completed_date: string | null
}

/**
 * Optimized Habits Service with performance improvements:
 * - Reduced database calls through batching
 * - Optimized queries with proper indexing
 * - Caching mechanisms
 * - Connection pooling considerations
 */
export class OptimizedHabitsService {
  private habitsCache: Map<string, Habit[]> = new Map()
  private metricsCache: Map<string, HabitMetrics[]> = new Map()
  private cacheTimeout = 5 * 60 * 1000 // 5 minutes

  /**
   * Get habits with optimized query and caching
   */
  async getHabitsOptimized(): Promise<Habit[]> {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        console.error('❌ No authenticated user found:', userError)
        return []
      }

      // Check cache first
      const cacheKey = `habits_${user.id}`
      const cached = this.habitsCache.get(cacheKey)
      if (cached) {
        console.log('✅ Using cached habits data')
        return cached
      }

      console.log('🔄 Fetching habits with optimized query...')
      
      // Optimized query with specific field selection
      const { data, error } = await supabase
        .from('habits')
        .select('id, name, category, icon, is_custom, integration_source, created_at, updated_at, user_id, unit_type')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('❌ Error fetching habits:', error)
        throw error
      }

      // Cache the results
      this.habitsCache.set(cacheKey, data || [])
      setTimeout(() => this.habitsCache.delete(cacheKey), this.cacheTimeout)

      console.log(`✅ Fetched ${data?.length || 0} habits with optimized query`)
      return data || []
    } catch (error) {
      console.error('❌ Error in getHabitsOptimized:', error)
      throw error
    }
  }

  /**
   * Get habit logs with optimized query and date range filtering
   */
  async getHabitLogsOptimized(habitId?: string, dateFrom?: string, dateTo?: string): Promise<HabitLog[]> {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        console.error('❌ No authenticated user found for habit logs')
        return []
      }

      console.log('🔄 Fetching habit logs with optimized query...')

      // Build optimized query with proper indexing
      let query = supabase
        .from('habit_logs')
        .select('id, habit_id, duration, amount, unit, date, status, notes, created_at')
        .eq('user_id', user.id)

      // Add filters to use indexes effectively
      if (habitId) {
        query = query.eq('habit_id', habitId)
      }

      if (dateFrom) {
        query = query.gte('date', dateFrom)
      }

      if (dateTo) {
        query = query.lte('date', dateTo)
      } else {
        // Default to last 90 days to use partial index
        const defaultDateFrom = new Date()
        defaultDateFrom.setDate(defaultDateFrom.getDate() - 90)
        query = query.gte('date', defaultDateFrom.toISOString().split('T')[0])
      }

      // Order by date DESC to use index efficiently
      query = query.order('date', { ascending: false }).limit(1000)

      const { data, error } = await query

      if (error) {
        console.warn('⚠️ Could not fetch habit logs:', error.message)
        return []
      }

      console.log(`✅ Fetched ${data?.length || 0} habit logs with optimized query`)
      return data || []
    } catch (error) {
      console.warn('⚠️ Error fetching habit logs:', error)
      return []
    }
  }

  /**
   * Get habit metrics using the optimized database function
   */
  async getHabitMetricsOptimized(dateFrom?: string, dateTo?: string): Promise<HabitMetrics[]> {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        console.error('❌ No authenticated user found for metrics')
        return []
      }

      // Check cache first
      const cacheKey = `metrics_${user.id}_${dateFrom || 'all'}_${dateTo || 'all'}`
      const cached = this.metricsCache.get(cacheKey)
      if (cached) {
        console.log('✅ Using cached metrics data')
        return cached
      }

      console.log('🔄 Fetching habit metrics with optimized function...')

      // Use the optimized database function
      const { data, error } = await supabase
        .rpc('get_user_habit_metrics', {
          user_uuid: user.id,
          date_from: dateFrom || null,
          date_to: dateTo || null
        })

      if (error) {
        console.error('❌ Error fetching habit metrics:', error)
        // Fallback to regular query if function doesn't exist
        return this.getHabitMetricsFallback(dateFrom, dateTo)
      }

      const metrics = data?.map((row: any) => ({
        habit_id: row.habit_id,
        habit_name: row.habit_name,
        total_completed: parseInt(row.total_completed) || 0,
        total_duration: row.total_duration ? parseInt(row.total_duration) : null,
        total_amount: row.total_amount ? parseFloat(row.total_amount) : null,
        last_completed_date: row.last_completed_date
      })) || []

      // Cache the results for shorter time since metrics change frequently
      this.metricsCache.set(cacheKey, metrics)
      setTimeout(() => this.metricsCache.delete(cacheKey), 2 * 60 * 1000) // 2 minutes

      console.log(`✅ Fetched metrics for ${metrics.length} habits`)
      return metrics
    } catch (error) {
      console.error('❌ Error in getHabitMetricsOptimized:', error)
      return this.getHabitMetricsFallback(dateFrom, dateTo)
    }
  }

  /**
   * Fallback method for habit metrics if optimized function fails
   */
  private async getHabitMetricsFallback(dateFrom?: string, dateTo?: string): Promise<HabitMetrics[]> {
    console.log('🔄 Using fallback method for habit metrics...')
    
    const habits = await this.getHabitsOptimized()
    const logs = await this.getHabitLogsOptimized(undefined, dateFrom, dateTo)
    
    return habits.map(habit => {
      const habitLogs = logs.filter(log => 
        log.habit_id === habit.id && log.status === 'completed'
      )
      
      return {
        habit_id: habit.id!,
        habit_name: habit.name,
        total_completed: habitLogs.length,
        total_duration: habitLogs.reduce((sum, log) => sum + (log.duration || 0), 0) || null,
        total_amount: habitLogs.reduce((sum, log) => sum + (log.amount || 0), 0) || null,
        last_completed_date: habitLogs.length > 0 ? habitLogs[0].date : null
      }
    })
  }

  /**
   * Batch create/update habit logs for better performance
   */
  async batchUpsertHabitLogs(logs: Omit<HabitLog, 'id'>[]): Promise<HabitLog[]> {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        throw new Error('No authenticated user found')
      }

      console.log(`🔄 Batch upserting ${logs.length} habit logs...`)

      // Add user_id to all logs
      const logsWithUserId = logs.map(log => ({
        ...log,
        user_id: user.id
      }))

      // Use upsert for better performance
      const { data, error } = await supabase
        .from('habit_logs')
        .upsert(logsWithUserId, {
          onConflict: 'habit_id,user_id,date',
          ignoreDuplicates: false
        })
        .select()

      if (error) {
        console.error('❌ Error batch upserting habit logs:', error)
        throw error
      }

      console.log(`✅ Successfully upserted ${data?.length || 0} habit logs`)
      
      // Clear relevant caches
      this.clearUserCaches(user.id)
      
      return data || []
    } catch (error) {
      console.error('❌ Error in batchUpsertHabitLogs:', error)
      throw error
    }
  }

  /**
   * Optimized habit creation with cache management
   */
  async createHabitOptimized(habitData: Omit<Habit, 'id' | 'created_at' | 'updated_at'>): Promise<Habit> {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        throw new Error('No authenticated user found')
      }

      console.log('🔄 Creating habit with optimized method...')

      const { data, error } = await supabase
        .from('habits')
        .insert({
          ...habitData,
          user_id: user.id
        })
        .select()
        .single()

      if (error) {
        console.error('❌ Error creating habit:', error)
        throw error
      }

      console.log('✅ Habit created successfully:', data.name)
      
      // Clear habits cache to ensure fresh data
      this.clearUserCaches(user.id)
      
      return data
    } catch (error) {
      console.error('❌ Error in createHabitOptimized:', error)
      throw error
    }
  }

  /**
   * Clear all caches for a specific user
   */
  private clearUserCaches(userId: string): void {
    const habitsKey = `habits_${userId}`
    this.habitsCache.delete(habitsKey)
    
    // Clear all metrics caches for this user
    for (const key of this.metricsCache.keys()) {
      if (key.startsWith(`metrics_${userId}`)) {
        this.metricsCache.delete(key)
      }
    }
    
    console.log('🧹 Cleared caches for user:', userId)
  }

  /**
   * Clear all caches (useful for debugging)
   */
  clearAllCaches(): void {
    this.habitsCache.clear()
    this.metricsCache.clear()
    console.log('🧹 All caches cleared')
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { habits: number, metrics: number } {
    return {
      habits: this.habitsCache.size,
      metrics: this.metricsCache.size
    }
  }
}

// Export singleton instance
export const optimizedHabitsService = new OptimizedHabitsService()
