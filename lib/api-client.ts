import { supabase } from '@/lib/supabase'

// API base URL (default to localhost in development)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

/**
 * Creates a fetch request with the proper headers and authentication.
 */
const createRequest = async (
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> => {
  // Get the current session from Supabase
  const { data: { session } } = await supabase.auth.getSession()

  // Set default headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }

  // Add authorization token if available
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }

  // Create the request
  const url = `${API_BASE_URL}${endpoint}`
  const config: RequestInit = {
    ...options,
    headers,
  }

  // Make the request
  return fetch(url, config)
}

/**
 * API client for the Ritual backend.
 */
const apiClient = {
  /**
   * Make a GET request to the API.
   */
  async get<T>(endpoint: string, queryParams?: Record<string, string>): Promise<T> {
    let url = endpoint
    
    // Add query parameters if provided
    if (queryParams) {
      const params = new URLSearchParams()
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value)
        }
      })
      
      const queryString = params.toString()
      if (queryString) {
        url = `${url}?${queryString}`
      }
    }
    
    const response = await createRequest(url)
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }
    
    return response.json()
  },
  
  /**
   * Make a POST request to the API.
   */
  async post<T>(endpoint: string, data: any): Promise<T> {
    const response = await createRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    })
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }
    
    return response.json()
  },
  
  /**
   * Make a PUT request to the API.
   */
  async put<T>(endpoint: string, data: any): Promise<T> {
    const response = await createRequest(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }
    
    return response.json()
  },
  
  /**
   * Make a DELETE request to the API.
   */
  async delete<T>(endpoint: string): Promise<T | void> {
    const response = await createRequest(endpoint, {
      method: 'DELETE',
    })
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }
    
    // Some DELETE endpoints return no content
    if (response.status === 204) {
      return
    }
    
    return response.json()
  },

  // Habit specific API methods
  habits: {
    /**
     * Get all habits for the current user.
     */
    async getAll() {
      return apiClient.get('/habits');
    },

    /**
     * Get a specific habit by ID.
     */
    async getById(habitId: string) {
      return apiClient.get(`/habits/${habitId}`)
    },

    /**
     * Create a new habit.
     */
    async create(habitData: any) {
      return apiClient.post('/habits', habitData)
    },

    /**
     * Update an existing habit.
     */
    async update(habitId: string, habitData: any) {
      return apiClient.put(`/habits/${habitId}`, habitData)
    },

    /**
     * Delete a habit.
     */
    async delete(habitId: string) {
      return apiClient.delete(`/habits/${habitId}`)
    },

    /**
     * Get predefined habits.
     */
    async getPredefined() {
      return apiClient.get('/api/habits/predefined/list')
    },

    /**
     * Complete a habit.
     */
    async complete(habitId: string, completionData: any) {
      return apiClient.post(`/api/habits/${habitId}/complete`, completionData)
    },

    /**
     * Get starter habits.
     */
    async getStarterHabits(userId: string) {
      return apiClient.post(`/api/habits/starter?user_id=${userId}`, {})
    },
  },

  // Habit logs specific API methods
  habitLogs: {
    /**
     * Get all habit logs with optional filtering.
     */
    async getAll(habitId?: string, startDate?: string, endDate?: string) {
      const queryParams: Record<string, string> = {}
      
      if (habitId) {
        queryParams.habit_id = habitId
      }
      if (startDate) {
        queryParams.start_date = startDate
      }
      if (endDate) {
        queryParams.end_date = endDate
      }
      
      return apiClient.get('/habit-logs', queryParams)
    },

    /**
     * Create a new habit log.
     */
    async create(logData: any) {
      return apiClient.post('/habit-logs', logData)
    },

    /**
     * Update an existing habit log.
     */
    async update(logId: string, logData: any) {
      return apiClient.put(`/habit-logs/${logId}`, logData)
    },

    /**
     * Delete a habit log.
     */
    async delete(logId: string) {
      return apiClient.delete(`/habit-logs/${logId}`)
    },
  },

  // User specific API methods
  users: {
    /**
     * Get the current user's information.
     */
    async getMe() {
      return apiClient.get('/users/me')
    },

    /**
     * Get the user's profile.
     */
    async getProfile() {
      return apiClient.get('/users/profile')
    },

    /**
     * Update the user's profile.
     */
    async updateProfile(profileData: any) {
      return apiClient.put('/users/profile', profileData)
    },
  },

  // Command palette specific API methods
  commandPalette: {
    /**
     * Get all command palette data for a user.
     */
    async getData(userId: string) {
      return apiClient.get(`/api/command-palette/data?user_id=${userId}`)
    },

    /**
     * Record usage of an action.
     */
    async recordActionUsage(userId: string, actionId: string) {
      return apiClient.post(`/api/command-palette/actions/${actionId}/record-usage?user_id=${userId}`, {})
    },

    /**
     * Toggle favorite status of an action.
     */
    async toggleFavorite(userId: string, actionId: string) {
      return apiClient.post(`/api/command-palette/actions/${actionId}/toggle-favorite?user_id=${userId}`, {})
    },
  },
}

export default apiClient 