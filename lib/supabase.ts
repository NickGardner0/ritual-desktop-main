import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Only log in browser to avoid SSR issues
if (typeof window !== 'undefined') {
  console.log('Supabase URL:', supabaseUrl);
  console.log('Supabase Anon Key:', supabaseAnonKey ? supabaseAnonKey.slice(0, 8) + '...' : 'Not set');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: typeof window !== 'undefined', // Only enable in browser
    storage: typeof window !== 'undefined' ? window.localStorage : undefined
  }
})

 