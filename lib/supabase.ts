import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Only log in browser to avoid SSR issues
if (typeof window !== 'undefined') {
  console.log('Supabase URL:', supabaseUrl);
  console.log('Supabase Anon Key:', supabaseAnonKey ? supabaseAnonKey.slice(0, 8) + '...' : 'Not set');
}

// Custom storage adapter for Tauri compatibility
const customStorage = {
  getItem: (key: string) => {
    if (typeof window === 'undefined') return null
    try {
      const item = window.localStorage.getItem(key)
      console.log(`🔐 Storage getItem(${key}):`, item ? 'found' : 'not found')
      return item
    } catch (error) {
      console.error('🔐 Storage getItem error:', error)
      return null
    }
  },
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(key, value)
      console.log(`🔐 Storage setItem(${key}): stored`)
    } catch (error) {
      console.error('🔐 Storage setItem error:', error)
    }
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(key)
      console.log(`🔐 Storage removeItem(${key}): removed`)
    } catch (error) {
      console.error('🔐 Storage removeItem error:', error)
    }
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Disable URL detection for Tauri
    storage: customStorage
  }
})

// Admin client with service role key (bypasses RLS) - only create if key is available
export const supabaseAdmin = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null

 