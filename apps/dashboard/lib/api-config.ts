/**
 * API Configuration and Feature Flags
 * Controls which backend to use for different operations
 */

// Feature flags for gradual migration
export const API_CONFIG = {
  // Set to true to use Python backend, false for Supabase
  USE_PYTHON_BACKEND: process.env.NEXT_PUBLIC_USE_PYTHON_BACKEND === 'true',
  
  // Individual feature flags for granular control
  HABITS_USE_PYTHON: process.env.NEXT_PUBLIC_HABITS_USE_PYTHON === 'true',
  LOGS_USE_PYTHON: process.env.NEXT_PUBLIC_LOGS_USE_PYTHON === 'true',
  ANALYTICS_USE_PYTHON: process.env.NEXT_PUBLIC_ANALYTICS_USE_PYTHON === 'true',
  
  // Backend URLs
  PYTHON_API_URL: process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000',
  
  // Debug logging
  DEBUG_API_CALLS: process.env.NEXT_PUBLIC_DEBUG_API === 'true',
}

export function logApiCall(operation: string, backend: 'supabase' | 'python', data?: any) {
  if (API_CONFIG.DEBUG_API_CALLS) {
    console.log(`🔄 API Call: ${operation} via ${backend}`, data)
  }
}
