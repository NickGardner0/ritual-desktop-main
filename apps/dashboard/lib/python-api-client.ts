/**
 * Python FastAPI Backend Client
 * Mirrors the existing habits-service.ts interface exactly
 */

import { Habit, HabitLog } from './habits-service'

const API_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

interface ApiResponse<T> {
  data?: T
  error?: string
  message?: string
}

class PythonApiClient {
  private async getAuthToken(): Promise<string | null> {
    // Get token from Clerk authentication
    if (typeof window !== 'undefined') {
      // Try to get Clerk token from localStorage (set by Clerk)
      // Note: This is a fallback - ideally tokens should be passed in
      const clerkToken = localStorage.getItem('clerk_session')
      
      // Fallback to stored Google token (for Tauri desktop app)
      const googleToken = localStorage.getItem('google_access_token')
      
      return clerkToken || googleToken || null
    }
    
    return null
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAuthToken()
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...options.headers,
      },
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API Error (${response.status}): ${errorText}`)
    }
    
    return response.json()
  }

  // ================================
  // HABIT METHODS - Mirror existing interface exactly
  // ================================

  async testConnection(): Promise<boolean> {
    try {
      console.log('🔄 Testing Python backend connection...')
      const response = await fetch(`${API_BASE_URL}/health`)
      const result = await response.json()
      
      if (response.ok && result.status === 'healthy') {
        console.log('✅ Python backend connection successful:', result)
        return true
      } else {
        console.error('❌ Python backend connection failed:', result)
        return false
      }
    } catch (error) {
      console.error('❌ Python backend connection error:', error)
      return false
    }
  }

  async createHabit(habitData: Omit<Habit, 'id' | 'created_at' | 'updated_at'>): Promise<Habit> {
    console.log('🔄 Creating habit in Python backend:', habitData)
    
    // Use main API endpoint (auth bypassed temporarily)
    const result = await fetch(`${API_BASE_URL}/api/habits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(habitData)
    })
    
    const data = await result.json()
    
    if (result.ok) {
      console.log('✅ Habit created in Python backend:', data)
      return data
    } else {
      throw new Error(data.error || data.message || 'Failed to create habit')
    }
  }

  async getHabits(): Promise<Habit[]> {
    console.log('🔄 Fetching habits from Python backend...')
    
    // Use main API endpoint (auth bypassed temporarily)
    const result = await fetch(`${API_BASE_URL}/api/habits`)
    const data = await result.json()
    
    if (result.ok) {
      console.log('✅ Habits fetched from Python backend:', data.length, 'habits')
      return data
    } else {
      throw new Error(data.error || data.message || 'Failed to fetch habits')
    }
  }

  async updateHabit(id: string, updates: Partial<Habit>): Promise<Habit> {
    console.log('🔄 Updating habit in Python backend:', id, updates)
    
    const result = await this.request<Habit>(`/api/habits/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
    
    console.log('✅ Habit updated in Python backend:', result)
    return result
  }

  async deleteHabit(id: string): Promise<void> {
    console.log('🔄 Deleting habit in Python backend:', id)
    
    await this.request(`/api/habits/${id}`, {
      method: 'DELETE',
    })
    
    console.log('✅ Habit deleted in Python backend')
  }

  async logHabit(habitLog: Omit<HabitLog, 'id'>): Promise<HabitLog> {
    console.log('🔄 Logging habit in Python backend:', habitLog)
    
    const result = await this.request<HabitLog>(`/api/habits/${habitLog.habit_id}/logs`, {
      method: 'POST',
      body: JSON.stringify({
        duration: habitLog.duration,
        amount: habitLog.amount,
        date: habitLog.date,
        completed_at: habitLog.completed_at,
        status: habitLog.status,
        notes: habitLog.notes,
      }),
    })
    
    console.log('✅ Habit logged in Python backend:', result)
    return result
  }

  async getHabitLogs(habitId?: string): Promise<HabitLog[]> {
    console.log('🔄 Fetching habit logs from Python backend:', habitId || 'all')
    
    const endpoint = habitId ? `/api/habits/${habitId}/logs` : '/api/habit-logs'
    const result = await this.request<HabitLog[]>(endpoint)
    
    console.log('✅ Habit logs fetched from Python backend:', result.length, 'logs')
    return result
  }

  // ================================
  // ANALYTICS METHODS - New Tinybird-powered features
  // ================================

  async getHabitsSummary(daysBack: number = 30): Promise<any> {
    console.log('🔄 Fetching habits summary from Python backend...')
    
    const result = await this.request(`/api/analytics/habits/summary?days_back=${daysBack}`)
    
    console.log('✅ Habits summary fetched from Python backend:', result)
    return result
  }

  async getHabitTrends(period: string = 'day', daysBack: number = 30, habitId?: string): Promise<any> {
    console.log('🔄 Fetching habit trends from Python backend...')
    
    let endpoint = `/api/analytics/habits/trends?period=${period}&days_back=${daysBack}`
    if (habitId) {
      endpoint += `&habit_id=${habitId}`
    }
    
    const result = await this.request(endpoint)
    
    console.log('✅ Habit trends fetched from Python backend:', result)
    return result
  }
}

// Export singleton instance
export const pythonApiClient = new PythonApiClient()

// Export class for testing
export { PythonApiClient }
