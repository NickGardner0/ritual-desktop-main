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
  date: string
  completed_at?: string
  status: 'completed' | 'skipped' | 'missed'
  notes?: string
}

export class HabitsService {
  // Test connection to Supabase
  async testConnection(): Promise<boolean> {
    try {
      console.log('🔄 Testing Supabase connection...')
      const { data, error } = await supabase
        .from('habits')
        .select('count(*)')
        .limit(1)
      
      if (error) {
        console.error('❌ Supabase connection test failed:', error)
        return false
      }
      
      console.log('✅ Supabase connection test successful:', data)
      return true
    } catch (error) {
      console.error('❌ Supabase connection test error:', error)
      return false
    }
  }

  // Helper method to generate UUID-compatible string from any input
  private generateUUIDFromString(input: string): string {
    // Create a deterministic UUID-like string from the input
    // This ensures the same input always generates the same UUID
    const hash = this.simpleHash(input)
    const uuid = [
      hash.substring(0, 8),
      hash.substring(8, 12),
      hash.substring(12, 16),
      hash.substring(16, 20),
      hash.substring(20, 32)
    ].join('-')
    
    console.log('🔄 Generated UUID from', input, ':', uuid)
    return uuid
  }

  // Simple hash function to create consistent hash from string
  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    // Convert to positive hex string and pad to 32 characters
    const hex = Math.abs(hash).toString(16).padStart(8, '0')
    return (hex + hex + hex + hex).substring(0, 32)
  }

  // Sync Google OAuth session with Supabase
  private async syncGoogleSession(): Promise<boolean> {
    try {
      console.log('🔄 Syncing Google session with Supabase...')
      
      // Get Google access token from localStorage (set by Tauri OAuth)
      const googleAccessToken = localStorage.getItem('google_access_token')
      
      if (!googleAccessToken) {
        console.warn('⚠️ No Google access token found')
        return false
      }
      
      // Set the session in Supabase using the Google token
      const { data, error } = await supabase.auth.setSession({
        access_token: googleAccessToken,
        refresh_token: localStorage.getItem('google_refresh_token') || ''
      })
      
      if (error) {
        console.error('❌ Failed to sync Google session with Supabase:', error)
        return false
      }
      
      console.log('✅ Google session synced with Supabase:', data.user?.email)
      return true
    } catch (error) {
      console.error('❌ Error syncing Google session:', error)
      return false
    }
  }
  // Create a new habit
  async createHabit(habitData: Omit<Habit, 'id' | 'created_at' | 'updated_at'>): Promise<Habit> {
    console.log('🔄 Creating habit in Supabase:', habitData)
    
    // Get the current authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      console.error('❌ No authenticated user found:', userError)
      throw new Error('User must be authenticated to create habits')
    }
    
    console.log('✅ Creating habit for authenticated user:', user.email)
    
    // Check if user profile exists, create if it doesn't
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single()
    
    if (!profile) {
      // Create profile for new user
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.email?.split('@')[0]
        })
      
      if (profileError) {
        console.error('❌ Error creating profile:', profileError)
        // Continue anyway - the habit creation might still work
      }
    }
    
    const habitToInsert = {
      ...habitData,
      user_id: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    
    console.log('🔄 Habit insertion with user ID:', habitToInsert)
    
    const { data, error } = await supabase
      .from('habits')
      .insert([habitToInsert])
      .select()
      .single()

    if (error) {
      console.error('❌ Error creating habit in Supabase:', error)
      console.error('❌ Error details:', error.message, error.code, error.hint)
      throw error
    }

    console.log('✅ Habit created in Supabase:', data)
    return data
  }

  // Get all habits for the current user
  async getHabits(): Promise<Habit[]> {
    
    // Use session instead of getUser() to reduce auth requests
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session?.user) {
      console.error('❌ No authenticated session found:', sessionError)
      return []
    }
    
    const user = session.user
    
    console.log('✅ Fetching habits for authenticated user:', user.email)
    
    const { data, error } = await supabase
      .from('habits')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('❌ Error fetching habits from Supabase:', error)
      console.error('❌ Error details:', error.message, error.code)
      throw error
    }

    console.log('✅ Habits fetched from Supabase:', data)
    console.log('🔍 Number of habits found:', data?.length || 0)
    return data || []
  }

  // Update a habit
  async updateHabit(id: string, updates: Partial<Habit>): Promise<Habit> {
    const { data, error } = await supabase
      .from('habits')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('❌ Error updating habit:', error)
      throw error
    }

    return data
  }

  // Delete a habit
  async deleteHabit(id: string): Promise<void> {
    const { error } = await supabase
      .from('habits')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('❌ Error deleting habit:', error)
      throw error
    }
  }

  // Log a habit completion
  async logHabit(habitLog: Omit<HabitLog, 'id'>): Promise<HabitLog> {
    const { data, error } = await supabase
      .from('habit_logs')
      .insert([habitLog])
      .select()
      .single()

    if (error) {
      console.error('❌ Error logging habit:', error)
      throw error
    }

    return data
  }

  // Get habit logs
  async getHabitLogs(habitId?: string): Promise<HabitLog[]> {
    try {
      let query = supabase
        .from('habit_logs')
        .select('*')
        .order('date', { ascending: false })

      if (habitId) {
        query = query.eq('habit_id', habitId)
      }

      const { data, error } = await query

      if (error) {
        console.warn('⚠️ Could not fetch habit logs (table may not exist or be accessible):', error.message)
        return []
      }

      return data || []
    } catch (error) {
      console.warn('⚠️ Error fetching habit logs, returning empty array:', error)
      return []
    }
  }
}

// Export a singleton instance
export const habitsService = new HabitsService()
