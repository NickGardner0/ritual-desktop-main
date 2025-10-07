// AUTH OPTIMIZATION UTILITIES
// Centralized auth functions to reduce redundant auth requests

import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';

// Cache for session to avoid repeated calls
let sessionCache: { user: User | null; timestamp: number } | null = null;
const CACHE_DURATION = 30000; // 30 seconds

/**
 * Get current user with caching to reduce auth requests
 * Use this instead of supabase.auth.getUser() or supabase.auth.getSession()
 */
export async function getCurrentUser(): Promise<User | null> {
  // Check cache first
  if (sessionCache && (Date.now() - sessionCache.timestamp) < CACHE_DURATION) {
    console.log('🔐 Using cached user session');
    return sessionCache.user;
  }

  try {
    // Use getSession instead of getUser for better performance
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error('🔐 Error getting session:', error);
      return null;
    }

    // Update cache
    sessionCache = {
      user: session?.user || null,
      timestamp: Date.now()
    };

    console.log('🔐 Fetched fresh user session:', session?.user?.email || 'no user');
    return session?.user || null;
  } catch (error) {
    console.error('🔐 Error in getCurrentUser:', error);
    return null;
  }
}

/**
 * Clear the session cache (call when user signs out or signs in)
 */
export function clearUserCache(): void {
  sessionCache = null;
  console.log('🔐 User session cache cleared');
}

/**
 * Check if user is authenticated without making a network request
 */
export function isUserCached(): boolean {
  return sessionCache !== null && 
         sessionCache.user !== null && 
         (Date.now() - sessionCache.timestamp) < CACHE_DURATION;
}

/**
 * Get user ID quickly from cache or session
 */
export async function getCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id || null;
}

/**
 * Optimized auth check for components
 */
export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Authentication required');
  }
  return user;
}
