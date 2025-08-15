import { useState, useCallback } from 'react'
import apiClient from '@/lib/api-client'

/**
 * A hook to manage API requests with loading and error states.
 * 
 * @param initialData - Optional initial data
 * @returns API handling utilities
 */
export function useApi<T>(initialData?: T) {
  const [data, setData] = useState<T | undefined>(initialData)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  /**
   * Function to handle API requests with loading and error states.
   * 
   * @param apiCall - The API call function to execute
   * @returns The result of the API call
   */
  const request = useCallback(async <R>(
    apiCall: () => Promise<R>
  ): Promise<R | undefined> => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await apiCall()
      setData(result as unknown as T)
      return result
    } catch (e) {
      console.error('API error:', e)
      setError(e instanceof Error ? e : new Error(String(e)))
      return undefined
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    data,
    isLoading,
    error,
    request,
  }
}

/**
 * Hook for habit-related API calls.
 */
export function useHabits() {
  const { data: habits, isLoading, error, request } = useApi<any[]>([])

  const fetchHabits = useCallback(() => {
    return request(() => apiClient.habits.getAll())
  }, [request])

  const createHabit = useCallback((habitData: any) => {
    return request(() => apiClient.habits.create(habitData))
  }, [request])

  const updateHabit = useCallback((habitId: string, habitData: any) => {
    return request(() => apiClient.habits.update(habitId, habitData))
  }, [request])

  const deleteHabit = useCallback((habitId: string) => {
    return request(() => apiClient.habits.delete(habitId))
  }, [request])

  const fetchPredefinedHabits = useCallback(() => {
    return request(() => apiClient.habits.getPredefined())
  }, [request])

  return {
    habits,
    isLoading,
    error,
    fetchHabits,
    createHabit,
    updateHabit,
    deleteHabit,
    fetchPredefinedHabits,
  }
}

/**
 * Hook for habit log-related API calls.
 */
export function useHabitLogs() {
  const { data: logs, isLoading, error, request } = useApi<any[]>([])

  const fetchLogs = useCallback((habitId: string, startDate?: string, endDate?: string) => {
    return request(() => apiClient.habitLogs.getAll(habitId, startDate, endDate))
  }, [request])

  const createLog = useCallback((habitId: string, logData: any) => {
    return request(() => apiClient.habitLogs.create(logData))
  }, [request])

  const updateLog = useCallback((logId: string, logData: any) => {
    return request(() => apiClient.habitLogs.update(logId, logData))
  }, [request])

  const deleteLog = useCallback((logId: string) => {
    return request(() => apiClient.habitLogs.delete(logId))
  }, [request])

  return {
    logs,
    isLoading,
    error,
    fetchLogs,
    createLog,
    updateLog,
    deleteLog,
  }
}

/**
 * Hook for user-related API calls.
 */
export function useUser() {
  const { data: user, isLoading, error, request } = useApi<any>()

  const fetchUser = useCallback(() => {
    return request(() => apiClient.users.getMe())
  }, [request])

  const fetchProfile = useCallback(() => {
    return request(() => apiClient.users.getProfile())
  }, [request])

  const updateProfile = useCallback((profileData: any) => {
    return request(() => apiClient.users.updateProfile(profileData))
  }, [request])

  return {
    user,
    isLoading,
    error,
    fetchUser,
    fetchProfile,
    updateProfile,
  }
} 