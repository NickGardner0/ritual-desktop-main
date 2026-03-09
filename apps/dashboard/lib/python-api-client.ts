/**
 * Python FastAPI Backend Client
 * Mirrors the shared dashboard habit type interfaces.
 */

import { Habit, HabitLog } from './habit-types'

const API_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
const REQUEST_TIMEOUT_MS = 30000;

type TokenProvider = () => Promise<string | null>

function timeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

class PythonApiClient {
  private tokenProvider: TokenProvider | null = null

  setTokenProvider(provider: TokenProvider): void {
    this.tokenProvider = provider
  }

  clearTokenProvider(): void {
    this.tokenProvider = null
  }

  private async getAuthToken(): Promise<string> {
    if (!this.tokenProvider) {
      throw new Error('Authentication provider is not configured. Pass Clerk getToken() via setTokenProvider().')
    }

    const token = await this.tokenProvider()
    if (!token) {
      throw new Error('Authentication required. Please sign in again.')
    }

    return token
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAuthToken()
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
      signal: options.signal || timeoutSignal(REQUEST_TIMEOUT_MS),
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
      const response = await fetch(`${API_BASE_URL}/health`, { signal: timeoutSignal(REQUEST_TIMEOUT_MS) })
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
    
    const result = await this.request<Habit>(`/api/habits`, {
      method: 'POST',
      body: JSON.stringify(habitData)
    })

    console.log('✅ Habit created in Python backend:', result)
    return result
  }

  async getHabits(): Promise<Habit[]> {
    console.log('🔄 Fetching habits from Python backend...')
    
    const result = await this.request<Habit[]>(`/api/habits`)
    console.log('✅ Habits fetched from Python backend:', result.length, 'habits')
    return result
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
